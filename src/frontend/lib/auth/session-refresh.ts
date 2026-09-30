'use client'

import { isDevAuthBypass } from './env'
import {
  lerExpiresAt,
  REFRESH_TOKEN_STORAGE_KEY,
  type SessaoRecebida,
  salvarSessao,
  TOKEN_STORAGE_KEY,
} from './token'

/** Backend API base URL (same default as `lib/api.ts`). */
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/** Renovação proativa: quanto antes do `expiresAt` o `AuthProvider` renova (≈ 5 min). */
export const RENOVAR_ANTES_MS = 5 * 60_000

/** Tempo máximo de uma chamada a `/auth/refresh` antes de contar como indisponível. */
export const TIMEOUT_RENOVACAO_MS = 10_000

/** Nome do lock (Web Locks API) que serializa a renovação entre as abas. */
const LOCK_RENOVACAO = 'financeiro-auth-refresh'

type OuvinteRenovacao = (sessao: { token: string; username: string }) => void
const ouvintes = new Set<OuvinteRenovacao>()

/** O `AuthProvider` escuta aqui para trocar o token da aba sem efeito visível. */
export const onSessaoRenovada = (fn: OuvinteRenovacao): (() => void) => {
  ouvintes.add(fn)
  return () => {
    ouvintes.delete(fn)
  }
}

/**
 * Resultado de uma tentativa de renovação (Regis `availability-1`):
 * - `renovada`: token novo gravado;
 * - `recusada`: a sessão acabou de verdade (backend recusou com 400/401/403, não há refresh token,
 *   resposta sem os campos, dev-bypass) → quem chama abre o modal de sessão expirada;
 * - `indisponivel`: falha passageira (GoTrue fora → 503, limite → 429, outro 5xx, rede fora) → a
 *   sessão continua; quem chama tenta de novo depois, sem mandar o usuário para o login.
 */
export type ResultadoRenovacao =
  | { tipo: 'renovada'; token: string }
  | { tipo: 'recusada' }
  | { tipo: 'indisponivel' }

const RECUSADA: ResultadoRenovacao = { tipo: 'recusada' }
const INDISPONIVEL: ResultadoRenovacao = { tipo: 'indisponivel' }

/** Status que dizem "a sessão acabou"; qualquer outra falha é passageira. */
const STATUS_DEFINITIVOS = new Set([400, 401, 403])

/** Renovação em voo nesta aba (single-flight). */
let emVoo: Promise<ResultadoRenovacao> | null = null

interface LocksApi {
  request: (nome: string, fn: () => Promise<unknown>) => Promise<unknown>
}

const locks = (): LocksApi | undefined =>
  typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: LocksApi }).locks
    : undefined

/**
 * Renova a sessão Supabase pelo NOSSO `POST /auth/refresh` (o front não fala com o Supabase, I6) e
 * devolve o access token novo, ou `null` quando não há como renovar (sem refresh token — backend
 * antigo ou modo `local` —, recusa do backend, rede fora, dev-bypass).
 *
 * Coordenação (D12): uma renovação por vez nesta aba (quem chega durante uma espera a mesma
 * promessa) e entre abas (`navigator.locks`). Antes de chamar o backend, relê o `localStorage`: se
 * outra aba já renovou (o `expiresAt` avançou, ou o token mudou desde o que falhou), ADOTA o token
 * dela em vez de gastar o refresh token — que já foi rotacionado. Usa `fetch` puro, nunca o
 * `apiFetch`, para um 401 aqui não disparar outra renovação.
 *
 * `tokenQueFalhou`: o token que acabou de levar 401 (o `apiFetch` passa); se o storage já tem
 * outro, é de outra aba e serve.
 */
export const renovarSessao = (tokenQueFalhou?: string): Promise<ResultadoRenovacao> => {
  if (isDevAuthBypass() || typeof window === 'undefined') return Promise.resolve(RECUSADA)
  if (emVoo) return emVoo
  const expiraAntes = lerExpiresAt()
  const tarefa = async (): Promise<ResultadoRenovacao> => {
    const lock = locks()
    const resultado = lock
      ? await lock.request(LOCK_RENOVACAO, () => renovar(expiraAntes, tokenQueFalhou))
      : await Promise.resolve().then(() => renovar(expiraAntes, tokenQueFalhou))
    return (resultado as ResultadoRenovacao | undefined) ?? RECUSADA
  }
  emVoo = tarefa().finally(() => {
    emVoo = null
  })
  return emVoo
}

/** Atalho: o token novo, ou `null` em qualquer falha (recusa ou indisponibilidade). */
export const refreshSession = async (tokenQueFalhou?: string): Promise<string | null> => {
  const r = await renovarSessao(tokenQueFalhou)
  return r.tipo === 'renovada' ? r.token : null
}

const renovar = async (
  expiraAntes: number | null,
  tokenQueFalhou: string | undefined,
): Promise<ResultadoRenovacao> => {
  const atual = window.localStorage.getItem(TOKEN_STORAGE_KEY)
  const expiraAgora = lerExpiresAt()
  const outraAbaRenovou =
    atual !== null &&
    ((expiraAgora !== null && expiraAntes !== null && expiraAgora > expiraAntes) ||
      (tokenQueFalhou !== undefined && atual !== tokenQueFalhou))
  if (outraAbaRenovou) return { tipo: 'renovada', token: atual }

  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)
  if (!refreshToken) return RECUSADA

  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      // Uma renovação pendurada seguraria a aba em "renovando" para sempre: 10 s e vira
      // `indisponivel` (o abort cai no catch abaixo).
      ...(typeof AbortSignal.timeout === 'function'
        ? { signal: AbortSignal.timeout(TIMEOUT_RENOVACAO_MS) }
        : {}),
    })
    if (!res.ok) return STATUS_DEFINITIVOS.has(res.status) ? RECUSADA : INDISPONIVEL
    const sessao = (await res.json()) as SessaoRecebida
    if (!sessao?.token || !sessao.refreshToken) return RECUSADA
    salvarSessao(sessao)
    for (const ouvinte of ouvintes) ouvinte({ token: sessao.token, username: sessao.username })
    return { tipo: 'renovada', token: sessao.token }
  } catch {
    // Rede fora / CORS / timeout: passageiro — a sessão não acabou.
    return INDISPONIVEL
  }
}

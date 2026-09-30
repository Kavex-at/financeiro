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

/** Renovação em voo nesta aba (single-flight). */
let emVoo: Promise<string | null> | null = null

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
export const refreshSession = (tokenQueFalhou?: string): Promise<string | null> => {
  if (isDevAuthBypass() || typeof window === 'undefined') return Promise.resolve(null)
  if (emVoo) return emVoo
  const expiraAntes = lerExpiresAt()
  const tarefa = async (): Promise<string | null> => {
    const lock = locks()
    const resultado = lock
      ? await lock.request(LOCK_RENOVACAO, () => renovar(expiraAntes, tokenQueFalhou))
      : await Promise.resolve().then(() => renovar(expiraAntes, tokenQueFalhou))
    return (resultado as string | null) ?? null
  }
  emVoo = tarefa().finally(() => {
    emVoo = null
  })
  return emVoo
}

const renovar = async (
  expiraAntes: number | null,
  tokenQueFalhou: string | undefined,
): Promise<string | null> => {
  const atual = window.localStorage.getItem(TOKEN_STORAGE_KEY)
  const expiraAgora = lerExpiresAt()
  const outraAbaRenovou =
    atual !== null &&
    ((expiraAgora !== null && expiraAntes !== null && expiraAgora > expiraAntes) ||
      (tokenQueFalhou !== undefined && atual !== tokenQueFalhou))
  if (outraAbaRenovou) return atual

  const refreshToken = window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)
  if (!refreshToken) return null

  try {
    const res = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return null
    const sessao = (await res.json()) as SessaoRecebida
    if (!sessao?.token || !sessao.refreshToken) return null
    salvarSessao(sessao)
    for (const ouvinte of ouvintes) ouvinte({ token: sessao.token, username: sessao.username })
    return sessao.token
  } catch {
    return null
  }
}

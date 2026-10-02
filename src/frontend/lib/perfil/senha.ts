import { z } from 'zod'
import { withAuthHeaders } from '../auth/token'
import { apiFetch } from '../http'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/**
 * Troca da própria senha — LIGADA desde a v0.51.0: o backend (`GET /me/senha/politica`,
 * `POST /me/senha`, ADR-0059, PR #102) está em produção desde a v0.50.0. Desligar (`false`) volta a
 * seção Segurança para "em breve", desabilitada e sem nenhuma chamada de rede — é o kill switch do
 * front, caso o backend precise sair do ar.
 */
export const SENHA_PROPRIA_HABILITADA = true

/**
 * Contrato de `GET /me/senha/politica` → `{ minimo, maximo, regras[] }`. O tamanho vem de
 * `minimo`/`maximo`; cada item de `regras` é uma regra extra do servidor (`id` + `rotulo`). Com
 * `padrao` (regex) ela é avaliada ao vivo no checklist; sem, fica neutra até um 400 POLITICA
 * apontá-la. O formato de `regras` é PROPOSTA deste front para o backend `feat/auth-senha-propria`.
 */
const politicaSchema = z.object({
  minimo: z.number().int().positive(),
  maximo: z.number().int().positive(),
  regras: z
    .array(z.object({ id: z.string().min(1), rotulo: z.string().min(1), padrao: z.string().optional() }))
    .default([]),
})
export type PoliticaSenha = z.infer<typeof politicaSchema>

/** Política usada enquanto o endpoint não existe ou falha: 8 a 72 caracteres (limite do bcrypt). */
export const POLITICA_PADRAO: PoliticaSenha = { minimo: 8, maximo: 72, regras: [] }

export interface ItemChecklist {
  id: string
  rotulo: string
  /** `null` = regra do servidor sem `padrao`: não dá para avaliar no navegador. */
  ok: (nova: string, atual: string, confirmacao: string) => boolean | null
}

const testarPadrao = (padrao: string, valor: string): boolean | null => {
  try {
    return new RegExp(padrao).test(valor)
  } catch {
    return null
  }
}

/** Ids das regras que o servidor também usa no 400 POLITICA e que o checklist avalia localmente. */
const REGRAS_LOCAIS = new Set(['tamanho', 'diferente_da_atual'])

/** O servidor mede o máximo em BYTES UTF-8 (limite do bcrypt): "ç" ou "é" contam 2. */
export const bytesUtf8 = (s: string): number => {
  let total = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    total += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
  }
  return total
}

/** Checklist ao vivo: tamanho da política, regras do servidor, diferente da atual e confirmação. */
export const montarChecklist = (politica: PoliticaSenha): ItemChecklist[] => [
  {
    id: 'tamanho',
    rotulo: `Entre ${politica.minimo} e ${politica.maximo} caracteres`,
    ok: (n) => n.length >= politica.minimo && bytesUtf8(n) <= politica.maximo,
  },
  ...politica.regras.filter((r) => !REGRAS_LOCAIS.has(r.id)).map(
    (r): ItemChecklist => ({
      id: r.id,
      rotulo: r.rotulo,
      ok: (n) => (r.padrao === undefined ? null : testarPadrao(r.padrao, n)),
    }),
  ),
  { id: 'diferente_da_atual', rotulo: 'Diferente da senha atual', ok: (n, a) => n !== '' && n !== a },
  {
    id: 'confirmacao',
    rotulo: 'Confirmação igual à nova senha',
    ok: (n, _a, c) => n !== '' && n === c,
  },
]

/** `GET /me/senha/politica`. Só chamada com a flag ligada; qualquer falha cai na `POLITICA_PADRAO`. */
export async function buscarPoliticaSenha(): Promise<PoliticaSenha> {
  try {
    const res = await apiFetch(`${API}/me/senha/politica`, { headers: await withAuthHeaders() })
    if (!res.ok) return POLITICA_PADRAO
    const lida = politicaSchema.safeParse(await res.json())
    return lida.success && lida.data.minimo <= lida.data.maximo ? lida.data : POLITICA_PADRAO
  } catch {
    return POLITICA_PADRAO
  }
}

export type ResultadoSenha =
  | { tipo: 'sucesso' }
  | { tipo: 'politica'; regras: string[] }
  | { tipo: 'senha_atual_invalida' }
  | { tipo: 'muitas_tentativas' }
  | { tipo: 'indisponivel' }

/**
 * Status HTTP → resultado. 422 `SENHA_ATUAL_INVALIDA` é proposital: um 401 cairia no tratamento de
 * sessão do `apiFetch` e abriria o modal de "sessão encerrada" por um erro de digitação (I3).
 * 503 (e qualquer 5xx) é "não foi possível verificar", nunca logout (I5).
 */
export const mapearRespostaSenha = (status: number, body?: unknown): ResultadoSenha => {
  const codigo = (body as { codigo?: string } | undefined)?.codigo
  if (status === 204 || status === 200) return { tipo: 'sucesso' }
  if (status === 400 && codigo === 'POLITICA') {
    const regras = (body as { regras?: unknown }).regras
    return {
      tipo: 'politica',
      regras: Array.isArray(regras) ? regras.filter((r): r is string => typeof r === 'string') : [],
    }
  }
  if (status === 422 && codigo === 'SENHA_ATUAL_INVALIDA') return { tipo: 'senha_atual_invalida' }
  if (status === 429) return { tipo: 'muitas_tentativas' }
  return { tipo: 'indisponivel' }
}

/** `POST /me/senha`. Só chamada com a flag ligada. */
export async function alterarSenha(senhaAtual: string, novaSenha: string): Promise<ResultadoSenha> {
  let res: Response
  try {
    res = await apiFetch(`${API}/me/senha`, {
      method: 'POST',
      headers: { ...(await withAuthHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ senhaAtual, novaSenha }),
    })
  } catch {
    return { tipo: 'indisponivel' }
  }
  let body: unknown
  try {
    body = res.status === 204 ? undefined : await res.json()
  } catch {
    body = undefined
  }
  return mapearRespostaSenha(res.status, body)
}

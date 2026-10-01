import { withAuthHeaders } from '../auth/token'
import { apiFetch } from '../http'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/**
 * Troca da própria senha — DESLIGADA até o backend `feat/auth-senha-propria` existir
 * (`POST /me/senha` ainda não existe). Com a flag desligada a seção Segurança é desenhada, mas
 * desabilitada com "em breve", e nada aqui é chamado. Ligar = trocar esta constante num tweak
 * posterior, junto com o backend.
 */
export const SENHA_PROPRIA_HABILITADA = false

/** Regras da política mostradas no checklist. `id` casa com as `falhas` do 400 POLITICA. */
export const POLITICA_SENHA: ReadonlyArray<{
  id: string
  rotulo: string
  ok: (nova: string, atual: string, confirmacao: string) => boolean
}> = [
  { id: 'tamanho', rotulo: 'Mínimo de 12 caracteres', ok: (n) => n.length >= 12 },
  {
    id: 'composicao',
    rotulo: 'Letras e números',
    ok: (n) => /[A-Za-z]/.test(n) && /\d/.test(n),
  },
  { id: 'diferente', rotulo: 'Diferente da senha atual', ok: (n, a) => n !== '' && n !== a },
  {
    id: 'confirmacao',
    rotulo: 'Confirmação igual à nova senha',
    ok: (n, _a, c) => n !== '' && n === c,
  },
]

export type ResultadoSenha =
  | { tipo: 'sucesso' }
  | { tipo: 'politica'; falhas: string[] }
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
    const falhas = (body as { falhas?: unknown }).falhas
    return {
      tipo: 'politica',
      falhas: Array.isArray(falhas) ? falhas.filter((f): f is string => typeof f === 'string') : [],
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

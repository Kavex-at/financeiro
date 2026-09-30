import { emitSessionExpired } from './auth/session-events'
import { refreshSession } from './auth/session-refresh'

/**
 * Thrown by `apiFetch` when the backend answers HTTP 401 and the session could not be renewed.
 * Callers should let it bubble; the `SessionExpiredModal` (driven by `emitSessionExpired`) owns
 * the UX, so mutation `catch` blocks swallow it via `isSessionExpiredError` instead of showing
 * their generic error toast.
 */
export class SessionExpiredError extends Error {
  constructor(message = 'Sua sessão expirou.') {
    super(message)
    this.name = 'SessionExpiredError'
  }
}

/** Type guard so `catch` blocks can distinguish session expiry from real errors. */
export const isSessionExpiredError = (err: unknown): err is SessionExpiredError =>
  err instanceof SessionExpiredError

const BEARER = 'Bearer '

/** O token que a requisição levou (para a renovação saber se outra aba já trocou). */
const tokenDaRequisicao = (init?: RequestInit): string | undefined => {
  const valor = new Headers(init?.headers).get('Authorization')
  return valor?.startsWith(BEARER) ? valor.slice(BEARER.length) : undefined
}

/** A mesma requisição com o `Authorization` trocado pelo token novo. */
const comToken = (init: RequestInit | undefined, token: string): RequestInit => {
  const headers = new Headers(init?.headers)
  headers.set('Authorization', `${BEARER}${token}`)
  return { ...init, headers }
}

/**
 * Thin `fetch` wrapper that centralises 401 handling for the whole API layer.
 *
 * On 401 it tries ONE session renewal (`refreshSession`, ADR-0054) and resends the request ONCE
 * with the new `Authorization`. If there is no way to renew (old backend / local mode: no refresh
 * token), the renewal fails, or the resend is 401 again, it fires the session-expired bus (opens
 * the modal) and throws `SessionExpiredError` — the behaviour before the renewal existed. Every
 * other status (including the 409/422 special cases the callers inspect) is returned verbatim.
 */
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await fetch(input, init)
  if (res.status !== 401) return res

  const novo = await refreshSession(tokenDaRequisicao(init))
  if (novo) {
    const reenvio = await fetch(input, comToken(init, novo))
    if (reenvio.status !== 401) return reenvio
  }
  emitSessionExpired()
  throw new SessionExpiredError()
}

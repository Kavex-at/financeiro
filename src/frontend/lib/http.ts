import { emitSessionExpired } from './auth/session-events'
import { renovarSessao } from './auth/session-refresh'

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

/**
 * Thrown by `apiFetch` when a request got 401 and the renewal failed for a TRANSIENT reason (auth
 * service down, rate limit, network). The session is NOT over, so no re-login modal: the caller
 * shows the message like any other error and the user can retry (Regis `availability-1`).
 */
export class AuthUnavailableError extends Error {
  constructor(
    message = 'Serviço de autenticação instável no momento. Tente novamente em instantes.',
  ) {
    super(message)
    this.name = 'AuthUnavailableError'
  }
}

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
 * On 401 it tries ONE session renewal (`renovarSessao`, ADR-0056) and resends the request ONCE
 * with the new `Authorization`. If the renewal is REFUSED (no refresh token — old backend / local
 * mode —, backend said 400/401/403) or the resend is 401 again, it fires the session-expired bus
 * (opens the modal) and throws `SessionExpiredError`. If the renewal is only UNAVAILABLE (503, 429,
 * other 5xx, network), it throws `AuthUnavailableError` WITHOUT the modal: the session is still
 * good and the next attempt may work. Every other status (including the 409/422 special cases the
 * callers inspect) is returned verbatim.
 */
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await fetch(input, init)
  if (res.status !== 401) return res

  const renovacao = await renovarSessao(tokenDaRequisicao(init))
  if (renovacao.tipo === 'indisponivel') throw new AuthUnavailableError()
  if (renovacao.tipo === 'renovada') {
    const reenvio = await fetch(input, comToken(init, renovacao.token))
    if (reenvio.status !== 401) return reenvio
  }
  emitSessionExpired()
  throw new SessionExpiredError()
}

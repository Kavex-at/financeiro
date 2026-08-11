import { emitSessionExpired } from './auth/session-events'

/**
 * Thrown by `apiFetch` when the backend answers HTTP 401 — a IDENTIDADE falhou (sem token,
 * token inválido, ou o refresh realmente não funcionou). Callers should let it bubble; the
 * `SessionExpiredModal` (driven by `emitSessionExpired`) owns the UX, so mutation `catch`
 * blocks swallow it via `isSessionExpiredError` instead of showing their generic error toast.
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
 * Lançado quando o backend responde **403** — a identidade é legítima e a AUTORIZAÇÃO foi
 * negada. Três causas depois do cutover (ADR-0030): sem linha em `app_user`, `ativo = false`,
 * ou papel insuficiente.
 *
 * **É uma classe própria, e não um erro genérico, por uma razão operacional:** antes do
 * cutover o 403 era raro e caía no erro genérico; agora ele é um caminho COMUM, e confundi-lo
 * com sessão expirada produziria um loop de refresh contra um provedor que está respondendo
 * corretamente — escondendo do diagnóstico que o problema é de autorização, não de sessão.
 */
export class ForbiddenError extends Error {
  constructor(message = 'Você não tem autorização para esta ação.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/** Type guard para `catch` blocks distinguirem autorização negada de erro real. */
export const isForbiddenError = (err: unknown): err is ForbiddenError =>
  err instanceof ForbiddenError

/**
 * Thin `fetch` wrapper que centraliza o tratamento de 401 **e 403** para toda a camada de API.
 *
 * | Status | Significado | O que faz |
 * |---|---|---|
 * | 401 | falta IDENTIDADE | dispara o barramento de sessão expirada (abre o modal) e lança `SessionExpiredError` |
 * | 403 | identidade ok, AUTORIZAÇÃO negada | lança `ForbiddenError` — **jamais** dispara refresh nem o modal |
 *
 * Qualquer outro status (incluindo os 409/422 que os chamadores inspecionam) é devolvido
 * verbatim, para que o tratamento por-chamada continue intocado.
 */
export const apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const res = await fetch(input, init)
  if (res.status === 401) {
    emitSessionExpired()
    throw new SessionExpiredError()
  }
  if (res.status === 403) {
    // NUNCA `emitSessionExpired()` aqui. A sessão está viva; o que falta é permissão.
    throw new ForbiddenError(await forbiddenMessage(res))
  }
  return res
}

/** Usa a mensagem PT-BR que o backend já manda; cai no texto padrão quando não houver. */
const forbiddenMessage = async (res: Response): Promise<string | undefined> => {
  try {
    const body = (await res.clone().json()) as { error?: unknown }
    return typeof body.error === 'string' && body.error.length > 0 ? body.error : undefined
  } catch {
    return undefined
  }
}

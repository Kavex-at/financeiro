'use client'

import { isDevAuthBypass } from './env'

/** localStorage key holding the backend-issued JWT. */
export const TOKEN_STORAGE_KEY = 'auth_token'
/** localStorage key holding the signed-in username (for the header menu). */
export const USERNAME_STORAGE_KEY = 'auth_username'
/**
 * localStorage key do refresh token da sessão Supabase (ADR-0057). Ausente = backend antigo ou
 * modo `local`: sem renovação, o modal aparece no `exp` como antes.
 */
export const REFRESH_TOKEN_STORAGE_KEY = 'auth_refresh_token'
/** localStorage key da expiração do access token, em segundos desde a época (D10). */
export const EXPIRES_AT_STORAGE_KEY = 'auth_expires_at'

/** Resposta de `/auth/login` e `/auth/refresh` (D10); `refreshToken`/`expiresAt` só em modo supabase. */
export interface SessaoRecebida {
  token: string
  username: string
  refreshToken?: string
  expiresAt?: number
}

/** Grava a sessão recebida. Sem `refreshToken`, apaga os campos de renovação (comportamento antigo). */
export const salvarSessao = (sessao: SessaoRecebida): void => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TOKEN_STORAGE_KEY, sessao.token)
  window.localStorage.setItem(USERNAME_STORAGE_KEY, sessao.username)
  if (sessao.refreshToken && typeof sessao.expiresAt === 'number') {
    window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, sessao.refreshToken)
    window.localStorage.setItem(EXPIRES_AT_STORAGE_KEY, String(sessao.expiresAt))
  } else {
    window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
    window.localStorage.removeItem(EXPIRES_AT_STORAGE_KEY)
  }
}

/** Apaga toda a sessão da aba (e, pelo evento `storage`, das outras). */
export const limparSessao = (): void => {
  if (typeof window === 'undefined') return
  for (const k of [
    TOKEN_STORAGE_KEY,
    USERNAME_STORAGE_KEY,
    REFRESH_TOKEN_STORAGE_KEY,
    EXPIRES_AT_STORAGE_KEY,
  ]) {
    window.localStorage.removeItem(k)
  }
}

/** `expiresAt` guardado (segundos), ou `null`. */
export const lerExpiresAt = (): number | null => {
  if (typeof window === 'undefined') return null
  const bruto = Number(window.localStorage.getItem(EXPIRES_AT_STORAGE_KEY))
  return Number.isFinite(bruto) && bruto > 0 ? bruto : null
}

/**
 * Returns the current access token from `localStorage`, or `undefined` when
 * there is none (or on the server, or when dev-bypass is on). Synchronous —
 * the token lives in `localStorage` (no async session lookup). Used by the API
 * client to attach `Authorization: Bearer <token>` to backend requests.
 */
export const getAccessToken = (): string | undefined => {
  if (isDevAuthBypass()) return undefined
  if (typeof window === 'undefined') return undefined
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined
}

/**
 * Builds request headers with the bearer token attached when available.
 * Kept `async` so callers (`lib/api.ts`) need no change. Merges any
 * caller-supplied headers (caller values take precedence).
 */
export const withAuthHeaders = async (
  base: Record<string, string> = {},
): Promise<Record<string, string>> => {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}`, ...base } : { ...base }
}

/**
 * Reads the `exp` claim (seconds since epoch) from a JWT WITHOUT verifying the
 * signature — the backend already verifies it on every request. Used only to
 * schedule the proactive session-expired modal. Returns `null` for any
 * malformed token (missing/garbage payload, non-numeric `exp`).
 */
export const decodeJwtExp = (token: string): number | null => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(base64)) as { exp?: unknown }
    return typeof json.exp === 'number' && Number.isFinite(json.exp) ? json.exp : null
  } catch {
    return null
  }
}

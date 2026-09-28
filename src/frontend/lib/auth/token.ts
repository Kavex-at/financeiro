'use client'

import { isDevAuthBypass } from './env'

/** localStorage key holding the backend-issued JWT. */
export const TOKEN_STORAGE_KEY = 'auth_token'
/** localStorage key holding the signed-in username (for the header menu). */
export const USERNAME_STORAGE_KEY = 'auth_username'

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

/**
 * Reads the `role` claim from a JWT WITHOUT verifying the signature — the
 * backend already verifies it on every request. Used only by the deploy-window
 * fallback of `PermissoesProvider` (D4, ADR-0053); authorization is server-side,
 * read from the database. Returns `null` for any malformed token.
 */
export const decodeJwtRole = (token: string): string | null => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(atob(base64)) as { role?: unknown }
    return typeof json.role === 'string' ? json.role : null
  } catch {
    return null
  }
}

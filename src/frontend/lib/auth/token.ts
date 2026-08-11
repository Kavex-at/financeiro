'use client'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { isDevAuthBypass } from './env'
import { readLegacySession } from './legacySession'
import { isLegacyAuth } from './provider'

/**
 * Access token da sessão corrente — **do Supabase**, não do `localStorage`.
 *
 * ## Por que o token saiu do `localStorage`
 *
 * Ele vivia em `localStorage` sem refresh, sem rotação e **sem revogação**: um token vazado
 * valia as 12 h inteiras, e não havia logout de verdade. Agora a sessão é custodiada pelo
 * `@supabase/ssr` em cookies, com refresh automático e rotação — e `signOut()` revoga do lado
 * do provedor.
 *
 * ## Por que virou `async`
 *
 * `supabase.auth.getSession()` é assíncrona (pode disparar um refresh). Isso não vaza para os
 * chamadores: `withAuthHeaders` **já era** `async`, então os 52 call sites em `lib/api.ts`,
 * `lib/recebimentos.ts`, `lib/sispag.ts` e `lib/usuarios.ts` seguem intocados.
 */
export const getAccessToken = async (): Promise<string | undefined> => {
  if (isDevAuthBypass()) return undefined
  if (typeof window === 'undefined') return undefined
  // Rollback da Fase 2 (ADR-0030 §6): sob a flag legada o token volta a vir do
  // `localStorage`, porque é lá que `POST /auth/login` o deixou. O backend aceita os dois
  // esquemas e resolve o `app_user` pelo lookup certo (`authScheme`).
  if (isLegacyAuth()) return readLegacySession()?.token
  try {
    const {
      data: { session },
    } = await getSupabaseBrowserClient().auth.getSession()
    return session?.access_token ?? undefined
  } catch {
    // Configuração ausente ou provedor fora: a request segue sem header e o backend
    // responde 401 — que é o caminho já tratado. Um throw aqui quebraria 52 call sites.
    return undefined
  }
}

/**
 * Builds request headers with the bearer token attached when available.
 *
 * **A assinatura não muda** — já era `async`. É a razão pela qual o cutover de identidade
 * não tocou em nenhum dos 52 call sites da camada de API.
 */
export const withAuthHeaders = async (
  base: Record<string, string> = {},
): Promise<Record<string, string>> => {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}`, ...base } : { ...base }
}

/**
 * Reads the `exp` claim (seconds since epoch) from a JWT WITHOUT verifying the
 * signature — the backend already verifies it on every request. Returns `null` for any
 * malformed token (missing/garbage payload, non-numeric `exp`).
 *
 * Sobrevive porque o `SessionExpiredModal` ainda usa o instante da expiração no texto. Já o
 * `decodeJwtRole` foi **removido**: ler papel de uma claim não verificada era o bug, não o
 * mecanismo — e depois do cutover a claim `role` do GoTrue é sempre `'authenticated'`, o que
 * faria a UI de admin sumir para os próprios admins. O papel agora vem de `GET /me`.
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

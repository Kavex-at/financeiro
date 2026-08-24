'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { type ConexosStatus, fetchConexosStatus } from '../usuarios'
import { assertAuthEnv, isDevAuthBypass } from './env'
import { registerSessionExpiredHandler } from './session-events'
import { decodeJwtExp, decodeJwtRole, TOKEN_STORAGE_KEY, USERNAME_STORAGE_KEY } from './token'

// Fail-fast: crash on import if dev-bypass is on in a non-local build, instead
// of silently rendering an unauthenticated app.
assertAuthEnv()

/** Backend API base URL (same default as `lib/api.ts`). */
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/**
 * Authentication context for the app. Holds a backend-issued JWT in
 * `localStorage` and exposes the current username, a loading flag, and
 * sign-in / sign-out actions.
 *
 * When `NEXT_PUBLIC_DEV_AUTH_BYPASS=true` the provider reports a synthetic
 * authenticated state and never calls the backend, so local development works
 * without logging in.
 */
export interface AuthContextValue {
  token: string | null
  username: string | null
  loading: boolean
  /** True when bypass mode is active (no real token). */
  devBypass: boolean
  /** True when the 12h JWT has expired — drives the blocking re-login modal. */
  sessionExpired: boolean
  /** Epoch ms of the token's `exp` (the moment it expired), for the modal copy. */
  sessionExpiredAt: number | null
  /** Flags the session as expired (called by the 401 bus and the proactive timer). */
  notifySessionExpired: () => void
  /** Clears the expired flag (called right before redirecting to /login). */
  clearSessionExpired: () => void
  /**
   * Status do vínculo Conexos do usuário (Fatia B). `'falha'` = tem vínculo mas a
   * credencial não loga no ERP → está operando pelo robô (o banner avisa). `null`
   * enquanto não resolvido / em dev-bypass.
   */
  conexosStatus: ConexosStatus | null
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const devBypass = isDevAuthBypass()
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(!devBypass)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [sessionExpiredAt, setSessionExpiredAt] = useState<number | null>(null)
  const [conexosStatus, setConexosStatus] = useState<ConexosStatus | null>(null)

  // Busca (best-effort, silencioso) o status do vínculo Conexos do usuário.
  const refreshConexosStatus = useCallback(async () => {
    if (devBypass) {
      setConexosStatus(null)
      return
    }
    try {
      setConexosStatus(await fetchConexosStatus())
    } catch {
      // Não bloqueia o app — o banner só aparece quando o status resolve 'falha'.
    }
  }, [devBypass])

  useEffect(() => {
    if (devBypass) return
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY)
      setToken(stored)
      setUsername(window.localStorage.getItem(USERNAME_STORAGE_KEY))
      if (stored) void refreshConexosStatus()
    }
    setLoading(false)
  }, [devBypass, refreshConexosStatus])

  const notifySessionExpired = useCallback(() => {
    if (devBypass) return
    // Capture the real expiry instant from the token's `exp` so the modal can
    // tell the user EXACTLY when a sessão morreu (and that earlier work is safe).
    const current =
      typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null
    const exp = current ? decodeJwtExp(current) : null
    setSessionExpiredAt(exp != null ? exp * 1000 : Date.now())

    // DESCARTA o token aqui, e não só ao clicar no modal. Um 401 já provou que ele não
    // vale — e enquanto ele existir no localStorage, `/login` devolve o usuário para `/`
    // (a página de login bounce quem "já está logado"), prendendo-o num laço sem saída.
    //
    // Não basta confiar no modal: se uma tela engolir o erro e renderizar o próprio
    // estado de falha, ninguém chama `signOut()`. Aconteceu — token ainda válido por
    // `exp` mas rejeitado pelo backend deixou a aplicação inacessível.
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
      window.localStorage.removeItem(USERNAME_STORAGE_KEY)
    }
    setToken(null)
    setUsername(null)

    setSessionExpired(true)
  }, [devBypass])

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false)
    setSessionExpiredAt(null)
  }, [])

  // Bridge: let the non-React API layer (apiFetch → emitSessionExpired) reach
  // this provider when a request comes back 401 (reactive path).
  useEffect(() => {
    if (devBypass) return
    return registerSessionExpiredHandler(notifySessionExpired)
  }, [devBypass, notifySessionExpired])

  // Proactive path: fire the modal exactly at the token's `exp`, even if the
  // user is idle (no failed request needed). Reset whenever the token changes.
  useEffect(() => {
    if (devBypass || !token) return
    const exp = decodeJwtExp(token)
    if (exp == null) return
    const ms = exp * 1000 - Date.now()
    const id = setTimeout(notifySessionExpired, Math.max(0, ms))
    return () => clearTimeout(id)
  }, [token, devBypass, notifySessionExpired])

  const signIn = useCallback(
    async (user: string, password: string) => {
      if (devBypass) return
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password }),
      })
      if (!res.ok) {
        let message = 'Falha ao entrar.'
        try {
          const body = await res.json()
          if (body?.error) message = body.error
        } catch {}
        throw new Error(message)
      }
      const body = (await res.json()) as { token: string; username: string }
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, body.token)
        window.localStorage.setItem(USERNAME_STORAGE_KEY, body.username)
      }
      setToken(body.token)
      setUsername(body.username)
      // Verifica o vínculo Conexos logo após o login (avisa se cai no robô).
      void refreshConexosStatus()
    },
    [devBypass, refreshConexosStatus],
  )

  const signOut = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
      window.localStorage.removeItem(USERNAME_STORAGE_KEY)
    }
    setToken(null)
    setUsername(null)
    setSessionExpired(false)
    setSessionExpiredAt(null)
    setConexosStatus(null)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      username,
      loading,
      devBypass,
      sessionExpired,
      sessionExpiredAt,
      notifySessionExpired,
      clearSessionExpired,
      conexosStatus,
      signIn,
      signOut,
    }),
    [
      token,
      username,
      loading,
      devBypass,
      sessionExpired,
      sessionExpiredAt,
      notifySessionExpired,
      clearSessionExpired,
      conexosStatus,
      signIn,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/** Hook exposing the current auth context. Must be used under `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an <AuthProvider>')
  }
  return ctx
}

/**
 * Returns whether the current visitor is allowed past the auth gate:
 * true when dev-bypass is on OR a token exists.
 */
export function useIsAuthenticated(): { authenticated: boolean; loading: boolean } {
  const { token, loading, devBypass } = useAuth()
  if (devBypass) return { authenticated: true, loading: false }
  return { authenticated: token != null, loading }
}

/**
 * The current user's role, read from the JWT (`null` when unknown). In
 * dev-bypass there is no token, so it reports `'admin'` so local dev can see
 * the admin-only UI. This is a UI hint only — the real gate is server-side.
 */
export function useRole(): string | null {
  const { token, devBypass } = useAuth()
  if (devBypass) return 'admin'
  return token ? decodeJwtRole(token) : null
}

/** True when the signed-in user may manage other users (role `admin`). */
export function useIsAdmin(): boolean {
  return useRole() === 'admin'
}

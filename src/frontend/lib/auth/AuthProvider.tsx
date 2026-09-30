'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { type ConexosStatus, fetchConexosStatus } from '../usuarios'
import { assertAuthEnv, isDevAuthBypass } from './env'
import { registerSessionExpiredHandler } from './session-events'
import { onSessaoRenovada, RENOVAR_ANTES_MS, refreshSession, renovarSessao } from './session-refresh'
import {
  decodeJwtExp,
  limparSessao,
  lerExpiresAt,
  REFRESH_TOKEN_STORAGE_KEY,
  type SessaoRecebida,
  salvarSessao,
  TOKEN_STORAGE_KEY,
  USERNAME_STORAGE_KEY,
} from './token'

// Fail-fast: crash on import if dev-bypass is on in a non-local build, instead
// of silently rendering an unauthenticated app.
assertAuthEnv()

/** Backend API base URL (same default as `lib/api.ts`). */
const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/** Renovação no `exp` com o serviço de auth indisponível: 15 s, 30 s, depois a cada 60 s. */
const RETENTAR_MIN_MS = 15_000
const RETENTAR_MAX_MS = 60_000

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
  /** True when the session expired and could not be renewed — drives the blocking re-login modal. */
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

/**
 * Texto da tela de login para uma recusa do `/auth/login`: 401 = credencial (o mesmo texto para
 * qualquer causa, sem revelar se a conta existe); 429 (muitas tentativas) e 503 (autenticação
 * indisponível) mostram a mensagem do backend, que já é em português.
 */
export const mensagemDeLogin = (status: number, erroDoBackend?: string): string => {
  if (status === 401) return 'E-mail/usuário ou senha inválidos.'
  if ((status === 429 || status === 503) && erroDoBackend) return erroDoBackend
  return erroDoBackend ?? 'Falha ao entrar.'
}

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
    limparSessao()
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

  // Renovação silenciosa (ADR-0057): outra aba ou o `apiFetch` renovou → troca o token desta aba.
  useEffect(() => {
    if (devBypass) return
    return onSessaoRenovada((sessao) => {
      setToken(sessao.token)
      setUsername(sessao.username)
    })
  }, [devBypass])

  // Entre abas (D12): o evento `storage` traz o token renovado por outra aba, e o logout de uma
  // aba (token removido) desloga as outras.
  useEffect(() => {
    if (devBypass || typeof window === 'undefined') return
    const aoMudar = (e: StorageEvent) => {
      if (e.key === TOKEN_STORAGE_KEY || e.key === null) {
        setToken(window.localStorage.getItem(TOKEN_STORAGE_KEY))
      }
      if (e.key === USERNAME_STORAGE_KEY || e.key === null) {
        setUsername(window.localStorage.getItem(USERNAME_STORAGE_KEY))
      }
    }
    window.addEventListener('storage', aoMudar)
    return () => window.removeEventListener('storage', aoMudar)
  }, [devBypass])

  // Caminho proativo. Com refresh token (sessão Supabase): renova ~5 min antes do `exp` sem nada
  // visível — falhar aqui NÃO abre o modal —, e no `exp` tenta de novo. No `exp`, o modal só abre
  // se a renovação for RECUSADA (sessão acabou de verdade); se o serviço estiver só indisponível
  // (503/429/rede), tenta de novo com espera crescente (15 s, 30 s, depois a cada 60 s) sem tirar
  // ninguém da tela (Regis `availability-1`). Sem refresh token (backend antigo ou modo local): o
  // modal no `exp`, como antes.
  useEffect(() => {
    if (devBypass || !token) return
    const exp = lerExpiresAt() ?? decodeJwtExp(token)
    if (exp == null) return
    const renovavel =
      typeof window !== 'undefined' && window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) != null
    const msAteExp = exp * 1000 - Date.now()
    const timers: ReturnType<typeof setTimeout>[] = []
    if (renovavel) {
      timers.push(
        setTimeout(() => void refreshSession(token), Math.max(0, msAteExp - RENOVAR_ANTES_MS)),
      )
      const tentarNoExp = (esperaMs: number) => {
        timers.push(
          setTimeout(() => {
            void renovarSessao(token).then((r) => {
              if (r.tipo === 'recusada') notifySessionExpired()
              else if (r.tipo === 'indisponivel') {
                tentarNoExp(Math.min(esperaMs === 0 ? RETENTAR_MIN_MS : esperaMs * 2, RETENTAR_MAX_MS))
              }
              // 'renovada': o ouvinte troca o token e este efeito é refeito com os timers novos.
            })
          }, esperaMs === 0 ? Math.max(0, msAteExp) : esperaMs),
        )
      }
      tentarNoExp(0)
    } else {
      timers.push(setTimeout(notifySessionExpired, Math.max(0, msAteExp)))
    }
    return () => {
      for (const id of timers) clearTimeout(id)
    }
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
        let erroDoBackend: string | undefined
        try {
          const body = await res.json()
          if (typeof body?.error === 'string') erroDoBackend = body.error
        } catch {}
        throw new Error(mensagemDeLogin(res.status, erroDoBackend))
      }
      // Resposta do modo supabase traz `refreshToken`/`expiresAt`; a do modo local (ou do backend
      // antigo), não — e aí nada de renovação, como antes.
      const body = (await res.json()) as SessaoRecebida
      salvarSessao(body)
      setToken(body.token)
      setUsername(body.username)
      // Verifica o vínculo Conexos logo após o login (avisa se cai no robô).
      void refreshConexosStatus()
    },
    [devBypass, refreshConexosStatus],
  )

  const signOut = useCallback(() => {
    // "Sair" encerra a sessão no servidor (ADR-0057, D2) em melhor esforço: sem esperar e sem
    // bloquear — falha de rede não impede sair. O backend responde 204 em qualquer caso.
    const atual =
      typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null
    if (atual && !devBypass) {
      void fetch(`${API}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${atual}` },
        keepalive: true,
      }).catch(() => undefined)
    }
    limparSessao()
    setToken(null)
    setUsername(null)
    setSessionExpired(false)
    setSessionExpiredAt(null)
    setConexosStatus(null)
  }, [devBypass])

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

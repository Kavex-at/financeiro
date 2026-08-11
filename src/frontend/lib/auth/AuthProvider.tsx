'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { type ConexosStatus, fetchConexosStatus, fetchMe } from '../usuarios'
import { assertAuthEnv, isDevAuthBypass } from './env'
import { clearLegacySession, readLegacySession, writeLegacySession } from './legacySession'
import { isLegacyAuth } from './provider'
import { registerSessionExpiredHandler } from './session-events'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

// Fail-fast: crash on import if dev-bypass is on in a non-local build, instead
// of silently rendering an unauthenticated app.
assertAuthEnv()

/**
 * Authentication context for the app.
 *
 * ## O que mudou no cutover (ADR-0030)
 *
 * A sessão deixou de ser um JWT em `localStorage` (sem refresh, sem rotação, **sem
 * revogação**) e passou a ser custodiada pelo Supabase GoTrue em cookies, com refresh
 * automático. Duas consequências que valem mais do que o mecanismo:
 *
 * 1. **O papel vem de `GET /me`, não do token.** O JWT do GoTrue traz `role: 'authenticated'`
 *    para todo mundo — lê-lo faria `useIsAdmin()` retornar `false` para os próprios admins, e
 *    a tela `/usuarios` e o card de admin **sumiriam sem erro, sem log e sem teste vermelho**.
 * 2. **O `setTimeout` proativo de expiração morreu.** Com auto-refresh ligado ele dispararia o
 *    modal de "sessão expirada" em cima de uma sessão perfeitamente válida. Quem decide agora
 *    é `onAuthStateChange`.
 *
 * Em `NEXT_PUBLIC_DEV_AUTH_BYPASS=true` o provider reporta um estado sintético e nunca chama
 * o backend, para o dev local rodar sem login.
 */
export interface AuthContextValue {
  token: string | null
  username: string | null
  /** Papel resolvido do BANCO via `GET /me` — nunca de uma claim do token. */
  role: string | null
  loading: boolean
  /** True when bypass mode is active (no real token). */
  devBypass: boolean
  /**
   * True quando o refresh REALMENTE falhou — não mais o fluxo normal de expiração.
   * Com refresh automático, a sessão só morre quando o provedor a recusa.
   */
  sessionExpired: boolean
  /** Epoch ms do momento em que a sessão morreu, para o texto do modal. */
  sessionExpiredAt: number | null
  /** Flags the session as expired (called by the 401 bus and by onAuthStateChange). */
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
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const devBypass = isDevAuthBypass()
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)
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

  /**
   * Resolve identidade e papel **do banco**. É o passo que impede a UI de admin de sumir
   * silenciosamente no cutover (§D3): o token não sabe quem é admin, `app_user` sabe.
   */
  const refreshIdentity = useCallback(async () => {
    if (devBypass) return
    try {
      const me = await fetchMe()
      setUsername(me.username)
      setRole(me.role)
    } catch {
      // 403 (sem linha em `app_user` / inativo) não é sessão expirada: o usuário está
      // autenticado e sem autorização. Deixar `role` nulo esconde a UI de admin — que é o
      // comportamento correto — sem derrubar a sessão.
      setRole(null)
    }
  }, [devBypass])

  // Sessão inicial + reação a login/logout/refresh vindos do provedor.
  useEffect(() => {
    if (devBypass) return

    // ── Rollback da Fase 2 (ADR-0030 §6) ────────────────────────────────────────────────
    // Sob a flag legada não há provedor com quem conversar: a sessão é o token no
    // `localStorage`, sem refresh e sem `onAuthStateChange`. Instanciar o cliente Supabase
    // aqui estouraria em `MissingSupabaseEnvError` justamente no cenário em que se acionou o
    // rollback porque o Supabase é o problema.
    if (isLegacyAuth()) {
      const session = readLegacySession()
      setToken(session?.token ?? null)
      setLoading(false)
      if (session) {
        void refreshIdentity()
        void refreshConexosStatus()
      }
      return
    }

    const supabase = getSupabaseBrowserClient()
    let active = true

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!active) return
      setToken(session?.access_token ?? null)
      setLoading(false)
      if (session) {
        void refreshIdentity()
        void refreshConexosStatus()
      }
    })

    // Substitui o `setTimeout` proativo que existia aqui: com auto-refresh, agendar o modal
    // para o `exp` do token o dispararia em cima de uma sessão viva. `TOKEN_REFRESHED` é
    // justamente o evento que provava que a sessão continua boa.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      setToken(session?.access_token ?? null)
      if (event === 'SIGNED_OUT') {
        setUsername(null)
        setRole(null)
        setConexosStatus(null)
        return
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setSessionExpired(false)
        setSessionExpiredAt(null)
        void refreshIdentity()
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [devBypass, refreshIdentity, refreshConexosStatus])

  const notifySessionExpired = useCallback(() => {
    if (devBypass) return
    setSessionExpiredAt(Date.now())
    setSessionExpired(true)
  }, [devBypass])

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false)
    setSessionExpiredAt(null)
  }, [])

  // Bridge: let the non-React API layer (apiFetch → emitSessionExpired) reach this provider
  // when a request comes back 401. Depois do cutover isso é FALLBACK, não o fluxo normal:
  // o 401 só sobrevive ao auto-refresh quando o refresh realmente falhou.
  useEffect(() => {
    if (devBypass) return
    return registerSessionExpiredHandler(notifySessionExpired)
  }, [devBypass, notifySessionExpired])

  const signIn = useCallback(
    async (user: string, password: string) => {
      if (devBypass) return
      if (isLegacyAuth()) {
        // `POST /auth/login` continua vivo no backend enquanto `AUTH_LEGACY_LOGIN_ENABLED`
        // for `true` (Fase 3 o desliga com **410**, não 404 — o recurso existiu e foi
        // retirado). `apiFetch` está deliberadamente fora daqui: um 401 nesta chamada é
        // "senha errada", não sessão expirada, e não pode abrir o modal.
        const res = await fetch(`${API}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, password }),
        })
        if (!res.ok) {
          throw new Error(
            res.status === 410
              ? 'O login por senha foi desativado. Use a tela de entrada padrão.'
              : 'E-mail ou senha inválidos.',
          )
        }
        const body = (await res.json()) as { token: string; username: string }
        writeLegacySession({ token: body.token, username: body.username })
        setToken(body.token)
        // Sem `onAuthStateChange` neste modo: quem resolve identidade e papel é esta linha.
        void refreshIdentity()
        void refreshConexosStatus()
        return
      }
      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: user,
        password,
      })
      if (error) {
        // Mensagem user-facing em PT-BR; a do provedor é em inglês e vaza detalhe interno.
        throw new Error('E-mail ou senha inválidos.')
      }
      // `onAuthStateChange` (SIGNED_IN) resolve identidade e papel; o vínculo Conexos é
      // verificado aqui para avisar já no login quando a operação cai no robô.
      void refreshConexosStatus()
    },
    [devBypass, refreshIdentity, refreshConexosStatus],
  )

  const signOut = useCallback(async () => {
    if (isLegacyAuth()) {
      // Limpar o storage é TUDO o que o esquema legado consegue fazer: o token segue válido
      // no servidor até o `exp`. Essa é a limitação que o cutover existe para remover — e
      // ela volta junto com o modo de emergência, de propósito.
      clearLegacySession()
    }
    // REVOGAÇÃO DE VERDADE do lado do provedor — antes era só limpar o localStorage, o que
    // deixava o token vazado válido pelas 12 h restantes.
    if (!devBypass && !isLegacyAuth()) {
      try {
        await getSupabaseBrowserClient().auth.signOut()
      } catch {
        // Mesmo com o provedor fora, o estado local é limpo abaixo: melhor sair da sessão
        // localmente do que travar o usuário numa tela que ele quer deixar.
      }
    }
    setToken(null)
    setUsername(null)
    setRole(null)
    setSessionExpired(false)
    setSessionExpiredAt(null)
    setConexosStatus(null)
  }, [devBypass])

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      username,
      role,
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
      role,
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
 * true when dev-bypass is on OR a session exists.
 */
export function useIsAuthenticated(): { authenticated: boolean; loading: boolean } {
  const { token, loading, devBypass } = useAuth()
  if (devBypass) return { authenticated: true, loading: false }
  return { authenticated: token != null, loading }
}

/**
 * O papel do usuário — **resolvido do banco** por `GET /me` (`null` enquanto desconhecido).
 * Em dev-bypass reporta `'admin'` para o dev local enxergar a UI de admin.
 *
 * **Nunca leia isto de uma claim do token.** O `role` do GoTrue é sempre `'authenticated'`;
 * ler a claim faria esta função devolver `false` para todos os admins, e a UI de gestão
 * desapareceria sem produzir erro nenhum. Isto continua sendo uma DICA de UI — o gate real é
 * `requireRole` no servidor.
 */
export function useRole(): string | null {
  const { role, devBypass } = useAuth()
  if (devBypass) return 'admin'
  return role
}

/** True when the signed-in user may manage other users (role `admin`). */
export function useIsAdmin(): boolean {
  return useRole() === 'admin'
}

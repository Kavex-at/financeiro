/**
 * ROLLBACK DA FASE 2 — `NEXT_PUBLIC_AUTH_PROVIDER` (ADR-0030 §6).
 *
 * O Regis-Review verificou que a flag tinha **zero leitores** no frontend: virá-la no painel
 * da Vercel não produzia erro, apenas **nada**. E a descoberta só aconteceria durante um
 * incidente de login, que é o único momento em que ela seria acionada.
 *
 * Estes testes são a guarda de que a flag continua **ligada em algo**: cada caso abaixo
 * exercita um caminho de execução que só existe quando ela está setada. A guarda irmã, do
 * lado do `middleware.ts`, está em `__tests__/middleware.test.ts`.
 */

export {}

const mockGetSession = jest.fn()
const mockSignInWithPassword = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession: mockGetSession, signInWithPassword: mockSignInWithPassword },
  }),
}))

describe('auth/provider — a flag de rollback', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('o default é `supabase` — o rollback é o desvio, não o caminho', async () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = undefined
    const { getAuthProvider, isLegacyAuth } = await import('@/lib/auth/provider')
    expect(getAuthProvider()).toBe('supabase')
    expect(isLegacyAuth()).toBe(false)
  })

  it('um valor desconhecido NÃO cai no legado — falha para o estado desejado', async () => {
    // Um typo no painel da Vercel devolveria todo mundo ao esquema que a Fase 3 vai
    // desligar, e ninguém veria diferença até o dia do desligamento.
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'supbase'
    const { getAuthProvider } = await import('@/lib/auth/provider')
    expect(getAuthProvider()).toBe('supabase')
  })

  it('`legacy` liga o modo de emergência', async () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'legacy'
    const { getAuthProvider, isLegacyAuth } = await import('@/lib/auth/provider')
    expect(getAuthProvider()).toBe('legacy')
    expect(isLegacyAuth()).toBe(true)
  })
})

describe('auth/token — sob o rollback o token volta do localStorage', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    mockGetSession.mockReset()
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok-supabase' } } })
    window.localStorage.clear()
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
    window.localStorage.clear()
  })

  it('lê o token legado e NÃO fala com o provedor', async () => {
    // Instanciar o cliente Supabase aqui estouraria em `MissingSupabaseEnvError` — justo no
    // cenário em que o rollback foi acionado porque o Supabase é o problema.
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'legacy'
    const { writeLegacySession } = await import('@/lib/auth/legacySession')
    writeLegacySession({ token: 'tok-legado', username: 'marilyn.mutafci@kavex.com' })

    const { getAccessToken, withAuthHeaders } = await import('@/lib/auth/token')

    await expect(getAccessToken()).resolves.toBe('tok-legado')
    expect(mockGetSession).not.toHaveBeenCalled()
    // O contrato dos 52 call sites não muda em nenhum dos dois modos.
    await expect(withAuthHeaders()).resolves.toEqual({ Authorization: 'Bearer tok-legado' })
  })

  it('sem sessão legada persistida → sem header (o backend responde 401, caminho já tratado)', async () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDER = 'legacy'
    const { getAccessToken } = await import('@/lib/auth/token')
    await expect(getAccessToken()).resolves.toBeUndefined()
  })

  it('no modo padrão o localStorage é ignorado — o token vem da sessão do provedor', async () => {
    const { writeLegacySession } = await import('@/lib/auth/legacySession')
    writeLegacySession({ token: 'tok-legado', username: 'marilyn.mutafci@kavex.com' })

    const { getAccessToken } = await import('@/lib/auth/token')

    await expect(getAccessToken()).resolves.toBe('tok-supabase')
  })
})

describe('auth/legacySession', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('grava, lê e limpa o par token/username', async () => {
    const { readLegacySession, writeLegacySession, clearLegacySession } = await import(
      '@/lib/auth/legacySession'
    )

    expect(readLegacySession()).toBeNull()
    writeLegacySession({ token: 't', username: 'u@k.com' })
    expect(readLegacySession()).toEqual({ token: 't', username: 'u@k.com' })
    clearLegacySession()
    expect(readLegacySession()).toBeNull()
  })

  it('sessão incompleta é tratada como ausente', async () => {
    const { readLegacySession } = await import('@/lib/auth/legacySession')
    window.localStorage.setItem('columbia.auth.token', 'so-o-token')
    expect(readLegacySession()).toBeNull()
  })
})

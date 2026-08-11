/**
 * O access token deixou de viver em `localStorage` e passou a vir da sessão do Supabase
 * (cookies, com refresh e rotação). O ponto que estes testes fixam é o CONTRATO:
 * `withAuthHeaders` continua `async` com a mesma assinatura — é por isso que os 52 call
 * sites da camada de API não mudaram uma linha.
 */

const getSession = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({ auth: { getSession } }),
}))

describe('auth/token', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    jest.resetModules()
    getSession.mockReset()
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } })
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('returns the access token from the Supabase session', async () => {
    const { getAccessToken } = await import('@/lib/auth/token')
    await expect(getAccessToken()).resolves.toBe('tok-123')
  })

  it('returns undefined when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { getAccessToken } = await import('@/lib/auth/token')
    await expect(getAccessToken()).resolves.toBeUndefined()
  })

  it('returns undefined when dev-bypass is on — and never touches the provider', async () => {
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = 'true'
    const { getAccessToken } = await import('@/lib/auth/token')
    await expect(getAccessToken()).resolves.toBeUndefined()
    expect(getSession).not.toHaveBeenCalled()
  })

  it('falha do provedor degrada para "sem header" em vez de estourar', async () => {
    // Um throw aqui quebraria os 52 call sites de uma vez. Sem header, o backend responde
    // 401 — que é o caminho já tratado.
    getSession.mockRejectedValue(new Error('supabase env missing'))
    const { getAccessToken } = await import('@/lib/auth/token')
    await expect(getAccessToken()).resolves.toBeUndefined()
  })

  it('withAuthHeaders attaches the Authorization header when a session exists', async () => {
    const { withAuthHeaders } = await import('@/lib/auth/token')
    await expect(withAuthHeaders({ 'Content-Type': 'application/json' })).resolves.toEqual({
      Authorization: 'Bearer tok-123',
      'Content-Type': 'application/json',
    })
  })

  it('withAuthHeaders omits the Authorization header when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } })
    const { withAuthHeaders } = await import('@/lib/auth/token')
    await expect(withAuthHeaders({ Accept: 'application/json' })).resolves.toEqual({
      Accept: 'application/json',
    })
  })

  it('CONTRATO: withAuthHeaders continua async — os 52 call sites não mudam', async () => {
    // Critério verificável da Task 16. Se algum dia ela virar síncrona, os chamadores
    // passariam a receber uma Promise onde esperam headers, silenciosamente.
    const { withAuthHeaders } = await import('@/lib/auth/token')
    expect(withAuthHeaders({})).toBeInstanceOf(Promise)
  })

  it('decodeJwtRole foi REMOVIDO — ler papel de claim não verificada era o bug', async () => {
    // O token do GoTrue traz `role: 'authenticated'` para todo mundo. Reintroduzir este
    // helper faria `useIsAdmin()` devolver false para os próprios admins, e a tela de
    // usuários sumiria sem erro nenhum. O papel vem de `GET /me`.
    const mod = await import('@/lib/auth/token')
    expect('decodeJwtRole' in mod).toBe(false)
  })
})

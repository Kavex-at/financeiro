/**
 * `refreshSession()` — renovação da sessão Supabase pelo nosso `/auth/refresh` (ADR-0057, D12):
 * single-flight na aba e entre abas, adoção do token que outra aba já renovou, e `fetch` puro
 * (nunca `apiFetch`, para não entrar em laço de 401 → refresh → 401).
 */
import {
  EXPIRES_AT_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  USERNAME_STORAGE_KEY,
} from '@/lib/auth/token'

const RESPOSTA = {
  token: 'access-novo',
  refreshToken: 'refresh-novo',
  expiresAt: 2_000_000_000,
  username: 'fulano',
  role: 'admin',
}

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

const semear = (over: Record<string, string> = {}) => {
  localStorage.clear()
  const base: Record<string, string> = {
    [TOKEN_STORAGE_KEY]: 'access-velho',
    [REFRESH_TOKEN_STORAGE_KEY]: 'refresh-velho',
    [EXPIRES_AT_STORAGE_KEY]: '1900000000',
    [USERNAME_STORAGE_KEY]: 'fulano',
    ...over,
  }
  for (const [k, v] of Object.entries(base)) localStorage.setItem(k, v)
}

describe('refreshSession', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    jest.resetModules()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    delete (navigator as { locks?: unknown }).locks
    delete process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS
    semear()
  })

  it('chama POST /auth/refresh com fetch puro e grava os três valores novos', async () => {
    fetchMock.mockResolvedValue(okJson(RESPOSTA))
    const { refreshSession } = await import('@/lib/auth/session-refresh')

    expect(await refreshSession()).toBe('access-novo')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/auth\/refresh$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'refresh-velho' })
    expect(init.headers).not.toHaveProperty('Authorization')
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('access-novo')
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-novo')
    expect(localStorage.getItem(EXPIRES_AT_STORAGE_KEY)).toBe('2000000000')
  })

  it('três chamadas simultâneas disparam UMA renovação (single-flight na aba)', async () => {
    let resolver: (v: unknown) => void = () => undefined
    fetchMock.mockReturnValue(new Promise((r) => (resolver = r)))
    const { refreshSession } = await import('@/lib/auth/session-refresh')

    const tres = Promise.all([refreshSession(), refreshSession(), refreshSession()])
    resolver(okJson(RESPOSTA))
    expect(await tres).toEqual(['access-novo', 'access-novo', 'access-novo'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sem refresh token (backend antigo ou modo local): null, sem chamar a rede', async () => {
    semear({ [REFRESH_TOKEN_STORAGE_KEY]: '' })
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
    const { refreshSession } = await import('@/lib/auth/session-refresh')
    expect(await refreshSession()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('recusa do backend (401): null e nada gravado', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { refreshSession } = await import('@/lib/auth/session-refresh')
    expect(await refreshSession()).toBeNull()
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('access-velho')
  })

  it('rede fora: null (quem chama decide o modal)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { refreshSession } = await import('@/lib/auth/session-refresh')
    expect(await refreshSession()).toBeNull()
  })

  it.each([
    [503, 'indisponivel'],
    [429, 'indisponivel'],
    [500, 'indisponivel'],
    [502, 'indisponivel'],
    [400, 'recusada'],
    [401, 'recusada'],
    [403, 'recusada'],
  ])('renovarSessao classifica %s como %s (availability-1); nada gravado', async (status, tipo) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({}) })
    const { renovarSessao } = await import('@/lib/auth/session-refresh')
    expect(await renovarSessao()).toEqual({ tipo })
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe('access-velho')
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('refresh-velho')
  })

  it('a chamada de renovação leva um timeout (AbortSignal); abortar conta como indisponivel', async () => {
    const { renovarSessao, TIMEOUT_RENOVACAO_MS } = await import('@/lib/auth/session-refresh')
    expect(TIMEOUT_RENOVACAO_MS).toBe(10_000)
    fetchMock.mockRejectedValueOnce(new DOMException('The operation was aborted.', 'TimeoutError'))
    expect(await renovarSessao()).toEqual({ tipo: 'indisponivel' })
    if (typeof AbortSignal.timeout === 'function') {
      expect(fetchMock.mock.calls[0][1].signal).toBeDefined()
    }
  })

  it('renovarSessao: rede fora = indisponivel; sem refresh token = recusada; sucesso = renovada', async () => {
    const { renovarSessao } = await import('@/lib/auth/session-refresh')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await renovarSessao()).toEqual({ tipo: 'indisponivel' })
    fetchMock.mockResolvedValueOnce(okJson(RESPOSTA))
    expect(await renovarSessao()).toEqual({ tipo: 'renovada', token: 'access-novo' })
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY)
    expect(await renovarSessao()).toEqual({ tipo: 'recusada' })
  })

  it('dev-bypass: nenhuma renovação, nenhum storage novo', async () => {
    process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS = 'true'
    localStorage.clear()
    const { refreshSession } = await import('@/lib/auth/session-refresh')
    expect(await refreshSession()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })

  it('usa navigator.locks quando existe (coordenação entre abas)', async () => {
    const request = jest.fn(async (_nome: string, fn: () => Promise<unknown>) => fn())
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    fetchMock.mockResolvedValue(okJson(RESPOSTA))
    const { refreshSession } = await import('@/lib/auth/session-refresh')
    await refreshSession()
    expect(request).toHaveBeenCalledWith('financeiro-auth-refresh', expect.any(Function))
  })

  it('duas abas (duas instâncias do módulo) sob o mesmo lock e storage: UMA chamada; a segunda adota o token', async () => {
    // Lock de verdade, serializando as duas "abas".
    let fila: Promise<unknown> = Promise.resolve()
    const request = (_nome: string, fn: () => Promise<unknown>) => {
      const minha = fila.then(fn)
      fila = minha.catch(() => undefined)
      return minha
    }
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
    fetchMock.mockResolvedValue(okJson(RESPOSTA))

    const abaA = await import('@/lib/auth/session-refresh')
    jest.resetModules()
    const abaB = await import('@/lib/auth/session-refresh')
    expect(abaA).not.toBe(abaB)

    const [a, b] = await Promise.all([abaA.refreshSession(), abaB.refreshSession()])
    expect(a).toBe('access-novo')
    expect(b).toBe('access-novo')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sem navigator.locks: relê o storage e adota o token se outra aba já renovou', async () => {
    const { refreshSession } = await import('@/lib/auth/session-refresh')
    // Outra aba renovou entre o 401 desta e a renovação.
    const pendente = refreshSession(/* tokenQueFalhou */ 'access-velho')
    localStorage.setItem(TOKEN_STORAGE_KEY, 'access-da-outra-aba')
    localStorage.setItem(EXPIRES_AT_STORAGE_KEY, '2100000000')
    expect(await pendente).toBe('access-da-outra-aba')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('avisa os ouvintes da aba quando renova (o AuthProvider troca o token sem efeito visível)', async () => {
    fetchMock.mockResolvedValue(okJson(RESPOSTA))
    const { refreshSession, onSessaoRenovada } = await import('@/lib/auth/session-refresh')
    const ouvinte = jest.fn()
    const sair = onSessaoRenovada(ouvinte)
    await refreshSession()
    expect(ouvinte).toHaveBeenCalledWith({ token: 'access-novo', username: 'fulano' })
    sair()
  })
})

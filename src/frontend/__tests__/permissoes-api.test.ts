/**
 * `lib/permissoes.ts` — permissões do usuário logado (ADR-0053). A fonte é `GET /me/permissoes`,
 * calculada no servidor; o front só esconde o que o servidor já recusaria (I2).
 */

jest.mock('@/lib/auth/token', () => ({
  ...jest.requireActual('@/lib/auth/token'),
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

const emitSessionExpiredMock = jest.fn()
jest.mock('@/lib/auth/session-events', () => ({
  emitSessionExpired: () => emitSessionExpiredMock(),
}))

describe('lib/permissoes', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    emitSessionExpiredMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('o catálogo espelha as permissões do backend (as nove + sispag:excecao, ADR-0060)', async () => {
    const { CATALOGO_PERMISSOES } = await import('@/lib/permissoes')
    expect([...CATALOGO_PERMISSOES].sort()).toEqual(
      [
        'metricas:ver',
        'operacao:ver',
        'permutas:executar',
        'permutas:ver',
        'recebimentos:executar',
        'recebimentos:ver',
        'sispag:excecao',
        'sispag:executar',
        'sispag:ver',
        'usuarios:gerenciar',
      ].sort(),
    )
  })

  it('fetchMinhasPermissoes: GET /me/permissoes com o token; devolve Set e papel', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        permissoes: ['permutas:ver', 'sispag:ver'],
        papel: { id: 2, nome: 'Consulta' },
        operacao: false,
      }),
    })
    const { fetchMinhasPermissoes } = await import('@/lib/permissoes')

    const out = await fetchMinhasPermissoes()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/me\/permissoes$/)
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect([...out.permissoes].sort()).toEqual(['permutas:ver', 'sispag:ver'])
    expect(out.papel).toEqual({ id: 2, nome: 'Consulta' })
  })

  it('valores desconhecidos no array são descartados', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ permissoes: ['permutas:ver', 'fiscal:ver', 42], operacao: false }),
    })
    const { fetchMinhasPermissoes } = await import('@/lib/permissoes')
    expect([...(await fetchMinhasPermissoes()).permissoes]).toEqual(['permutas:ver'])
  })

  it('corpo sem o array (ex.: { operacao } do backend antigo) → conjunto vazio, fail-closed', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ operacao: true }) })
    const { fetchMinhasPermissoes } = await import('@/lib/permissoes')

    const out = await fetchMinhasPermissoes()

    expect(out.permissoes.size).toBe(0)
    expect(out).toEqual({ permissoes: new Set() })
  })

  it('5xx: rejeita (o provider trata como fail-closed)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'x' }) })
    const { fetchMinhasPermissoes } = await import('@/lib/permissoes')
    await expect(fetchMinhasPermissoes()).rejects.toThrow()
  })

  it('erro de rede: rejeita', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { fetchMinhasPermissoes } = await import('@/lib/permissoes')
    await expect(fetchMinhasPermissoes()).rejects.toThrow()
  })

  it('401: segue o caminho do apiFetch (modal de sessão) e rejeita', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { fetchMinhasPermissoes } = await import('@/lib/permissoes')
    await expect(fetchMinhasPermissoes()).rejects.toThrow()
    expect(emitSessionExpiredMock).toHaveBeenCalled()
  })
})

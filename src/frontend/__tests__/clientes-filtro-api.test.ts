/**
 * Cobre as funções de cliente-filtro de `lib/api.ts` (Fase 1): fetch/add/remove
 * + fetchImportadores. O token é mockado.
 */

jest.mock('@/lib/auth/token', () => ({
  ...jest.requireActual('@/lib/auth/token'),
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

describe('lib/api — cliente-filtro', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('fetchClientesFiltro retorna a lista', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ clientes: [{ pesCod: '191', importador: 'INOX-TECH' }] }),
    })
    const { fetchClientesFiltro } = await import('@/lib/api')
    const list = await fetchClientesFiltro()
    expect(list[0].pesCod).toBe('191')
  })

  it('addClienteFiltro faz POST com pesCod + importador', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const { addClienteFiltro } = await import('@/lib/api')
    await addClienteFiltro('191', 'INOX-TECH')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/permutas/cliente-filtro')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ pesCod: '191', importador: 'INOX-TECH' })
  })

  it('removeClienteFiltro faz DELETE pelo pesCod', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const { removeClienteFiltro } = await import('@/lib/api')
    await removeClienteFiltro('191')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/permutas/cliente-filtro/191')
    expect(init.method).toBe('DELETE')
  })

  it('fetchImportadores retorna a lista', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ importadores: [{ pesCod: '191', importador: 'INOX-TECH', qtdAdtos: 290 }] }),
    })
    const { fetchImportadores } = await import('@/lib/api')
    const list = await fetchImportadores()
    expect(list[0].qtdAdtos).toBe(290)
  })

  it('addClienteFiltro lança em erro HTTP', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'x' }) })
    const { addClienteFiltro } = await import('@/lib/api')
    await expect(addClienteFiltro('191')).rejects.toThrow(/API 500/)
  })
})

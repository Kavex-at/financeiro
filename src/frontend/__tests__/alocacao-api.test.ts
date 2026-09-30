/**
 * Cobre as funções de alocação manual de `lib/api.ts` (Fase 2): buscar invoices
 * por processo, criar (incl. 422 → AlocacaoExcedeSaldoError) e remover. Token mockado.
 */

jest.mock('@/lib/auth/token', () => ({
  ...jest.requireActual('@/lib/auth/token'),
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

describe('lib/api — alocação manual', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('buscarInvoicesPorProcesso passa priCod + filCod e retorna a lista', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ invoices: [{ docCod: 'I7', priCod: '510', filCod: 2, temDi: true }] }),
    })
    const { buscarInvoicesPorProcesso } = await import('@/lib/api')
    const list = await buscarInvoicesPorProcesso('510', 2)
    expect(list[0].docCod).toBe('I7')
    expect(fetchMock.mock.calls[0][0]).toContain('/permutas/invoices/buscar?priCod=510&filCod=2')
  })

  it('buscarInvoicesPorProcesso repassa adtoDocCod (exclui o próprio adto do jaAlocado)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ invoices: [] }),
    })
    const { buscarInvoicesPorProcesso } = await import('@/lib/api')
    await buscarInvoicesPorProcesso('510', 2, 'A9')
    expect(fetchMock.mock.calls[0][0]).toContain('adtoDocCod=A9')
  })

  it('criarAlocacao faz POST com o payload', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const { criarAlocacao } = await import('@/lib/api')
    await criarAlocacao('A9', { invoiceDocCod: 'I7', invoicePriCod: '510', valorAlocado: 600 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/permutas/adiantamentos/A9/alocacoes')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toMatchObject({ invoiceDocCod: 'I7', valorAlocado: 600 })
  })

  it('criarAlocacao lança AlocacaoExcedeSaldoError no 422', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'ALOCACAO_EXCEDE_SALDO', message: 'excede' }),
    })
    const { criarAlocacao, AlocacaoExcedeSaldoError } = await import('@/lib/api')
    await expect(
      criarAlocacao('A9', { invoiceDocCod: 'I7', invoicePriCod: '510', valorAlocado: 9999 }),
    ).rejects.toBeInstanceOf(AlocacaoExcedeSaldoError)
  })

  it('removerAlocacao faz DELETE pelo par', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const { removerAlocacao } = await import('@/lib/api')
    await removerAlocacao('A9', 'I7')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/permutas/adiantamentos/A9/alocacoes/I7')
    expect(init.method).toBe('DELETE')
  })
})

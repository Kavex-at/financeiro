/**
 * Cobre as funções da exceção manual "permutado fora do painel" de `lib/api.ts` (ADR-0047):
 * marcar (POST, só a justificativa — o autor sai do token no backend) e desfazer (DELETE).
 * 422/409/404 viram `ExcecaoManualRecusadaError` com a mensagem do backend. Token mockado.
 */

jest.mock('@/lib/auth/token', () => ({
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

describe('lib/api — exceção manual de permuta', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('marcarExcecaoManual faz POST com JSON, auth e SÓ a justificativa (sem autor)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const { marcarExcecaoManual } = await import('@/lib/api')

    await marcarExcecaoManual('8721', 'Baixas cruzadas 21 x 198 em 30/04')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/permutas\/adiantamentos\/8721\/excecao-manual$/)
    expect(init.method).toBe('POST')
    expect(init.headers['content-type']).toBe('application/json')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({ justificativa: 'Baixas cruzadas 21 x 198 em 30/04' })
  })

  it.each([422, 409, 404])(
    'marcarExcecaoManual lança ExcecaoManualRecusadaError com a mensagem do backend no %i',
    async (status) => {
      fetchMock.mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ error: 'EXCECAO_GUARDA_RECUSADA', message: 'Recusado pelo backend.' }),
      })
      const { marcarExcecaoManual, ExcecaoManualRecusadaError } = await import('@/lib/api')

      const erro = await marcarExcecaoManual('8721', 'justificativa válida').catch((e) => e)

      expect(erro).toBeInstanceOf(ExcecaoManualRecusadaError)
      expect(erro.message).toBe('Recusado pelo backend.')
    },
  )

  it('marcarExcecaoManual no 500 lança Error("API 500 …") genérico', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    })
    const { marcarExcecaoManual, ExcecaoManualRecusadaError } = await import('@/lib/api')

    const erro = await marcarExcecaoManual('8721', 'justificativa válida').catch((e) => e)

    expect(erro).not.toBeInstanceOf(ExcecaoManualRecusadaError)
    expect(erro.message).toMatch(/^API 500/)
  })

  it('desfazerExcecaoManual faz DELETE na mesma URL, com docCod codificado', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const { desfazerExcecaoManual } = await import('@/lib/api')

    await desfazerExcecaoManual('87/21')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/permutas\/adiantamentos\/87%2F21\/excecao-manual$/)
    expect(init.method).toBe('DELETE')
    expect(init.headers.Authorization).toBe('Bearer test-token')
  })

  it('desfazerExcecaoManual no 404 lança ExcecaoManualRecusadaError', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'EXCECAO_NAO_ENCONTRADA', message: 'Sem exceção ativa.' }),
    })
    const { desfazerExcecaoManual, ExcecaoManualRecusadaError } = await import('@/lib/api')

    await expect(desfazerExcecaoManual('8721')).rejects.toBeInstanceOf(ExcecaoManualRecusadaError)
  })
})

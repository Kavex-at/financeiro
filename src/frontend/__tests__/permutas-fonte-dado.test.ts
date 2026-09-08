/**
 * A regra implícita de um painel financeiro é "o que está na tela é o que está
 * no banco". `fetchGestaoPermutas` a quebrava em silêncio: devolvia
 * `gestaoPermutasFixture` (227 linhas de dados reais sondados — nomes de
 * clientes e valores em USD) tanto quando o backend caía quanto quando ele
 * respondia uma carteira LEGITIMAMENTE VAZIA.
 *
 * O segundo caminho é o que disparava no dia a dia: "zero pendentes" é um
 * estado correto e desejável do domínio, e era substituído por linhas fantasma.
 *
 * Estes testes fixam a separação dos três casos — vazio legítimo, falha, e
 * demo explícito — e que o fixture só existe atrás de `NEXT_PUBLIC_DEMO_MODE`.
 */

jest.mock('@/lib/auth/token', () => ({
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

const respostaVazia = {
  fonte: 'banco',
  geradoEm: '2026-09-08T10:00:00.000Z',
  pendentes: [],
  invoicesEmAberto: [],
  casamentos: [],
}

const respostaComDado = {
  fonte: 'banco',
  geradoEm: '2026-09-08T10:00:00.000Z',
  pendentes: [{ docCod: '1', filCod: 2, status: 'elegivel' }],
  invoicesEmAberto: [],
  casamentos: [],
}

describe('lib/api — fetchGestaoPermutas: fonte do dado', () => {
  const fetchMock = jest.fn()
  const envOriginal = process.env

  beforeEach(() => {
    jest.resetModules()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
    process.env = { ...envOriginal, NEXT_PUBLIC_ENV: 'local' }
    delete process.env.NEXT_PUBLIC_DEMO_MODE
  })

  afterAll(() => {
    process.env = envOriginal
  })

  it('mapeia a resposta do backend como fonte "banco"', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => respostaComDado })
    const { fetchGestaoPermutas } = await import('@/lib/api')

    const r = await fetchGestaoPermutas()

    expect(r.fonte).toBe('banco')
    expect(r.pendentes).toHaveLength(1)
  })

  it('carteira legitimamente vazia continua sendo "banco" e continua vazia', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => respostaVazia })
    const { fetchGestaoPermutas } = await import('@/lib/api')

    const r = await fetchGestaoPermutas()

    expect(r.fonte).toBe('banco')
    expect(r.pendentes).toEqual([])
    expect(r.invoicesEmAberto).toEqual([])
    expect(r.totais.pendentes).toBe(0)
    expect(r.totais.elegiveis).toBe(0)
  })

  it('erro HTTP LANÇA em vez de devolver o fixture', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    })
    const { fetchGestaoPermutas } = await import('@/lib/api')

    await expect(fetchGestaoPermutas()).rejects.toThrow(/API 500/)
  })

  it('falha de rede LANÇA em vez de devolver o fixture', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { fetchGestaoPermutas } = await import('@/lib/api')

    await expect(fetchGestaoPermutas()).rejects.toThrow(/Failed to fetch/)
  })

  it('sessão expirada (401) propaga, em vez de virar fixture', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { fetchGestaoPermutas } = await import('@/lib/api')
    const { SessionExpiredError } = await import('@/lib/http')

    await expect(fetchGestaoPermutas()).rejects.toBeInstanceOf(SessionExpiredError)
  })

  describe('com NEXT_PUBLIC_DEMO_MODE=true', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    })

    it('cai no fixture quando o backend falha, e se identifica como "fixture"', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      const { fetchGestaoPermutas } = await import('@/lib/api')

      const r = await fetchGestaoPermutas()

      expect(r.fonte).toBe('fixture')
      expect(r.pendentes.length).toBeGreaterThan(0)
    })

    it('cai no fixture quando a carteira vem vazia', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => respostaVazia })
      const { fetchGestaoPermutas } = await import('@/lib/api')

      const r = await fetchGestaoPermutas()

      expect(r.fonte).toBe('fixture')
    })
  })
})

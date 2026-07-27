import {
  computeKpis,
  fetchPainelRecebimentos,
  recebimentosPainelFixture,
  type NotaDebitoEletronica,
  type Recebimento,
  type TransacaoBancaria,
} from '@/lib/recebimentos'

// `apiFetch` é o boundary HTTP — mockado para exercitar o fallback de fixture.
jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))

import { apiFetch } from '@/lib/http'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

describe('computeKpis', () => {
  it('deriva contadores por status + Σ não alocado + NDe pendentes', () => {
    const transacoes = [
      { status: 'importada' },
      { status: 'importada' },
      { status: 'conciliada' },
      { status: 'parcial' },
      { status: 'manual' },
      { status: 'erro' },
    ] as TransacaoBancaria[]
    const recebimentos = [
      { diferencaNaoAlocada: 3000 },
      { diferencaNaoAlocada: 500 },
    ] as Recebimento[]
    const ndes = [
      { statusEmissao: 'pendente' },
      { statusEmissao: 'emitida' },
    ] as NotaDebitoEletronica[]

    expect(computeKpis(transacoes, recebimentos, ndes)).toEqual({
      importadas: 2,
      conciliadas: 1,
      parciais: 1,
      filaManual: 1,
      erro: 1,
      valorNaoAlocado: 3500,
      ndePendentes: 1,
    })
  })
})

describe('fetchPainelRecebimentos', () => {
  afterEach(() => jest.clearAllMocks())

  it('cai no fixture quando o backend devolve o stub vazio', async () => {
    mockApiFetch.mockResolvedValue(okJson({ geradoEm: 'x', recebimentos: [], kpis: {} }))
    const painel = await fetchPainelRecebimentos()
    expect(painel.fonte).toBe('fixture')
    expect(painel.transacoes.length).toBe(recebimentosPainelFixture.transacoes.length)
  })

  it('cai no fixture quando o backend erra (rede/HTTP)', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'))
    const painel = await fetchPainelRecebimentos()
    expect(painel.fonte).toBe('fixture')
  })

  it('usa o backend quando há transações reais', async () => {
    const transacoes = [
      {
        id: 'txn-real',
        correlationId: 'corr-real',
        filCod: 4,
        dataMovimento: '2026-07-20T00:00:00.000Z',
        tipo: 'CREDITO',
        valor: 100,
        moeda: 'BRL',
        naturalKey: 'k',
        status: 'importada',
        importadoEm: '2026-07-20T00:00:00.000Z',
      },
    ]
    mockApiFetch.mockResolvedValue(okJson({ geradoEm: 'g', transacoes, recebimentos: [], ndes: [] }))
    const painel = await fetchPainelRecebimentos()
    expect(painel.fonte).toBe('banco')
    expect(painel.transacoes).toHaveLength(1)
    expect(painel.kpis.importadas).toBe(1)
  })
})

describe('fixture', () => {
  it('exercita todos os status de transação (para a review ver cada chip)', () => {
    const statuses = new Set(recebimentosPainelFixture.transacoes.map((t) => t.status))
    expect(statuses).toEqual(new Set(['importada', 'conciliada', 'parcial', 'manual', 'erro']))
  })
})

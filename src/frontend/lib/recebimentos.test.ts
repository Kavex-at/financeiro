import {
  computeKpis,
  fetchPainelRecebimentos,
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
  recebimentosPainelFixture,
  SOLICITACAO_NUMERARIO_GCD_DES_NOME,
  type NotaDebitoEletronica,
  type Processo,
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

  it('lista vazia é lista vazia — não vira demonstração', async () => {
    // O early-return "vazio → fixture" sequestrava qualquer resposta legítima:
    // um banco de verdade sem créditos aparecia como dados de demonstração.
    mockApiFetch.mockResolvedValue(okJson({ geradoEm: 'x', transacoes: [], kpis: {} }))
    const painel = await fetchPainelRecebimentos()
    expect(painel.fonte).toBe('banco')
    expect(painel.transacoes).toEqual([])
  })

  it('erro do backend PROPAGA — a página tem estado de erro para isso', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'))
    await expect(fetchPainelRecebimentos()).rejects.toThrow('network')
  })

  it('propaga o ultimaIngestao e o truncado do backend', async () => {
    mockApiFetch.mockResolvedValue(
      okJson({
        geradoEm: 'x',
        transacoes: [],
        kpis: {},
        ultimaIngestao: '2026-07-30T12:00:00.000Z',
        truncado: true,
      }),
    )
    const painel = await fetchPainelRecebimentos()
    expect(painel.ultimaIngestao).toBe('2026-07-30T12:00:00.000Z')
    expect(painel.truncado).toBe(true)
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

const processoSample: Processo = {
  priCod: 90001,
  priEspRefcliente: 'REF-CLI-0001',
  filCod: 4,
  pesCod: 555,
  dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
  moeCod: 790,
  valor: 15000,
  contraparte: 'CLIENTE EXEMPLO LTDA',
}

describe('fetchProcessosParaTransacao — fixture fallback', () => {
  afterEach(() => jest.clearAllMocks())

  it('usa o backend quando responde com processos', async () => {
    mockApiFetch.mockResolvedValue(okJson({ processos: [processoSample] }))
    const out = await fetchProcessosParaTransacao('txn-1', 4)
    expect(out).toHaveLength(1)
    expect(out[0].priCod).toBe(90001)
  })

  it('erro PROPAGA — backend fora do ar não pode virar lista de demonstração', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'))
    await expect(fetchProcessosParaTransacao('txn-1', 4)).rejects.toThrow('network')
  })

  it('manda o pesCod na query quando o cliente foi escolhido', async () => {
    mockApiFetch.mockResolvedValue(okJson({ processos: [] }))
    await fetchProcessosParaTransacao('txn-1', 4, 676)
    const [url] = mockApiFetch.mock.calls[0]
    expect(String(url)).toContain('filCod=4')
    expect(String(url)).toContain('pesCod=676')
  })
})

describe('processarSolicitacaoNumerario — dry-run (nunca envia ao ERP)', () => {
  afterEach(() => jest.clearAllMocks())

  it('usa o payload do backend quando disponível', async () => {
    const backendPayload = {
      dryRun: true,
      docConfig: { gcdCod: 42, gcdDesNome: SOLICITACAO_NUMERARIO_GCD_DES_NOME },
      payload: { filCod: 4, priCod: 90001, valor: 15000, gcdDesNome: SOLICITACAO_NUMERARIO_GCD_DES_NOME },
    }
    mockApiFetch.mockResolvedValue(okJson(backendPayload))
    const out = await processarSolicitacaoNumerario('txn-1', processoSample, 15000)
    expect(out.dryRun).toBe(true)
    expect(out.docConfig.gcdCod).toBe(42)
    expect(out.payload.valor).toBe(15000)
  })

  it('erro PROPAGA — nada de payload inventado no navegador', async () => {
    // O fallback local mostrava um documento que o backend NUNCA teria montado,
    // com toast verde de sucesso. Pior que um erro.
    mockApiFetch.mockRejectedValue(new Error('network'))
    await expect(
      processarSolicitacaoNumerario('txn-1', processoSample, 27890.55),
    ).rejects.toThrow('network')
  })

  it('resposta incompleta do backend também falha', async () => {
    mockApiFetch.mockResolvedValue(okJson({ dryRun: true }))
    await expect(
      processarSolicitacaoNumerario('txn-1', processoSample, 27890.55),
    ).rejects.toThrow(/payload/i)
  })
})

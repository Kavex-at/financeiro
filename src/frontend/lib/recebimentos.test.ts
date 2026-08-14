import {
  computeKpis,
  fetchPainelRecebimentos,
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
  recebimentosPainelFixture,
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
      processadas: 0,
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
    expect(statuses).toEqual(
      new Set(['importada', 'conciliada', 'parcial', 'manual', 'erro', 'processada']),
    )
  })

  it('cobre os dois tipos de falha da aba Falhas (ADR-0034)', () => {
    const falhas = recebimentosPainelFixture.transacoes
      .map((t) => t.ultimaFalha)
      .filter((f): f is NonNullable<typeof f> => f !== undefined)

    // Falha registrada: tem mensagem amigável, e NUNCA payload cru do ERP (a aba não é admin-only).
    const registrada = falhas.find((f) => !f.interrompida)
    expect(registrada?.mensagem).toBeTruthy()
    expect(registrada).not.toHaveProperty('erpResponse')

    // Interrompida: parou no meio, então não há mensagem — o risco é documento órfão no Conexos.
    const interrompida = falhas.find((f) => f.interrompida)
    expect(interrompida?.mensagem).toBeUndefined()
    expect(interrompida?.docCod).toBeDefined()
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
    const out = await fetchProcessosParaTransacao('txn-1', 555)
    expect(out).toHaveLength(1)
    expect(out[0].priCod).toBe(90001)
  })

  it('erro PROPAGA — backend fora do ar não pode virar lista de demonstração', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'))
    await expect(fetchProcessosParaTransacao('txn-1', 555)).rejects.toThrow('network')
  })

  it('manda o pesCod na query quando o cliente foi escolhido — sem filCod (multi-filial)', async () => {
    mockApiFetch.mockResolvedValue(okJson({ processos: [] }))
    await fetchProcessosParaTransacao('txn-1', 676)
    const [url] = mockApiFetch.mock.calls[0]
    // Multi-filial: a rota resolve as filiais acessíveis no backend, o FE não manda filCod.
    expect(String(url)).not.toContain('filCod')
    expect(String(url)).toContain('pesCod=676')
  })
})

describe('processarSolicitacaoNumerario — alocação REAL', () => {
  afterEach(() => jest.clearAllMocks())

  const allocation = {
    priCod: 90001,
    valor: 15000,
    filCod: 7,
    priEspRefcliente: 'REF-CLI-0001',
    pesCod: 555,
    dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
    moeCod: 790,
  }

  it('envia só os campos da alocação e devolve o resultado do backend', async () => {
    mockApiFetch.mockResolvedValue(
      okJson({ status: 'settled', snDocCod: 18202, borCod: 771, ndDocCod: 18337, dryRun: false }),
    )
    const out = await processarSolicitacaoNumerario('txn-1', allocation)
    expect(out.status).toBe('settled')
    expect(out.snDocCod).toBe(18202)
    expect(out.dryRun).toBe(false)
    const [, init] = mockApiFetch.mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body).toEqual({
      priCod: 90001,
      valor: 15000,
      filCod: 7,
      priEspRefcliente: 'REF-CLI-0001',
      pesCod: 555,
      dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
      moeCod: 790,
    })
  })

  it('propaga o status de erro do backend (HTTP 200 carrega o desfecho)', async () => {
    mockApiFetch.mockResolvedValue(
      okJson({ status: 'error', etapa: 'fin014', erro: 'baixa recusada', dryRun: false }),
    )
    const out = await processarSolicitacaoNumerario('txn-1', allocation)
    expect(out.status).toBe('error')
    expect(out.etapa).toBe('fin014')
  })

  it('erro de rede PROPAGA — nada de sucesso inventado no navegador', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'))
    await expect(processarSolicitacaoNumerario('txn-1', allocation)).rejects.toThrow('network')
  })

  it('resposta sem status também falha', async () => {
    mockApiFetch.mockResolvedValue(okJson({ dryRun: false }))
    await expect(processarSolicitacaoNumerario('txn-1', allocation)).rejects.toThrow(/status/i)
  })
})

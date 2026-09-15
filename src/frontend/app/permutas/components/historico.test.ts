import type {
  AlocacaoDetalhe,
  CasamentoSugerido,
  PermutaBorderoVinculo,
  PermutaPendente,
} from '@/lib/types'
import { montarHistorico } from './historico'

/**
 * Aba Histórico (ADR-0046 D4). Com a prioridade dos motivos e a tolerância de resíduo, adtos já
 * permutados pelo painel migram para `ja-permutado` — e saíam do Histórico, que só olhava as 4
 * categorias de trabalho. `montarHistorico` também lista os `ja-permutado` com borderô, sem duplicar.
 */
const vinculo = (borCod: number, finalizado = true): PermutaBorderoVinculo => ({
  borCod,
  permutaStatus: finalizado ? 'finalizado' : 'aguardando-finalizacao',
  situacao: finalizado ? 'FINALIZADO' : 'EM_CADASTRO',
})

const alocacao = (over: Partial<AlocacaoDetalhe> = {}): AlocacaoDetalhe => ({
  invoiceDocCod: 'INV1',
  valorAlocado: 100,
  criadoEm: '2026-09-01T10:00:00Z',
  ...over,
})

const pendente = (over: Partial<PermutaPendente> = {}): PermutaPendente =>
  ({
    docCod: 'A1',
    filCod: 2,
    referencia: 'REF',
    exportador: 'EXP',
    importador: 'INOX-TECH',
    valorMoedaNegociada: 5000,
    moeda: 'USD',
    diasEmAberto: null,
    status: 'permuta-manual',
    detalhe: { priCod: '1153' },
    ...over,
  }) as PermutaPendente

const casamento = (docCod: string, valorASerUsado: number): CasamentoSugerido =>
  ({
    priCod: '2048',
    invoice: {
      docCod: 'I1',
      filCod: 2,
      referencia: 'INV/1',
      exportador: 'DBP',
      importador: 'CLIENTE-AUTO',
      valorMoedaNegociada: 1000,
      moeda: 'USD',
      priCod: '2048',
    },
    adiantamentos: [{ docCod, referencia: 'R', valorASerUsado, moeda: 'USD' }],
  }) as unknown as CasamentoSugerido

const vazio = {
  casamentosSugeridos: [] as CasamentoSugerido[],
  multiplasManuais: [] as PermutaPendente[],
  crossOver: [] as PermutaPendente[],
  crossProcess: [] as PermutaPendente[],
  jaPermutados: [] as PermutaPendente[],
  statusPorAdto: {} as Record<string, PermutaBorderoVinculo>,
  pendenteByDocCod: new Map<string, PermutaPendente>(),
}

describe('montarHistorico', () => {
  it('paridade: as 4 categorias de hoje saem idênticas (chave, tipo, valor, ordem)', () => {
    const mult = pendente({
      docCod: 'M1',
      status: 'casamento-manual',
      alocacoes: [alocacao({ valorAlocado: 300 }), alocacao({ valorAlocado: 200 })],
    })
    const co = pendente({ docCod: 'C1', status: 'casamento-manual', importador: undefined })
    const cp = pendente({ docCod: 'P1', alocacoes: [alocacao({ valorAlocado: 700 })] })
    const itens = montarHistorico({
      ...vazio,
      casamentosSugeridos: [casamento('S1', 900)],
      multiplasManuais: [mult],
      crossOver: [co],
      crossProcess: [cp],
      statusPorAdto: {
        S1: vinculo(10),
        M1: vinculo(40, false),
        C1: vinculo(30),
        P1: vinculo(20),
      },
    })
    expect(itens).toEqual([
      // aguardando aprovação no topo...
      {
        key: 'Múltipla-M1-40',
        tipo: 'Múltipla',
        filCod: 2,
        priCod: '1153',
        cliente: 'INOX-TECH',
        exportador: 'EXP',
        adtoDocCod: 'M1',
        valor: 500,
        moeda: 'USD',
        borCod: 40,
        finalizado: false,
        busca: 'M1 INOX-TECH 40',
      },
      // ...finalizadas embaixo, borderô mais recente primeiro.
      {
        key: 'Cross-over-C1-30',
        tipo: 'Cross-over',
        filCod: 2,
        priCod: '1153',
        cliente: '',
        exportador: 'EXP',
        adtoDocCod: 'C1',
        valor: 5000,
        moeda: 'USD',
        borCod: 30,
        finalizado: true,
        busca: 'C1  30',
      },
      {
        key: 'Cross-process-P1-20',
        tipo: 'Cross-process',
        filCod: 2,
        priCod: '1153',
        cliente: 'INOX-TECH',
        exportador: 'EXP',
        adtoDocCod: 'P1',
        valor: 700,
        moeda: 'USD',
        borCod: 20,
        finalizado: true,
        busca: 'P1 INOX-TECH 20',
      },
      {
        key: 'auto-S1-10',
        tipo: 'Automática',
        filCod: 2,
        priCod: '2048',
        cliente: 'CLIENTE-AUTO',
        exportador: 'DBP',
        adtoDocCod: 'S1',
        valor: 900,
        moeda: 'USD',
        borCod: 10,
        finalizado: true,
        busca: '2048 CLIENTE-AUTO S1 10',
      },
    ])
  })

  it('automática finalizada (valorASerUsado 0) cai no valor negociado do próprio adto', () => {
    const itens = montarHistorico({
      ...vazio,
      casamentosSugeridos: [casamento('S1', 0)],
      statusPorAdto: { S1: vinculo(10) },
      pendenteByDocCod: new Map([['S1', pendente({ docCod: 'S1', valorMoedaNegociada: 1234 })]]),
    })
    expect(itens[0].valor).toBe(1234)
  })

  it('ja-permutado COM borderô → 1 item com borCod, situação, cliente, processo e Σ alocado', () => {
    const jp = pendente({
      docCod: 'J1',
      status: 'ja-permutado',
      alocacoes: [alocacao({ valorAlocado: 600 }), alocacao({ valorAlocado: 400 })],
    })
    const itens = montarHistorico({
      ...vazio,
      jaPermutados: [jp],
      statusPorAdto: { J1: vinculo(55, false) },
    })
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({
      adtoDocCod: 'J1',
      borCod: 55,
      finalizado: false,
      cliente: 'INOX-TECH',
      priCod: '1153',
      valor: 1000,
      tipo: 'Já permutado',
    })
  })

  it('ja-permutado SEM alocações cai no valor negociado do adto', () => {
    const itens = montarHistorico({
      ...vazio,
      jaPermutados: [pendente({ docCod: 'J1', status: 'ja-permutado', valorMoedaNegociada: 777 })],
      statusPorAdto: { J1: vinculo(55) },
    })
    expect(itens[0].valor).toBe(777)
  })

  it('ja-permutado SEM borderô do painel não aparece', () => {
    const itens = montarHistorico({
      ...vazio,
      jaPermutados: [pendente({ docCod: 'J1', status: 'ja-permutado' })],
    })
    expect(itens).toEqual([])
  })

  it('tipo Cross-process quando alguma alocação é de OUTRO processo; senão "Já permutado"', () => {
    const outroProcesso = pendente({
      docCod: 'J1',
      status: 'ja-permutado',
      alocacoes: [alocacao({ invoicePriCod: '1153' }), alocacao({ invoicePriCod: '510' })],
    })
    const mesmoProcesso = pendente({
      docCod: 'J2',
      status: 'ja-permutado',
      alocacoes: [alocacao({ invoicePriCod: '1153' })],
    })
    const itens = montarHistorico({
      ...vazio,
      jaPermutados: [outroProcesso, mesmoProcesso],
      statusPorAdto: { J1: vinculo(2), J2: vinculo(1) },
    })
    expect(itens.find((h) => h.adtoDocCod === 'J1')?.tipo).toBe('Cross-process')
    expect(itens.find((h) => h.adtoDocCod === 'J2')?.tipo).toBe('Já permutado')
  })

  it('dedupe: mesmo adto+borderô vindo de cross-process e de ja-permutado gera 1 item', () => {
    const cp = pendente({ docCod: 'P1', alocacoes: [alocacao({ valorAlocado: 700 })] })
    const jp = { ...cp, status: 'ja-permutado' as const }
    const itens = montarHistorico({
      ...vazio,
      crossProcess: [cp],
      jaPermutados: [jp],
      statusPorAdto: { P1: vinculo(20) },
    })
    expect(itens).toHaveLength(1)
    expect(itens[0].tipo).toBe('Cross-process')
  })

  it('dedupe: mesmo adto+borderô vindo de automática e de ja-permutado gera 1 item', () => {
    const itens = montarHistorico({
      ...vazio,
      casamentosSugeridos: [casamento('S1', 900)],
      jaPermutados: [pendente({ docCod: 'S1', status: 'ja-permutado' })],
      statusPorAdto: { S1: vinculo(10) },
    })
    expect(itens).toHaveLength(1)
    expect(itens[0].tipo).toBe('Automática')
  })

  it('automática com o MESMO adto em 2 invoices → 1 item, valor = Σ usado, chave única', () => {
    const itens = montarHistorico({
      ...vazio,
      casamentosSugeridos: [casamento('S1', 600), casamento('S1', 400)],
      statusPorAdto: { S1: vinculo(10) },
    })
    expect(itens).toHaveLength(1)
    expect(itens[0].valor).toBe(1000)
    expect(itens[0].key).toBe('auto-S1-10')
  })

  it('chaves únicas no conjunto inteiro (sem warning de key duplicada do React)', () => {
    const cp = pendente({ docCod: 'P1' })
    const itens = montarHistorico({
      ...vazio,
      casamentosSugeridos: [casamento('S1', 1), casamento('S1', 2)],
      crossProcess: [cp],
      jaPermutados: [
        { ...cp, status: 'ja-permutado' },
        pendente({ docCod: 'J9', status: 'ja-permutado' }),
      ],
      statusPorAdto: { S1: vinculo(10), P1: vinculo(20), J9: vinculo(30) },
    })
    const keys = itens.map((h) => h.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(itens).toHaveLength(3)
  })
})

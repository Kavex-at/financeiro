import { DONO_PAGAMENTO, MOTIVO_PAGAMENTO } from '@/lib/sispag'
import { RESUMO_FIXTURE, TITULOS_FIXTURE } from '../__fixtures__/situacaoPagamento'
import {
  aplicarFiltros,
  bloqueadosQueVencemHoje,
  contarFiltrosDeColuna,
  ehBloqueado,
  ehPronto,
  FILTROS_VAZIOS,
  faixaDeVencimento,
  haFiltroAtivo,
  ordenarTitulos,
  prontosPorFilial,
  rotuloSituacao,
  SITUACAO_PRONTO,
  situacaoChave,
  somar,
  totaisPorEstado,
  bloqueadosPorMotivo,
  vencemEmAteDoisDias,
} from './situacaoTitulos'

const docs = (ts: typeof TITULOS_FIXTURE) => ts.map((t) => t.docCod)
const com = (parcial: Partial<typeof FILTROS_VAZIOS>) => ({ ...FILTROS_VAZIOS, ...parcial })

describe('fixture da carteira', () => {
  it('bate com o resumo: 9 prontos e 9 bloqueados', () => {
    expect(TITULOS_FIXTURE.filter(ehPronto)).toHaveLength(9)
    expect(TITULOS_FIXTURE.filter(ehBloqueado)).toHaveLength(9)
    expect(RESUMO_FIXTURE.porEstado.PRONTO.qtd).toBe(9)
    expect(RESUMO_FIXTURE.porEstado.BLOQUEADO.qtd).toBe(9)
  })
})

describe('faixaDeVencimento (dia civil)', () => {
  it.each([
    [undefined, undefined],
    [-4, 'VENCIDO'],
    [-1, 'VENCIDO'],
    [0, 'HOJE'],
    [1, '1-2'],
    [2, '1-2'],
    [3, '3-7'],
    [7, '3-7'],
    [8, '8+'],
  ] as const)('%s dias → %s', (dias, faixa) => {
    expect(faixaDeVencimento(dias)).toBe(faixa)
  })
})

describe('filtro externo (estado)', () => {
  it('prontos e bloqueados particionam a carteira', () => {
    const p = aplicarFiltros(TITULOS_FIXTURE, com({ estado: 'prontos' }))
    const b = aplicarFiltros(TITULOS_FIXTURE, com({ estado: 'bloqueados' }))
    expect(p.length + b.length).toBe(TITULOS_FIXTURE.length)
    expect(p.every(ehPronto)).toBe(true)
    expect(b.every(ehBloqueado)).toBe(true)
  })

  it('título sem situação (backend antigo) só aparece em "todos"', () => {
    const sem = { ...TITULOS_FIXTURE[0], situacaoPagamento: undefined }
    expect(aplicarFiltros([sem], com({ estado: 'todos' }))).toHaveLength(1)
    expect(aplicarFiltros([sem], com({ estado: 'prontos' }))).toHaveLength(0)
    expect(aplicarFiltros([sem], com({ estado: 'bloqueados' }))).toHaveLength(0)
  })
})

describe('filtros por coluna', () => {
  it('credor ignora acento e caixa', () => {
    expect(docs(aplicarFiltros(TITULOS_FIXTURE, com({ credor: 'armazens' })))).toEqual(['5541'])
    expect(docs(aplicarFiltros(TITULOS_FIXTURE, com({ credor: 'logistica' }))).sort()).toEqual([
      '5502',
    ])
  })

  it('documento casa doc/título', () => {
    expect(docs(aplicarFiltros(TITULOS_FIXTURE, com({ documento: '5544/1' })))).toEqual(['5544'])
  })

  it('valor: de e até, inclusive; vírgula decimal', () => {
    const r = aplicarFiltros(TITULOS_FIXTURE, com({ valorMin: '10000', valorMax: '15300' }))
    expect(docs(r).sort()).toEqual(['5298', '5521', '5534'])
    expect(aplicarFiltros(TITULOS_FIXTURE, com({ valorMin: '462,49', valorMax: '462,49' }))).toHaveLength(1)
  })

  it('vencimento por faixa: vencidos e hoje', () => {
    expect(docs(aplicarFiltros(TITULOS_FIXTURE, com({ faixas: ['VENCIDO'] }))).sort()).toEqual([
      '5298',
      '5311',
    ])
    expect(docs(aplicarFiltros(TITULOS_FIXTURE, com({ faixas: ['HOJE'] }))).sort()).toEqual([
      '5502',
      '5521',
      '5544',
    ])
  })

  it('vencimento por período De/Até (dia civil ERP, inclusive)', () => {
    const r = aplicarFiltros(TITULOS_FIXTURE, com({ vencDe: '2026-10-20', vencAte: '2026-10-21' }))
    expect(docs(r).sort()).toEqual(['5502', '5521', '5544', '5549'])
  })

  it('forma de pagamento usa a chave da coluna (boleto com/sem DDA)', () => {
    const semDda = aplicarFiltros(TITULOS_FIXTURE, com({ formas: ['boleto-sem-dda'] }))
    expect(docs(semDda).sort()).toEqual(['5544', '5549'])
    const ted = aplicarFiltros(TITULOS_FIXTURE, com({ formas: ['forma-8'] }))
    expect(docs(ted).sort()).toEqual(['5298', '5534', '5537', '5562'])
  })

  it('situação: Pronto e motivos compartilham a mesma seleção', () => {
    const r = aplicarFiltros(
      TITULOS_FIXTURE,
      com({ situacoes: [MOTIVO_PAGAMENTO.VENCIDO, SITUACAO_PRONTO] }),
    )
    expect(r).toHaveLength(9 + 2)
  })

  it('dono e filial', () => {
    expect(
      aplicarFiltros(TITULOS_FIXTURE, com({ donos: [DONO_PAGAMENTO.APROVADOR] })).map((t) => t.docCod),
    ).toEqual(['5590'])
    expect(aplicarFiltros(TITULOS_FIXTURE, com({ filiais: [3] }))).toHaveLength(4)
  })

  it('filtros se somam (E)', () => {
    const r = aplicarFiltros(
      TITULOS_FIXTURE,
      com({ estado: 'bloqueados', faixas: ['HOJE'], donos: [DONO_PAGAMENTO.VOCE] }),
    )
    expect(docs(r).sort()).toEqual(['5502', '5544'])
  })
})

describe('contagem e estado dos filtros', () => {
  it('sem filtro: zero e inativo', () => {
    expect(contarFiltrosDeColuna(FILTROS_VAZIOS)).toBe(0)
    expect(haFiltroAtivo(FILTROS_VAZIOS)).toBe(false)
  })
  it('faixa e período contam como UM filtro da coluna Vencimento', () => {
    expect(contarFiltrosDeColuna(com({ faixas: ['HOJE'], vencDe: '2026-10-20' }))).toBe(1)
  })
  it('só o estado externo já é filtro ativo, mas não é filtro de coluna', () => {
    const f = com({ estado: 'bloqueados' })
    expect(haFiltroAtivo(f)).toBe(true)
    expect(contarFiltrosDeColuna(f)).toBe(0)
  })
})

describe('ordenação', () => {
  it('vencimento crescente por padrão: vencidos primeiro', () => {
    const r = ordenarTitulos(TITULOS_FIXTURE, { coluna: 'vencimento', direcao: 1 })
    expect(docs(r).slice(0, 2)).toEqual(['5311', '5298'])
  })
  it('valor decrescente', () => {
    const r = ordenarTitulos(TITULOS_FIXTURE, { coluna: 'valor', direcao: -1 })
    expect(r[0].docCod).toBe('5570')
    expect(r.at(-1)?.docCod).toBe('116')
  })
  it('credor ignora acento (ARMAZÉNS antes de CEVA)', () => {
    const r = ordenarTitulos(TITULOS_FIXTURE, { coluna: 'credor', direcao: 1 })
    expect(r[0].credor).toBe('ARMAZÉNS ATLAS')
  })
  it('situação: Pronto antes de qualquer bloqueio, na ordem de prioridade do contrato', () => {
    const r = ordenarTitulos(TITULOS_FIXTURE, { coluna: 'situacao', direcao: 1 })
    const chaves = r.map(situacaoChave)
    expect(chaves.indexOf(SITUACAO_PRONTO)).toBe(0)
    expect(chaves.lastIndexOf(SITUACAO_PRONTO)).toBe(8)
    expect(chaves[9]).toBe(MOTIVO_PAGAMENTO.ALCADA)
  })
  it('não muta a lista original', () => {
    const copia = [...TITULOS_FIXTURE]
    ordenarTitulos(TITULOS_FIXTURE, { coluna: 'valor', direcao: 1 })
    expect(TITULOS_FIXTURE).toEqual(copia)
  })
  it('empate é estável pela chave do título', () => {
    const r = ordenarTitulos(TITULOS_FIXTURE, { coluna: 'filial', direcao: 1 })
    expect(r[0].filCod).toBe(1)
    const fil1 = r.filter((t) => t.filCod === 1).map((t) => Number(t.docCod))
    expect(fil1).toEqual([...fil1].sort((a, b) => a - b))
  })
})

describe('recortes dos cards', () => {
  it('faixa vermelha: só bloqueados que vencem HOJE, vencidos de fora, maior valor primeiro', () => {
    const r = bloqueadosQueVencemHoje(TITULOS_FIXTURE)
    expect(docs(r)).toEqual(['5502', '5544'])
    expect(r.some((t) => (t.diasAteVencimento ?? 1) < 0)).toBe(false)
  })
  it('vencem em até 2 dias: 0, 1 e 2; vencidos não entram', () => {
    const r = vencemEmAteDoisDias(TITULOS_FIXTURE)
    expect(docs(r).sort()).toEqual(['116', '5502', '5521', '5544', '5549'])
  })
  it('somar', () => {
    expect(somar(TITULOS_FIXTURE.filter(ehPronto))).toEqual({
      qtd: 9,
      valor: 462.49 + 12840 + 8210.35 + 15300 + 6120.8 + 9840 + 21700 + 780 + 34500,
    })
  })
  it('prévia dos automáticos: só PRONTO a vencer em até 7 dias, por filial, sem título já em lote', () => {
    expect(prontosPorFilial(TITULOS_FIXTURE).map((x) => [x.filCod, x.qtd])).toEqual([
      [1, 4],
      [7, 3],
    ])
    const comLote = TITULOS_FIXTURE.map((t) =>
      t.docCod === '5570' ? { ...t, loteRascunho: { id: 'x', automatico: true } } : t,
    )
    const r = prontosPorFilial(comLote)
    expect(r.find((x) => x.filCod === 7)?.qtd).toBe(2)
    expect(r.reduce((acc, x) => acc + x.qtd, 0)).toBe(6)
  })
  it('totais por estado e motivos presentes, na ordem do contrato', () => {
    const t = totaisPorEstado(TITULOS_FIXTURE)
    expect([t.todos.qtd, t.prontos.qtd, t.bloqueados.qtd]).toEqual([18, 9, 9])
    expect(bloqueadosPorMotivo(TITULOS_FIXTURE).map((m) => [m.motivo, m.qtd])).toEqual([
      ['ALCADA', 1],
      ['TIPO_PERMUTA', 1],
      ['VENCIDO', 2],
      ['FORMA_NAO_SISPAG', 1],
      ['DUPLICIDADE', 1],
      ['AJUSTE_CENTAVOS_PENDENTE', 1],
      ['BOLETO_SEM_DDA', 2],
    ])
  })
})

describe('rotuloSituacao', () => {
  it('Pronto e o rótulo do backend', () => {
    expect(rotuloSituacao(TITULOS_FIXTURE[0])).toBe('Pronto')
    expect(rotuloSituacao(TITULOS_FIXTURE.find((t) => t.docCod === '5590') as never)).toBe(
      'Aguardando aprovação',
    )
  })
  it('sem situação (backend antigo) não quebra', () => {
    expect(rotuloSituacao({ ...TITULOS_FIXTURE[0], situacaoPagamento: undefined })).toBe('Pronto')
  })
})

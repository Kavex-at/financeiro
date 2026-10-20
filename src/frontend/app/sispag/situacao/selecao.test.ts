import { TITULOS_FIXTURE } from '../__fixtures__/situacaoPagamento'
import {
  alternarTodosSituacao,
  estadoSelecionarTodosSituacao,
  motivoNaoSelecionavel,
  resumirSelecao,
  selecionavel,
} from './selecao'
import { chaveDoTitulo, ehBloqueado } from './situacaoTitulos'

const prontos = TITULOS_FIXTURE.filter(selecionavel)

describe('seleção por situação', () => {
  it('só título pronto é selecionável; bloqueado explica o motivo', () => {
    expect(prontos).toHaveLength(9)
    const b = TITULOS_FIXTURE.find(ehBloqueado)
    expect(b && selecionavel(b)).toBe(false)
    expect(b && motivoNaoSelecionavel(b)).toMatch(/Bloqueado: .+Resolva antes/)
  })

  it('pronto em lote FINALIZADO ou com remessa não é selecionável, com motivo', () => {
    const p = TITULOS_FIXTURE[0]
    const final = { ...p, loteComprometido: { id: 'l', status: 'FINALIZADO' as const } }
    const remessa = { ...p, loteComprometido: { id: 'l', status: 'REMESSA_GERADA' as const } }
    expect(selecionavel(final)).toBe(false)
    expect(selecionavel(remessa)).toBe(false)
    expect(motivoNaoSelecionavel(final)).toMatch(/lote finalizado/)
    expect(motivoNaoSelecionavel(remessa)).toMatch(/remessa gerada/)
    expect(motivoNaoSelecionavel(p)).toBeUndefined()
  })

  it('pronto em lote RASCUNHO é selecionável: ao criar, ele sai de lá (ADR-0064)', () => {
    const rasc = { ...TITULOS_FIXTURE[0], loteRascunho: { id: 'l', automatico: false } }
    expect(selecionavel(rasc)).toBe(true)
    expect(motivoNaoSelecionavel(rasc)).toBeUndefined()
  })

  it('selecionar todos atravessa filiais e ignora bloqueados', () => {
    const e = estadoSelecionarTodosSituacao(TITULOS_FIXTURE, new Set())
    expect(e.bloqueio).toBeUndefined()
    expect(e.chaves).toHaveLength(9)
    expect(new Set(prontos.map((t) => t.filCod)).size).toBeGreaterThan(1)
  })

  it('sem pronto no filtro: desabilitado com motivo', () => {
    const so = TITULOS_FIXTURE.filter(ehBloqueado)
    expect(estadoSelecionarTodosSituacao(so, new Set()).bloqueio).toMatch(/Nenhum título pronto/)
  })

  it('alternar: marca tudo; com parte marcada, desmarca; fora do filtro fica', () => {
    const e0 = estadoSelecionarTodosSituacao(TITULOS_FIXTURE, new Set())
    const todos = alternarTodosSituacao(e0, new Set(['9:9:9']))
    expect(todos.size).toBe(10)
    const e1 = estadoSelecionarTodosSituacao(TITULOS_FIXTURE, todos)
    expect(e1.marcado).toBe(true)
    const nenhum = alternarTodosSituacao(e1, todos)
    expect([...nenhum]).toEqual(['9:9:9'])
    const parte = new Set([chaveDoTitulo(prontos[0])])
    expect(estadoSelecionarTodosSituacao(TITULOS_FIXTURE, parte).marcado).toBe('indeterminate')
  })

  it('resumo: quantidade, valor e filiais ordenadas', () => {
    const sel = new Set(prontos.filter((t) => t.filCod !== 3).map(chaveDoTitulo))
    const r = resumirSelecao(TITULOS_FIXTURE, sel)
    expect(r.qtd).toBe(7)
    expect(r.filiais).toEqual([1, 7])
    expect(r.valor).toBeCloseTo(462.49 + 12840 + 8210.35 + 15300 + 6120.8 + 9840 + 34500, 2)
  })
})

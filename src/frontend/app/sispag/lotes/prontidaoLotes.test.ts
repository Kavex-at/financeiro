import type { ItemLote, LotePagamento, ProntidaoLote } from '@/lib/sispag'
import {
  contarProntidao,
  ehPronto,
  filtrarPorProntidao,
  finalizarEmSequencia,
  ordenarLotes,
  vencimentoDoLote,
} from './prontidaoLotes'

const item = (valor: number, vencimento?: number): ItemLote =>
  ({
    loteId: 'x',
    filCod: 2,
    docCod: '1',
    titCod: '1',
    valor,
    ...(vencimento !== undefined ? { vencimento } : {}),
    incluidoPor: 'ana',
  }) as ItemLote

const prontidao = (barram: number, saem: number): ProntidaoLote => ({
  estado: barram + saem === 0 ? 'PRONTO' : 'COM_PENDENCIA',
  itensQueVao: 1,
  barram,
  saem,
  pendencias: [],
  fontesIndisponiveis: [],
})

const lote = (id: string, over: Partial<LotePagamento> = {}): LotePagamento => ({
  id,
  filCod: 2,
  status: 'RASCUNHO',
  criadoPor: 'ana',
  versao: 1,
  itens: [item(100, 10)],
  ...over,
})

describe('prontidaoLotes (ADR-0076)', () => {
  const pronto = lote('P', { prontidao: prontidao(0, 0) })
  const barra = lote('B', { prontidao: prontidao(1, 0) })
  const sai = lote('S', { prontidao: prontidao(0, 2) })
  const semProntidao = lote('U')

  it('conta e filtra; lote sem prontidão só aparece em Todos e nunca como pronto', () => {
    const todos = [pronto, barra, sai, semProntidao]
    expect(contarProntidao(todos)).toEqual({ todos: 4, prontos: 1, 'com-pendencia': 2 })
    expect(filtrarPorProntidao(todos, 'prontos').map((l) => l.id)).toEqual(['P'])
    expect(filtrarPorProntidao(todos, 'com-pendencia').map((l) => l.id)).toEqual(['B', 'S'])
    expect(ehPronto(semProntidao)).toBe(false)
  })

  it('pendências primeiro: o que barra antes do que sai, prontos por último; empate pelo vencimento', () => {
    const cedo = lote('S1', { prontidao: prontidao(0, 2), itens: [item(1, 5)] })
    const ordem = ordenarLotes([pronto, sai, barra, cedo], 'pendencias').map((l) => l.id)
    expect(ordem).toEqual(['B', 'S1', 'S', 'P'])
  })

  it('vencimento (mais próximo primeiro, sem vencimento por último), valor (maior primeiro) e filial', () => {
    const a = lote('A', { filCod: 7, itens: [item(50, 30), item(10, 20)] })
    const b = lote('B', { filCod: 2, itens: [item(500)] })
    const c = lote('C', { filCod: 2, itens: [item(5, 1)] })
    expect(vencimentoDoLote(a)).toBe(20)
    expect(ordenarLotes([a, b, c], 'vencimento').map((l) => l.id)).toEqual(['C', 'A', 'B'])
    expect(ordenarLotes([a, b, c], 'valor').map((l) => l.id)).toEqual(['B', 'A', 'C'])
    expect(ordenarLotes([a, b, c], 'filial').map((l) => l.id)).toEqual(['C', 'B', 'A'])
  })

  it('finalizarEmSequencia: um por vez, falha não interrompe, resultado lote a lote', async () => {
    const chamados: string[] = []
    const avancos: number[] = []
    const r = await finalizarEmSequencia(
      [lote('1'), lote('2'), lote('3')],
      async (l) => {
        chamados.push(l.id)
        if (l.id === '2') throw new Error('Há alerta de duplicidade sem tratamento')
        return { retirados: l.id === '3' ? [{}] : [] }
      },
      (n) => avancos.push(n),
    )
    expect(chamados).toEqual(['1', '2', '3'])
    expect(avancos).toEqual([1, 2, 3])
    expect(r.map((x) => [x.lote.id, x.ok, x.retirados ?? x.mensagem])).toEqual([
      ['1', true, 0],
      ['2', false, 'Há alerta de duplicidade sem tratamento'],
      ['3', true, 1],
    ])
  })
})

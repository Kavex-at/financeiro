import type { ItemLote, TituloAPagar } from '@/lib/sispag'
import { motivoSelecaoBloqueada, planoDeSaida, podeSelecionar } from './moverParaLote'

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
  filCod: 2,
  docCod: '100',
  titCod: '1',
  valor: 10,
  liberado: true,
  pago: false,
  ...over,
})

const itens = (n: number): ItemLote[] =>
  Array.from({ length: n }, (_, i) => ({
    loteId: 'x',
    filCod: 2,
    docCod: String(i),
    titCod: '1',
  })) as ItemLote[]

describe('podeSelecionar / motivoSelecaoBloqueada', () => {
  it('título solto ou num lote RASCUNHO pode ser selecionado', () => {
    expect(podeSelecionar(titulo())).toBe(true)
    expect(podeSelecionar(titulo({ emLote: true, loteRascunho: { id: 'L1', automatico: true } }))).toBe(
      true,
    )
  })

  it('lote finalizado bloqueia e manda reabrir', () => {
    const t = titulo({ loteComprometido: { id: 'F1', status: 'FINALIZADO' } })
    expect(podeSelecionar(t)).toBe(false)
    expect(motivoSelecaoBloqueada(t)).toMatch(/Reabra/)
  })

  it('remessa gerada bloqueia sem saída', () => {
    const t = titulo({ loteComprometido: { id: 'R1', status: 'REMESSA_GERADA' } })
    expect(podeSelecionar(t)).toBe(false)
    expect(motivoSelecaoBloqueada(t)).toMatch(/remessa gerada/)
  })
})

describe('planoDeSaida', () => {
  it('sem títulos em lote → plano vazio (cria o lote direto)', () => {
    expect(planoDeSaida([titulo(), titulo({ docCod: '200' })], [])).toEqual([])
  })

  it('agrupa por lote de origem e marca a origem que fica vazia', () => {
    const a1 = titulo({ docCod: '1', loteRascunho: { id: 'A', automatico: true } })
    const a2 = titulo({ docCod: '2', loteRascunho: { id: 'A', automatico: true } })
    const b1 = titulo({ docCod: '3', loteRascunho: { id: 'B', automatico: false } })
    const solto = titulo({ docCod: '4' })
    const plano = planoDeSaida(
      [a1, a2, b1, solto],
      [
        { id: 'A', itens: itens(2) },
        { id: 'B', itens: itens(5) },
      ],
    )
    expect(plano).toHaveLength(2)
    const a = plano.find((p) => p.loteId === 'A')
    const b = plano.find((p) => p.loteId === 'B')
    expect(a).toMatchObject({ automatico: true, ficaVazio: true })
    expect(a?.titulos.map((t) => t.docCod)).toEqual(['1', '2'])
    expect(b).toMatchObject({ automatico: false, ficaVazio: false })
  })

  it('cada origem carrega o vencimento do lote, para distinguir lotes automáticos', () => {
    const a = titulo({ docCod: '1', loteRascunho: { id: 'A', automatico: true } })
    const b = titulo({ docCod: '2', loteRascunho: { id: 'B', automatico: true } })
    const comVenc = (id: string, dia: number) =>
      ({ id, itens: [{ ...itens(1)[0], vencimento: Date.UTC(2026, 9, dia) }, ...itens(2)] })
    const plano = planoDeSaida([a, b], [comVenc('A', 8), comVenc('B', 9)])
    expect(plano.find((p) => p.loteId === 'A')?.vencimento).toBe('vence em 08/10')
    expect(plano.find((p) => p.loteId === 'B')?.vencimento).toBe('vence em 09/10')
  })

  it('lote fora da lista carregada não é dado como vazio', () => {
    const t = titulo({ loteRascunho: { id: 'Z', automatico: true } })
    expect(planoDeSaida([t], [])[0].ficaVazio).toBe(false)
  })
})

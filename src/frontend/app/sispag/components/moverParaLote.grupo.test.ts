import type { TituloAPagar } from '@/lib/sispag'
import { motivoSelecaoBloqueada, podeSelecionar } from './moverParaLote'

/**
 * Título de boleto agrupado (ADR-0077, I21j) não é selecionável avulso: ele se move e se retira
 * com o grupo inteiro. A aba de títulos passa o conjunto de chaves `fil:doc:tit` dos grupos
 * confirmados.
 */
const titulo = (docCod: string, over: Partial<TituloAPagar> = {}): TituloAPagar =>
  ({ filCod: 2, docCod, titCod: '1', valor: 525, ...over }) as TituloAPagar

describe('seleção de título que faz parte de um boleto agrupado', () => {
  const emGrupo = new Set(['2:901:1', '2:902:1'])

  it('título do grupo: bloqueado, com o motivo em português', () => {
    expect(motivoSelecaoBloqueada(titulo('901'), emGrupo)).toMatch(/boleto agrupado/)
    expect(motivoSelecaoBloqueada(titulo('901'), emGrupo)).toMatch(/grupo inteiro/)
    expect(podeSelecionar(titulo('901'), emGrupo)).toBe(false)
  })

  it('título avulso segue selecionável', () => {
    expect(motivoSelecaoBloqueada(titulo('801'), emGrupo)).toBeUndefined()
    expect(podeSelecionar(titulo('801'), emGrupo)).toBe(true)
  })

  it('sem o conjunto (ou vazio) a regra é a de antes', () => {
    expect(podeSelecionar(titulo('901'))).toBe(true)
    expect(podeSelecionar(titulo('901'), new Set())).toBe(true)
  })

  it('o bloqueio do lote comprometido continua valendo (e vem primeiro)', () => {
    const t = titulo('901', {
      loteComprometido: { id: 'L9', status: 'FINALIZADO' },
    } as Partial<TituloAPagar>)
    expect(motivoSelecaoBloqueada(t, emGrupo)).toMatch(/lote finalizado/)
  })
})

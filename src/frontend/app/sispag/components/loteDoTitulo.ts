import type { LotePagamento, LoteRascunhoRef } from '@/lib/sispag'

/**
 * O lote em que um título está (ADR-0050): textos e cálculos puros da linha do título.
 * Ficam fora dos componentes para serem testados sem render.
 */

export const rotuloLote = (ref: LoteRascunhoRef): string =>
  ref.automatico ? 'Lote automático' : 'Lote manual'

/** Página (1-based) em que o lote aparece numa lista paginada, ou `null` se não está nela. */
export const paginaDoLote = (ids: string[], id: string, pageSize: number): number | null => {
  const i = ids.indexOf(id)
  return i < 0 ? null : Math.floor(i / pageSize) + 1
}

/**
 * Texto em que a busca das abas de lotes procura: filial, autor, credores e o documento de cada
 * título no mesmo formato da aba de títulos (`docCod/titCod`), para o código que a analista usa lá
 * achar o lote aqui.
 */
export const textoBuscaLote = (l: LotePagamento): string =>
  [
    l.filCod,
    l.criadoPor,
    ...l.itens.flatMap((i) => [i.credor ?? '', `${i.docCod}/${i.titCod}`]),
  ].join(' ')

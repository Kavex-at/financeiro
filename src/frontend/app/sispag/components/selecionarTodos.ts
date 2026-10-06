import type { TituloAPagar } from '@/lib/sispag'
import { podeSelecionar } from './moverParaLote'

/**
 * "Selecionar todos" da aba de títulos (ADR-0064): regras puras do checkbox do cabeçalho. Opera
 * sobre TODAS as linhas que passam nos filtros da aba (todas as páginas), nunca só a página visível.
 */

export const chaveTitulo = (t: TituloAPagar): string => `${t.filCod}:${t.docCod}:${t.titCod}`

export interface EstadoSelecionarTodos {
  /** `true` = todas marcadas · `'indeterminate'` = parte · `false` = nenhuma. */
  marcado: boolean | 'indeterminate'
  /** Motivo de estar desabilitado (vira tooltip e aria-label), ou `undefined` se habilitado. */
  bloqueio?: string
  /** Chaves das linhas selecionáveis do filtro — o que o clique marca ou desmarca. */
  chaves: string[]
}

export const MOTIVO_VARIAS_FILIAIS = 'Filtre por uma filial para selecionar todos'

export const estadoSelecionarTodos = (
  filtrados: TituloAPagar[],
  selecionados: ReadonlySet<string>,
): EstadoSelecionarTodos => {
  const selecionaveis = filtrados.filter(podeSelecionar)
  const chaves = selecionaveis.map(chaveTitulo)
  if (chaves.length === 0) return { marcado: false, bloqueio: 'Nenhum título selecionável', chaves }
  // Um lote é de uma filial só: marcar todos de várias filiais só levaria ao erro do "Criar lote".
  if (new Set(selecionaveis.map((t) => t.filCod)).size > 1) {
    return { marcado: false, bloqueio: MOTIVO_VARIAS_FILIAIS, chaves }
  }
  const marcadas = chaves.filter((k) => selecionados.has(k)).length
  return {
    marcado: marcadas === 0 ? false : marcadas === chaves.length ? true : 'indeterminate',
    chaves,
  }
}

/**
 * O clique no cabeçalho: com tudo marcado ou parte marcada, desmarca as linhas do filtro; com nada
 * marcado, marca todas. Seleções fora do filtro atual ficam como estão.
 */
export const alternarTodos = (
  estado: EstadoSelecionarTodos,
  selecionados: ReadonlySet<string>,
): Set<string> => {
  const next = new Set(selecionados)
  if (estado.bloqueio) return next
  if (estado.marcado === false) for (const k of estado.chaves) next.add(k)
  else for (const k of estado.chaves) next.delete(k)
  return next
}

/**
 * As linhas da aba depois dos filtros de filial e busca — a mesma regra de `useTabelaFiltro`
 * (filial "todas" ou igual; busca por substring, sem caixa). O hook não expõe a lista filtrada
 * inteira (só a página), e o kit de filtros é de outra frente; quando ele expuser, trocar por ela.
 */
export const filtrarComoAba = (
  itens: TituloAPagar[],
  filtro: { filial: string; busca: string },
  textoBusca: (t: TituloAPagar) => string,
): TituloAPagar[] => {
  const b = filtro.busca.trim().toLowerCase()
  return itens.filter(
    (t) =>
      (filtro.filial === 'todas' || String(t.filCod) === filtro.filial) &&
      (b === '' || textoBusca(t).toLowerCase().includes(b)),
  )
}

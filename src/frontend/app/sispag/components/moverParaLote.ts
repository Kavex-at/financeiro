import type { LotePagamento, TituloAPagar } from '@/lib/sispag'
import { rotuloVencimentoLote } from './loteDoTitulo'

/**
 * Mover títulos para um lote manual (ADR-0064): regras puras da seleção e da confirmação na aba de
 * títulos. Ficam fora dos componentes para serem testadas sem render.
 */

/**
 * Por que o título não pode ser selecionado, ou `undefined` se pode. Título num lote RASCUNHO pode:
 * ele se move para o lote novo. Título num lote finalizado ou com remessa gerada não pode.
 */
export const motivoSelecaoBloqueada = (t: TituloAPagar): string | undefined => {
  if (!t.loteComprometido) return undefined
  return t.loteComprometido.status === 'FINALIZADO'
    ? 'Está num lote finalizado. Reabra aquele lote para retirá-lo antes de usá-lo em outro.'
    : 'Está num lote com remessa gerada: o pagamento já foi para o banco e não pode mudar de lote.'
}

export const podeSelecionar = (t: TituloAPagar): boolean => motivoSelecaoBloqueada(t) === undefined

/** Um lote de origem e os títulos selecionados que sairão dele. */
export interface SaidaDeLote {
  loteId: string
  automatico: boolean
  titulos: TituloAPagar[]
  /** Todos os títulos do lote foram selecionados: ele fica vazio e é cancelado. */
  ficaVazio: boolean
  /** "vence em DD/MM" do lote de origem, para distinguir lotes automáticos entre si. */
  vencimento?: string
}

/**
 * Agrupa por lote de origem os títulos selecionados que já estão num lote RASCUNHO. Vazio quando
 * nenhum selecionado está em lote (o "Criar lote" segue direto, sem confirmação).
 *
 * `ficaVazio` usa a lista de lotes carregada na tela; se o lote não estiver nela, assume que não
 * fica vazio (o servidor é quem decide: ele cancela a origem que realmente ficou sem itens).
 */
export const planoDeSaida = (
  selecionados: TituloAPagar[],
  lotes: Pick<LotePagamento, 'id' | 'itens'>[],
): SaidaDeLote[] => {
  const porLote = new Map<string, SaidaDeLote>()
  for (const t of selecionados) {
    const ref = t.loteRascunho
    if (!ref) continue
    const atual = porLote.get(ref.id)
    if (atual) atual.titulos.push(t)
    else porLote.set(ref.id, { loteId: ref.id, automatico: ref.automatico, titulos: [t], ficaVazio: false })
  }
  const lotePorId = new Map(lotes.map((l) => [l.id, l]))
  return [...porLote.values()].map((s) => {
    const lote = lotePorId.get(s.loteId)
    const vencimento = lote ? rotuloVencimentoLote(lote.itens) : undefined
    return {
      ...s,
      ficaVazio: lote !== undefined && lote.itens.length <= s.titulos.length,
      ...(vencimento ? { vencimento } : {}),
    }
  })
}

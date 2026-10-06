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
/** `epoch-ms` do ERP → `'DD/MM'` no dia UTC (o ERP grava 00:00Z do dia; mesma regra de `formatErpDay`). */
const diaMes = (ms: number): string =>
  new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' })

/** Dia UTC, para comparar vencimentos sem a hora (o ERP grava 00:00Z ou 15:00Z). */
const diaUtc = (ms: number): number => Math.floor(ms / 86_400_000)

/**
 * Vencimento do lote no cabeçalho (ADR-0064): "vence em DD/MM" quando todos os itens vencem no mesmo
 * dia (o lote automático é por dia), "vence DD/MM–DD/MM" quando o lote manual mistura datas, e
 * `undefined` quando não há item com vencimento.
 */
export const rotuloVencimentoLote = (itens: { vencimento?: number }[]): string | undefined => {
  const vencs = itens.map((i) => i.vencimento).filter((v): v is number => typeof v === 'number')
  if (vencs.length === 0) return undefined
  const min = Math.min(...vencs)
  const max = Math.max(...vencs)
  return diaUtc(min) === diaUtc(max)
    ? `vence em ${diaMes(min)}`
    : `vence ${diaMes(min)}–${diaMes(max)}`
}

export const textoBuscaLote = (l: LotePagamento): string =>
  [
    l.filCod,
    l.criadoPor,
    ...l.itens.flatMap((i) => [i.credor ?? '', `${i.docCod}/${i.titCod}`]),
  ].join(' ')

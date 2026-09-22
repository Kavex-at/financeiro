import type { LoteRascunhoRef, RetencaoFormacao } from '@/lib/sispag'

/**
 * Retenção da formação automática (ADR-0050) — textos e cálculos puros da tela SISPAG.
 * Ficam fora dos componentes para serem testados sem render.
 */

/** Limite do motivo (o backend recusa acima disto com 400). */
export const MOTIVO_RETENCAO_MAX = 500

export const rotuloLote = (ref: LoteRascunhoRef): string =>
  ref.automatico ? 'Lote automático' : 'Lote manual'

const fmtDataHora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', '')

/** Linhas do detalhe do badge "Não lotar automaticamente": quem, quando e por quê. */
export const detalheRetencao = (r: RetencaoFormacao): string[] => [
  `Retido por ${r.marcadoPor}`,
  `Em ${fmtDataHora(r.marcadoEm)}`,
  r.motivo ? `Motivo: ${r.motivo}` : 'Sem motivo informado',
]

/**
 * Confirmação da lixeira dentro do lote. Num lote automático a remoção também retém o título
 * (ADR-0050, P1-1), e a analista precisa saber disso antes de clicar. Num lote manual nada muda
 * em relação a antes, então não há confirmação (`null`).
 */
export const mensagemRemocao = (lote: { automatico?: boolean }): string | null =>
  lote.automatico
    ? 'O título sai deste lote e não volta a entrar em lote automático até alguém incluí-lo ' +
      'num lote à mão ou clicar em "Liberar" na aba Títulos a pagar. Este lote passa a ser manual.'
    : null

/** Página (1-based) em que o lote aparece numa lista paginada, ou `null` se não está nela. */
export const paginaDoLote = (ids: string[], id: string, pageSize: number): number | null => {
  const i = ids.indexOf(id)
  return i < 0 ? null : Math.floor(i / pageSize) + 1
}

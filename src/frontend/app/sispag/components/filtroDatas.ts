/**
 * Conversões para o filtro de/até das abas do SISPAG. O filtro compara DIAS CIVIS
 * (`YYYY-MM-DD`, o valor do `<input type="date">`) por ordem de string, então cada fonte de data
 * precisa virar dia civil do jeito certo — há duas espécies de data na tela:
 *
 * - **dia ERP** (`titDtaVencimento`, `flpDtaCredito`): o Conexos manda a meia-noite UTC do dia.
 *   Ler em fuso local jogaria o vencimento para a véspera — mesmo motivo do `formatErpDay`.
 * - **instante** (`remessaGeradaEm`, `garTimCadastro`): um momento real. O dia é o de Brasília,
 *   que é onde a analista vive; uma remessa gerada às 22h30 é do dia, não do seguinte.
 */

const BRT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Dia ERP (epoch ms da meia-noite UTC) → `YYYY-MM-DD`. */
export function diaDoErp(ms?: number): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined
  return new Date(ms).toISOString().slice(0, 10)
}

/** Instante (ISO ou epoch ms) → dia civil em Brasília, `YYYY-MM-DD`. */
export function diaEmBrasilia(instante?: string | number): string | undefined {
  if (instante == null) return undefined
  const d = new Date(instante)
  if (Number.isNaN(d.getTime())) return undefined
  return BRT.format(d)
}

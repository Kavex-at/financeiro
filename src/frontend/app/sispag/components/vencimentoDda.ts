/** Dia civil de hoje em Brasília (`YYYY-MM-DD`) — vencimento é dia, não instante. */
export const hojeBrt = (agora: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora)

/** Soma `dias` a uma data civil `YYYY-MM-DD`, sem fuso. */
export const somarDias = (dia: string, dias: number): string => {
  const [a = 0, m = 1, d = 1] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

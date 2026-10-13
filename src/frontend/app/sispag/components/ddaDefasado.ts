/**
 * O pool DDA é atualizado pela ingestão de pagamentos (crons 07h/12h/16h BRT e abertura da tela).
 * Se ficou parado por mais que isto num dia útil, a coluna "boleto" da carteira está lendo um
 * pool velho — foi assim que o pool ficou 5 dias sem sincronizar (08–13/10/2026) sem ninguém ver.
 * Fim de semana não conta: o banco não manda arquivo DDA.
 */
export const DDA_DEFASADO_HORAS = 8

const HORA_MS = 60 * 60 * 1000

/** Dia da semana em Brasília (0 = domingo … 6 = sábado). */
const diaDaSemanaBrt = (d: Date): number => {
  const nome = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(nome)
}

/**
 * Horas inteiras de defasagem quando o pool está velho demais para um dia útil; `undefined`
 * quando está em dia, nunca sincronizou (a tela já diz isso) ou hoje é fim de semana.
 */
export const horasDdaDefasado = (
  sincronizadoEm: number | string | undefined,
  agora: Date = new Date(),
): number | undefined => {
  if (sincronizadoEm === undefined) return undefined
  const quando = typeof sincronizadoEm === 'number' ? sincronizadoEm : Date.parse(sincronizadoEm)
  if (!Number.isFinite(quando)) return undefined
  const dia = diaDaSemanaBrt(agora)
  if (dia === 0 || dia === 6) return undefined
  const horas = Math.floor((agora.getTime() - quando) / HORA_MS)
  return horas > DDA_DEFASADO_HORAS ? horas : undefined
}

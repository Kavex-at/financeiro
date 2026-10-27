import type { TituloAPagar } from '@/lib/sispag'
import { ORIGEM_PRAZO } from '@/lib/sispag'
import { diaDoErp } from '../components/filtroDatas'

/**
 * Prazo efetivo do título (I19t, ADR-0078). Puro: sem React e sem relógio — o "hoje" nunca é
 * lido; os dias até o prazo saem de `diasAteVencimento` (que o servidor calcula em BRT) somado à
 * distância entre o vencimento do título e o prazo, ambos dias civis. Título sem `prazoBoleto`
 * (backend antigo, fonte BOLETO fora do ar) cai no vencimento do título.
 */

const MS_DIA = 86_400_000

const emMs = (dia: string): number => Date.parse(`${dia}T00:00:00Z`)

/** Diferença em dias civis (`b - a`) entre dois `YYYY-MM-DD`. */
export const diferencaDias = (a: string, b: string): number => Math.round((emMs(b) - emMs(a)) / MS_DIA)

/** Dia civil do prazo efetivo: o do boleto quando ele puxa, senão o vencimento do título. */
export const diaDoPrazo = (t: TituloAPagar): string | undefined =>
  t.prazoBoleto?.prazoEfetivo ?? diaDoErp(t.vencimento)

/**
 * Dias em que o título é achado pelo filtro de/até: o do prazo efetivo e o do próprio vencimento
 * (QA case 6, ADR-0078): a linha mostra as duas datas, então qualquer uma a encontra. Sem repetir.
 */
export const diasDoTitulo = (t: TituloAPagar): string[] => {
  const dias = [diaDoPrazo(t), diaDoErp(t.vencimento)].filter((d): d is string => d !== undefined)
  return [...new Set(dias)]
}

/** Dias até o prazo efetivo (negativo = passou, 0 = hoje). */
export const diasAtePrazo = (t: TituloAPagar): number | undefined => {
  if (t.diasAteVencimento === undefined) return undefined
  const p = t.prazoBoleto
  if (!p) return t.diasAteVencimento
  return t.diasAteVencimento + diferencaDias(p.vencimentoTitulo, p.prazoEfetivo)
}

/** O boleto sugerido já venceu (I19t(5)): resolver no portal do banco. Não é o motivo VENCIDO. */
export const estaPerdido = (t: TituloAPagar): boolean => t.prazoBoleto?.perdido === true

/** O prazo veio do boleto sugerido, antes do título. */
export const prazoVemDoBoleto = (t: TituloAPagar): boolean =>
  t.prazoBoleto?.origem === ORIGEM_PRAZO.BOLETO_SUGERIDO

/** `YYYY-MM-DD` → `dd/mm` por split (sem `new Date`, que trocaria o dia pelo fuso). */
const ddmm = (dia: string): string => {
  const [, m, d] = dia.split('-')
  return `${d}/${m}`
}

/** Texto da linha em que o boleto sugerido muda o prazo; a decisão de texto é da tela. */
export const ROTULO_PERDIDO = 'Perdido: resolver no portal do banco'

/**
 * Causa do prazo para a linha do título (I19t): "Boleto sugerido vence hoje · título vence 28/10"
 * quando a barra puxa o prazo; "N candidatos" quando há mais de um acionável. `undefined` quando o
 * prazo é só o do título e não há ambiguidade a avisar. O perdido tem texto próprio
 * (`ROTULO_PERDIDO`), em linha separada.
 */
export const causaDoPrazo = (t: TituloAPagar): string | undefined => {
  const p = t.prazoBoleto
  if (!p || p.perdido) return undefined
  const partes: string[] = []
  if (p.origem === ORIGEM_PRAZO.BOLETO_SUGERIDO) {
    const dias = diasAtePrazo(t)
    const quando = dias === 0 ? 'hoje' : ddmm(p.prazoEfetivo)
    partes.push(`Boleto sugerido vence ${quando}`, `título vence ${ddmm(p.vencimentoTitulo)}`)
  }
  if ((p.totalCandidatos ?? 0) > 1) partes.push(`${p.totalCandidatos} candidatos`)
  return partes.length > 0 ? partes.join(' · ') : undefined
}

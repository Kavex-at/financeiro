import type {
  ItemLote,
  ModoVinculoCodigoBarras,
  RetiradaDoLote,
  RetiradoPorCodigoBarras,
  VinculoPrevisto,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

/** Motivo (identificador do backend) → texto pt-BR para a analista. */
export const ROTULO_MOTIVO_VINCULO: Record<string, string> = {
  MODALIDADE_NAO_BOLETO: 'a forma de pagamento não é boleto',
  FORA_DO_RASCUNHO: 'o lote não está mais em rascunho',
  DDA_ASSOCIADO_PELO_ERP: 'o Conexos já associou um boleto DDA',
  SEM_DECISAO: 'sem boleto confirmado para o título',
  DECISAO_NAO_CONFIRMADA: 'a decisão não está confirmada',
  DECISAO_ORFA: 'a confirmação ficou órfã (o boleto saiu do pool)',
  PAR_NAO_VIGENTE: 'a confirmação do emissor foi revogada',
  BOLETO_INDISPONIVEL: 'o boleto não está mais disponível',
  BOLETO_INCONSISTENTE: 'o boleto diverge do código de barras',
  CODIGO_INVALIDO: 'código de barras inválido',
  CODIGO_ARRECADACAO: 'boleto de arrecadação não é vinculável',
  TIER_INSUFICIENTE: 'a sugestão já não é segura',
  VALOR_ABERTO_INDISPONIVEL: 'valor em aberto indisponível',
  VALOR_DIFERENTE: 'valor do boleto diferente do valor em aberto',
  DATA_INDISPONIVEL: 'boleto sem vencimento',
  DATA_ANTES_DO_TITULO: 'vence antes do título',
  DATA_FORA_DA_JANELA: 'vence mais de 5 dias depois do título',
  BARRA_VENCIDA: 'vence antes da data de débito',
}

const plural = (n: number, um: string, varios: string) => (Math.abs(n) === 1 ? um : varios)

/** Diferença com SINAL (boleto − título): dias e valor. Vazio quando não há nada a mostrar. */
export function descreverDelta(d: { deltaDias?: number; deltaCentavos?: number }): string {
  const partes: string[] = []
  if (d.deltaDias !== undefined) {
    const n = d.deltaDias
    partes.push(`${n > 0 ? '+' : ''}${n} ${plural(n, 'dia', 'dias')}`)
  }
  if (d.deltaCentavos !== undefined && d.deltaCentavos !== 0) {
    const c = d.deltaCentavos
    partes.push(`${c > 0 ? '+' : '-'}${formatBRL(Math.abs(c) / 100)}`)
  }
  return partes.join(' · ')
}

export type TipoSeloVinculo = 'vinculado' | 'previsto' | 'inelegivel' | 'retirado'

export interface SeloVinculo {
  tipo: TipoSeloVinculo
  texto: string
}

const ddmm = (civil?: string): string | undefined => {
  const m = civil ? /^(\d{4})-(\d{2})-(\d{2})/.exec(civil) : null
  return m ? `${m[3]}/${m[2]}` : undefined
}

/**
 * Selo do vínculo do código de barras de UM item (ADR-0071). Só máscaras: nenhum campo de entrada
 * carrega o código completo. A retirada PREVALECE: item vinculado e depois retirado não é sucesso.
 * `previsto` só com o modo `on` (derivado — a remessa relê tudo); `shadow`/`off` não mostram selo.
 */
export function seloDoItem(p: {
  item: ItemLote
  previsto?: VinculoPrevisto
  modo?: ModoVinculoCodigoBarras
  retirado?: RetiradaDoLote | RetiradoPorCodigoBarras
  /** Data de débito do lote (`YYYY-MM-DD`): a data em que o item é pago. */
  dataDebito?: string
}): SeloVinculo | null {
  if (p.retirado) {
    return {
      tipo: 'retirado',
      texto: 'retirado do lote — o vínculo do código de barras não vale mais',
    }
  }
  const v = p.item.vinculoCodigoBarras
  if (v) {
    const partes = ['vinculado por confirmação', `barra ${v.codigoMascarado}`]
    if (p.item.valor !== undefined) partes.push(formatBRL(p.item.valor))
    const dia = ddmm(p.dataDebito)
    if (dia) partes.push(`paga em ${dia}`)
    return { tipo: 'vinculado', texto: partes.join(' · ') }
  }
  if (p.modo !== 'on' || !p.previsto) return null
  if (p.previsto.elegivel) {
    return {
      tipo: 'previsto',
      texto:
        'boleto confirmado será vinculado na remessa (previsão: a remessa relê o valor e a decisão antes)',
    }
  }
  const motivo = p.previsto.motivo
    ? (ROTULO_MOTIVO_VINCULO[p.previsto.motivo] ?? p.previsto.motivo)
    : 'não vinculável'
  const delta = descreverDelta(p.previsto)
  return {
    tipo: 'inelegivel',
    texto: `não será vinculado: ${motivo}${delta ? ` (${delta})` : ''}`,
  }
}

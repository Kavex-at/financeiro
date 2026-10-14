import type { SinalSugestaoBoleto, SugestaoBoleto } from '@/lib/sispag'

const numero = (n: number, casas: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n)

const sinal = (n: number) => (n > 0 ? '+' : n < 0 ? '-' : '')

/** `R$ +0,01`, `R$ -12,50`, `R$ 0,00` — boleto menos título, sempre com sinal. */
export const formatDeltaValor = (d: number): string => `R$ ${sinal(d)}${numero(Math.abs(d), 2)}`

/** `+1,6 %`, `-0,3 %`. */
export const formatDeltaPercentual = (d: number): string => `${sinal(d)}${numero(Math.abs(d), 1)} %`

/** `+2 dias`, `-1 dia`, `0 dias` — vencimento do boleto menos o do título. */
export const formatDeltaDias = (d: number): string =>
  `${sinal(d)}${Math.abs(d)} ${Math.abs(d) === 1 ? 'dia' : 'dias'}`

export const TEXTO_SINAL: Record<SinalSugestaoBoleto, { texto: string; atencao: boolean }> = {
  VALOR_IGUAL: { texto: 'valor igual ao do título', atencao: false },
  VALOR_ATE_5_CENTAVOS: { texto: 'valor difere em até R$ 0,05 do título', atencao: true },
  MESMO_DIA: { texto: 'vence no mesmo dia do título', atencao: false },
  DIAS_DEPOIS: { texto: 'vence depois do título', atencao: true },
  NUMERO_IGUAL: { texto: 'número do boleto igual ao do documento', atencao: false },
  COLISAO_NUMERO: { texto: 'número do boleto coincide com o de outro título', atencao: true },
  EMISSOR_CONFIRMADO: { texto: 'emissor já confirmado para este credor', atencao: false },
}

export const TIER_ROTULO: Record<SugestaoBoleto['avaliacao']['resultado'], string> = {
  CONHECIDO: 'sugestão forte · emissor conhecido',
  FORTE: 'sugestão forte',
  ATENCAO: 'atenção',
  VENCIDO_INFORMATIVO: 'vencido · só informativo',
  SEM_RELACAO: 'sem relação com o título',
}

export type ResumoSugestaoTitulo = 'ORFA' | 'CONFIRMADA' | 'DISPONIVEL' | 'INFORMATIVA'

export const chaveTitulo = (t: { filCod?: number; docCod: string; titCod: string }): string =>
  `${t.filCod ?? ''}:${t.docCod}:${t.titCod}`

/** Agrupa a listagem por título (`fil:doc:tit`). */
export const agruparPorTitulo = (lista: SugestaoBoleto[]): Map<string, SugestaoBoleto[]> => {
  const mapa = new Map<string, SugestaoBoleto[]>()
  for (const s of lista) {
    const k = chaveTitulo(s)
    const atual = mapa.get(k)
    if (atual) atual.push(s)
    else mapa.set(k, [s])
  }
  return mapa
}

/**
 * O que a linha do título anuncia: confirmação órfã (precisa de atenção) > confirmado > sugestão
 * confirmável > só informativa.
 */
export const resumoDoTitulo = (
  lista: SugestaoBoleto[] | undefined,
): ResumoSugestaoTitulo | undefined => {
  if (!lista || lista.length === 0) return undefined
  if (lista.some((s) => s.estado === 'CONFIRMADA' && s.orfa === true)) return 'ORFA'
  if (lista.some((s) => s.estado === 'CONFIRMADA')) return 'CONFIRMADA'
  if (lista.some((s) => s.confirmavel && s.avaliacao.confirmavel)) return 'DISPONIVEL'
  return 'INFORMATIVA'
}

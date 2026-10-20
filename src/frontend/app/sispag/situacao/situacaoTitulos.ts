import {
  DONO_PAGAMENTO,
  type DonoPagamento,
  ESTADO_PAGAMENTO,
  formaDePagamento,
  MOTIVO_PAGAMENTO,
  type MotivoPagamento,
  type TituloAPagar,
} from '@/lib/sispag'
import { diaDoErp } from '../components/filtroDatas'
import { ROTULO_MOTIVO } from './rotulos'

/**
 * Regras puras da aba de títulos com situação de pagamento (ADR-0075): filtro por coluna,
 * ordenação, faixas de vencimento e os recortes dos cards. Sem React: testado sem render.
 */

export type EstadoFiltro = 'todos' | 'prontos' | 'bloqueados'
export const SITUACAO_PRONTO = 'PRONTO' as const
export type SituacaoChave = typeof SITUACAO_PRONTO | MotivoPagamento

export const FAIXAS_VENCIMENTO = ['VENCIDO', 'HOJE', '1-2', '3-7', '8+'] as const
export type FaixaVencimento = (typeof FAIXAS_VENCIMENTO)[number]
export const ROTULO_FAIXA: Readonly<Record<FaixaVencimento, string>> = {
  VENCIDO: 'Vencidos',
  HOJE: 'Hoje',
  '1-2': '1 a 2 dias',
  '3-7': '3 a 7 dias',
  '8+': '8 dias ou mais',
}

export interface FiltrosTitulos {
  estado: EstadoFiltro
  credor: string
  documento: string
  valorMin: string
  valorMax: string
  faixas: FaixaVencimento[]
  /** `YYYY-MM-DD` (dia civil do vencimento). */
  vencDe: string
  vencAte: string
  formas: string[]
  situacoes: SituacaoChave[]
  donos: DonoPagamento[]
  filiais: number[]
}

export const FILTROS_VAZIOS: FiltrosTitulos = {
  estado: 'todos',
  credor: '',
  documento: '',
  valorMin: '',
  valorMax: '',
  faixas: [],
  vencDe: '',
  vencAte: '',
  formas: [],
  situacoes: [],
  donos: [],
  filiais: [],
}

export type ColunaTitulo =
  | 'credor'
  | 'documento'
  | 'valor'
  | 'vencimento'
  | 'forma'
  | 'situacao'
  | 'acao'
  | 'filial'

export interface Ordenacao {
  coluna: ColunaTitulo
  /** 1 = crescente, -1 = decrescente. */
  direcao: 1 | -1
}

/** Padrão: o que vence primeiro no topo (vencidos e de hoje à frente). */
export const ORDENACAO_PADRAO: Ordenacao = { coluna: 'vencimento', direcao: 1 }

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export const chaveDoTitulo = (t: Pick<TituloAPagar, 'filCod' | 'docCod' | 'titCod'>): string =>
  `${t.filCod}:${t.docCod}:${t.titCod}`

export const ehBloqueado = (t: TituloAPagar): boolean =>
  t.situacaoPagamento?.estado === ESTADO_PAGAMENTO.BLOQUEADO
export const ehPronto = (t: TituloAPagar): boolean =>
  t.situacaoPagamento?.estado === ESTADO_PAGAMENTO.PRONTO

/** Pronto ou o motivo principal: é o que a coluna Situação filtra e ordena. */
export const situacaoChave = (t: TituloAPagar): SituacaoChave =>
  t.situacaoPagamento?.principal ?? SITUACAO_PRONTO

export const donoDe = (t: TituloAPagar): DonoPagamento =>
  t.situacaoPagamento?.dono ?? DONO_PAGAMENTO.VOCE

export const rotuloSituacao = (t: TituloAPagar): string => {
  const s = t.situacaoPagamento
  if (!s || s.estado === ESTADO_PAGAMENTO.PRONTO) return 'Pronto'
  return s.rotulo ?? (s.principal ? ROTULO_MOTIVO[s.principal] : 'Bloqueado')
}

/** Faixa do vencimento por dia civil (`diasAteVencimento`: negativo = vencido, 0 = hoje). */
export const faixaDeVencimento = (dias?: number): FaixaVencimento | undefined => {
  if (dias === undefined) return undefined
  if (dias < 0) return 'VENCIDO'
  if (dias === 0) return 'HOJE'
  if (dias <= 2) return '1-2'
  if (dias <= 7) return '3-7'
  return '8+'
}

const valorNumerico = (s: string): number | undefined => {
  if (s.trim() === '') return undefined
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export const contarFiltrosDeColuna = (f: FiltrosTitulos): number =>
  (f.credor ? 1 : 0) +
  (f.documento ? 1 : 0) +
  (f.valorMin !== '' || f.valorMax !== '' ? 1 : 0) +
  (f.faixas.length > 0 || f.vencDe !== '' || f.vencAte !== '' ? 1 : 0) +
  (f.formas.length > 0 ? 1 : 0) +
  (f.situacoes.length > 0 ? 1 : 0) +
  (f.donos.length > 0 ? 1 : 0) +
  (f.filiais.length > 0 ? 1 : 0)

export const haFiltroAtivo = (f: FiltrosTitulos): boolean =>
  f.estado !== 'todos' || contarFiltrosDeColuna(f) > 0

export const passaEstado = (t: TituloAPagar, estado: EstadoFiltro): boolean =>
  estado === 'todos' || (estado === 'prontos' ? ehPronto(t) : ehBloqueado(t))

export const passaColunas = (t: TituloAPagar, f: FiltrosTitulos): boolean => {
  if (f.credor && !norm(t.credor ?? '').includes(norm(f.credor))) return false
  if (f.documento && !norm(`${t.docCod}/${t.titCod}`).includes(norm(f.documento))) return false
  const min = valorNumerico(f.valorMin)
  const max = valorNumerico(f.valorMax)
  if (min !== undefined && t.valor < min) return false
  if (max !== undefined && t.valor > max) return false
  if (f.faixas.length > 0) {
    const faixa = faixaDeVencimento(t.diasAteVencimento)
    if (!faixa || !f.faixas.includes(faixa)) return false
  }
  if (f.vencDe || f.vencAte) {
    const dia = diaDoErp(t.vencimento)
    if (!dia) return false
    if (f.vencDe && dia < f.vencDe) return false
    if (f.vencAte && dia > f.vencAte) return false
  }
  if (f.formas.length > 0 && !f.formas.includes(formaDePagamento(t).chave)) return false
  if (f.situacoes.length > 0 && !f.situacoes.includes(situacaoChave(t))) return false
  if (f.donos.length > 0 && !f.donos.includes(donoDe(t))) return false
  if (f.filiais.length > 0 && !f.filiais.includes(t.filCod)) return false
  return true
}

export const aplicarFiltros = (titulos: TituloAPagar[], f: FiltrosTitulos): TituloAPagar[] =>
  titulos.filter((t) => passaEstado(t, f.estado) && passaColunas(t, f))

const ORDEM_MOTIVOS: readonly string[] = [SITUACAO_PRONTO, ...Object.values(MOTIVO_PAGAMENTO)]

const valorDaColuna = (t: TituloAPagar, c: ColunaTitulo): string | number => {
  switch (c) {
    case 'credor':
      return norm(t.credor ?? '')
    case 'documento':
      return `${t.docCod}/${t.titCod}`
    case 'valor':
      return t.valor
    case 'vencimento':
      // Sem vencimento vai para o fim em qualquer direção razoável.
      return t.vencimento ?? Number.MAX_SAFE_INTEGER
    case 'forma':
      return formaDePagamento(t).rotulo
    case 'situacao':
      return ORDEM_MOTIVOS.indexOf(situacaoChave(t))
    case 'acao':
      return t.situacaoPagamento?.acao?.rotulo ?? ''
    case 'filial':
      return t.filCod
  }
}

export const ordenarTitulos = (titulos: TituloAPagar[], o: Ordenacao): TituloAPagar[] =>
  [...titulos].sort((a, b) => {
    const x = valorDaColuna(a, o.coluna)
    const y = valorDaColuna(b, o.coluna)
    const c =
      typeof x === 'string' && typeof y === 'string'
        ? x.localeCompare(y, 'pt-BR', { numeric: true })
        : Number(x) - Number(y)
    return (
      c * o.direcao ||
      chaveDoTitulo(a).localeCompare(chaveDoTitulo(b), 'pt-BR', { numeric: true })
    )
  })

// ---------------------------------------------------------------- recortes dos cards

export interface Total {
  qtd: number
  valor: number
}
export const somar = (titulos: TituloAPagar[]): Total => ({
  qtd: titulos.length,
  valor: titulos.reduce((acc, t) => acc + t.valor, 0),
})

/** Faixa vermelha: bloqueados que vencem HOJE (vencidos ficam de fora, decisão D2). */
export const bloqueadosQueVencemHoje = (titulos: TituloAPagar[]): TituloAPagar[] =>
  titulos.filter((t) => ehBloqueado(t) && t.diasAteVencimento === 0).sort((a, b) => b.valor - a.valor)

/** Card "Vencem em até 2 dias": hoje, amanhã e depois (vencidos não entram). */
export const vencemEmAteDoisDias = (titulos: TituloAPagar[]): TituloAPagar[] =>
  titulos.filter(
    (t) =>
      t.diasAteVencimento !== undefined && t.diasAteVencimento >= 0 && t.diasAteVencimento <= 2,
  )

/** Prévia do "Formar lotes automáticos": só PRONTO, um lote por filial. */
export const prontosPorFilial = (titulos: TituloAPagar[]): Array<{ filCod: number } & Total> => {
  const porFilial = new Map<number, TituloAPagar[]>()
  for (const t of titulos) {
    if (!ehPronto(t) || t.loteComprometido || t.loteRascunho) continue
    porFilial.set(t.filCod, [...(porFilial.get(t.filCod) ?? []), t])
  }
  return [...porFilial.entries()]
    .sort(([a], [b]) => a - b)
    .map(([filCod, ts]) => ({ filCod, ...somar(ts) }))
}

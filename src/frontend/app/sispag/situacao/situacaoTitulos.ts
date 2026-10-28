import {
  DONO_PAGAMENTO,
  type DonoPagamento,
  ESTADO_PAGAMENTO,
  formaDePagamento,
  MOTIVO_PAGAMENTO,
  type MotivoPagamento,
  SUGESTAO_BOLETO_SEM_DDA,
  type SugestaoBoletoSemDda,
  type TituloAPagar,
} from '@/lib/sispag'
import { ROTULO_MOTIVO } from './rotulos'
import { diasAtePrazo, diasDoTitulo, estaPerdido } from './prazoTitulo'

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
  /** Nº do documento do fornecedor (`doc_esp_numero`), "contém". */
  numeroDocumento: string
  valorMin: string
  valorMax: string
  faixas: FaixaVencimento[]
  /** `YYYY-MM-DD` (dia civil do vencimento). */
  vencDe: string
  vencAte: string
  formas: string[]
  situacoes: SituacaoChave[]
  /**
   * Sub-chips de "Boleto sem DDA" (I19r). Só restringem os títulos cujo principal é
   * `BOLETO_SEM_DDA`, e só enquanto esse motivo está em `situacoes`.
   */
  sugestoesBoleto: SugestaoBoletoSemDda[]
  donos: DonoPagamento[]
  filiais: number[]
}

export const FILTROS_VAZIOS: FiltrosTitulos = {
  estado: 'todos',
  credor: '',
  documento: '',
  numeroDocumento: '',
  valorMin: '',
  valorMax: '',
  faixas: [],
  vencDe: '',
  vencAte: '',
  formas: [],
  situacoes: [],
  sugestoesBoleto: [],
  donos: [],
  filiais: [],
}

export type ColunaTitulo =
  | 'credor'
  | 'documento'
  | 'numeroDocumento'
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

/**
 * Faixa do título pelo PRAZO EFETIVO (I19t): o boleto sugerido que vence antes do título puxa a
 * faixa; o "perdido" cai sempre em Vencidos — como filtro, sem virar o motivo `VENCIDO` (I19e).
 */
export const faixaDoTitulo = (t: TituloAPagar): FaixaVencimento | undefined =>
  estaPerdido(t) ? 'VENCIDO' : faixaDeVencimento(diasAtePrazo(t))

const valorNumerico = (s: string): number | undefined => {
  if (s.trim() === '') return undefined
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

export const contarFiltrosDeColuna = (f: FiltrosTitulos): number =>
  (f.credor ? 1 : 0) +
  (f.documento ? 1 : 0) +
  (f.numeroDocumento ? 1 : 0) +
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

const passaSugestaoBoleto = (t: TituloAPagar, f: FiltrosTitulos): boolean => {
  if (f.sugestoesBoleto.length === 0) return true
  if (!f.situacoes.includes(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA)) return true
  if (situacaoChave(t) !== MOTIVO_PAGAMENTO.BOLETO_SEM_DDA) return true
  const s = t.situacaoPagamento?.sugestaoBoleto
  return s !== undefined && f.sugestoesBoleto.includes(s)
}

export const passaColunas = (t: TituloAPagar, f: FiltrosTitulos): boolean => {
  if (f.credor && !norm(t.credor ?? '').includes(norm(f.credor))) return false
  if (f.documento && !norm(`${t.docCod}/${t.titCod}`).includes(norm(f.documento))) return false
  if (f.numeroDocumento && !norm(t.numeroDocumento ?? '').includes(norm(f.numeroDocumento))) {
    return false
  }
  const min = valorNumerico(f.valorMin)
  const max = valorNumerico(f.valorMax)
  if (min !== undefined && t.valor < min) return false
  if (max !== undefined && t.valor > max) return false
  if (f.faixas.length > 0) {
    const faixa = faixaDoTitulo(t)
    if (!faixa || !f.faixas.includes(faixa)) return false
  }
  if (f.vencDe || f.vencAte) {
    const dias = diasDoTitulo(t)
    const naJanela = dias.some(
      (dia) => (!f.vencDe || dia >= f.vencDe) && (!f.vencAte || dia <= f.vencAte),
    )
    if (!naJanela) return false
  }
  if (f.formas.length > 0 && !f.formas.includes(formaDePagamento(t).chave)) return false
  if (f.situacoes.length > 0 && !f.situacoes.includes(situacaoChave(t))) return false
  if (!passaSugestaoBoleto(t, f)) return false
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
    case 'numeroDocumento':
      return t.numeroDocumento ?? ''
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

/**
 * Faixa vermelha: bloqueados cujo PRAZO EFETIVO é hoje (vencidos ficam de fora, decisão D2; o
 * "perdido" também, I19t(5): tem linha própria).
 */
export const bloqueadosQueVencemHoje = (titulos: TituloAPagar[]): TituloAPagar[] =>
  titulos
    .filter((t) => ehBloqueado(t) && !estaPerdido(t) && diasAtePrazo(t) === 0)
    .sort((a, b) => b.valor - a.valor)

/** Bloqueados com boleto perdido (I19t(5)): linha separada, "resolver no portal do banco". */
export const bloqueadosPerdidos = (titulos: TituloAPagar[]): TituloAPagar[] =>
  titulos.filter((t) => ehBloqueado(t) && estaPerdido(t)).sort((a, b) => b.valor - a.valor)

/** Card "Vencem em até 2 dias": hoje, amanhã e depois (vencidos não entram). */
export const vencemEmAteDoisDias = (titulos: TituloAPagar[]): TituloAPagar[] =>
  titulos.filter(
    (t) =>
      t.diasAteVencimento !== undefined && t.diasAteVencimento >= 0 && t.diasAteVencimento <= 2,
  )

/** Janela da formação automática: só entram títulos que vencem de hoje a 7 dias (ADR-0018). */
export const JANELA_FORMACAO_DIAS = 7

/**
 * Prévia do "Formar lotes automáticos" (decisão D9): só PRONTO, a vencer na janela, fora de
 * qualquer lote, agrupados por filial. O servidor ainda divide cada filial por vencimento; a
 * prévia mostra o que entra, não o número exato de lotes por filial.
 */
export const prontosPorFilial = (titulos: TituloAPagar[]): Array<{ filCod: number } & Total> => {
  const porFilial = new Map<number, TituloAPagar[]>()
  for (const t of titulos) {
    if (!ehPronto(t) || t.loteComprometido || t.loteRascunho) continue
    const dias = t.diasAteVencimento
    if (dias === undefined || dias < 0 || dias > JANELA_FORMACAO_DIAS) continue
    porFilial.set(t.filCod, [...(porFilial.get(t.filCod) ?? []), t])
  }
  return [...porFilial.entries()]
    .sort(([a], [b]) => a - b)
    .map(([filCod, ts]) => ({ filCod, ...somar(ts) }))
}

/** Contagem e valor do filtro externo, sobre a lista da tela (a mesma que a tabela mostra). */
export const totaisPorEstado = (
  titulos: TituloAPagar[],
): Record<EstadoFiltro, Total> => ({
  todos: somar(titulos),
  prontos: somar(titulos.filter(ehPronto)),
  bloqueados: somar(titulos.filter(ehBloqueado)),
})

/** Chips de motivo (só quem tem ao menos um título), na ordem de prioridade do contrato. */
export const bloqueadosPorMotivo = (
  titulos: TituloAPagar[],
): Array<{ motivo: MotivoPagamento } & Total> => {
  const porMotivo = new Map<MotivoPagamento, TituloAPagar[]>()
  for (const t of titulos) {
    const m = t.situacaoPagamento?.principal
    if (!m || !ehBloqueado(t)) continue
    porMotivo.set(m, [...(porMotivo.get(m) ?? []), t])
  }
  return Object.values(MOTIVO_PAGAMENTO).flatMap((motivo) => {
    const ts = porMotivo.get(motivo)
    return ts ? [{ motivo, ...somar(ts) }] : []
  })
}

/**
 * Sub-chips de "Boleto sem DDA" (I19r), na ordem do contrato. Vazio quando o backend não manda
 * `sugestaoBoleto` (versão antiga): a tela fica só com o chip do motivo.
 */
export const boletoSemDdaPorSugestao = (
  titulos: TituloAPagar[],
): Array<{ sugestao: SugestaoBoletoSemDda } & Total> => {
  const porSugestao = new Map<SugestaoBoletoSemDda, TituloAPagar[]>()
  for (const t of titulos) {
    const s = t.situacaoPagamento?.sugestaoBoleto
    if (!s || !ehBloqueado(t) || situacaoChave(t) !== MOTIVO_PAGAMENTO.BOLETO_SEM_DDA) continue
    porSugestao.set(s, [...(porSugestao.get(s) ?? []), t])
  }
  return Object.values(SUGESTAO_BOLETO_SEM_DDA).flatMap((sugestao) => {
    const ts = porSugestao.get(sugestao)
    return ts ? [{ sugestao, ...somar(ts) }] : []
  })
}

/**
 * Linha do título aberto na gaveta de boletos (não modal): fundo `primary/10` e filete à esquerda
 * (`--shadow-selection`, largura `--selection-bar-width`). O texto `muted-foreground` não passa
 * 4.5:1 sobre esse fundo (3.9:1), então dentro da linha ativa ele escurece para `foreground/70`
 * (6.9:1). Contas em `tokens.md` §Seleção de linha.
 */
export const CLASSE_LINHA_ATIVA =
  'bg-primary/10 shadow-[var(--shadow-selection)] hover:bg-primary/10 [&_.text-muted-foreground]:text-foreground/70'

/**
 * Com a gaveta de boletos aberta entre `xl` e `2xl` (1280–1535px) a gaveta cobre o lado direito
 * da tabela. Estas colunas de menor prioridade saem nessa faixa para que Credor, Documento, Nº doc,
 * Valor, Vencimento e Forma de pagamento (onde está o gatilho da gaveta) caibam. Fora da faixa, ou
 * com a gaveta fechada, nenhuma coluna some.
 */
export const COLUNAS_OCULTAS_COM_GAVETA: ReadonlySet<ColunaTitulo> = new Set<ColunaTitulo>([
  'situacao',
  'acao',
  'filial',
])

/** Classes de layout da tabela de títulos conforme a gaveta (`xl:max-2xl` só vale com ela aberta). */
export interface LayoutComGaveta {
  /**
   * Contêiner (rolagem) da tabela: termina onde a gaveta começa. A reserva desconta o padding
   * direito da área principal, que já fica sob a gaveta.
   */
  tabela?: string
  /** Coluna de baixa prioridade: some na faixa. */
  ocultar?: string
  /** Cabeçalho com filtro: o rótulo quebra linha e o funil desce, em vez de alargar a coluna. */
  cabecalho?: string
  /** Credor: largura máxima menor (nome inteiro no `title`). */
  credor?: string
  /** Célula que pode quebrar linha (Forma de pagamento). */
  quebra?: string
}

export const layoutComGaveta = (gavetaAberta: boolean): LayoutComGaveta =>
  gavetaAberta
    ? {
        tabela: 'xl:max-2xl:mr-[var(--drawer-detail-reserve)]',
        ocultar: 'xl:max-2xl:hidden',
        cabecalho: 'xl:max-2xl:whitespace-normal xl:max-2xl:[&>div]:flex-wrap',
        credor: 'xl:max-2xl:max-w-28',
        quebra: 'xl:max-2xl:whitespace-normal',
      }
    : {}

/** Classe da coluna `c` (só as de `COLUNAS_OCULTAS_COM_GAVETA` somem, e só com a gaveta aberta). */
export const classeDaColunaComGaveta = (c: ColunaTitulo, gavetaAberta: boolean): string | undefined =>
  COLUNAS_OCULTAS_COM_GAVETA.has(c) ? layoutComGaveta(gavetaAberta).ocultar : undefined

import type {
  BoletoDdaColuna,
  BoletoDdaEscopo,
  BoletoDdaFaixa,
  BoletoDdaFiltroFilial,
  BoletoDdaSituacao,
  BoletosDdaResposta,
  FiltroBoletosDda,
} from '@/lib/sispag'
import { formatarDia } from '../components/filtrosAbas'
import { ROTULO_FAIXA } from '../situacao/situacaoTitulos'

/** Linhas por página — a mesma de Títulos a pagar. */
export const BOLETOS_DDA_POR_PAGINA = 25

/** Faixas que o card "Vencem em até 2 dias" liga (as `FAIXAS_URGENTES` de Títulos). */
export const FAIXAS_URGENTES_DDA: readonly BoletoDdaFaixa[] = ['HOJE', '1-2']
/** Situações que pedem ação na aba: urgência e "vencem hoje" não contam o casado (I-DDA5 §urgência). */
export const SITUACOES_NAO_CASADAS: readonly BoletoDdaSituacao[] = ['CANDIDATO', 'AMBIGUO', 'SEM_TITULO']
export const SITUACOES_PARA_CONFERIR: readonly BoletoDdaSituacao[] = ['CANDIDATO', 'AMBIGUO']

export const ROTULO_SITUACAO_DDA: Readonly<Record<BoletoDdaSituacao, string>> = {
  VINCULADO: 'Casado',
  CANDIDATO: 'Candidato',
  AMBIGUO: 'Ambíguo',
  SEM_TITULO: 'Sem título',
}

/** Segmentos do filtro externo. `misto` = a coluna Situação tem uma combinação sem segmento. */
export type SegmentoDda = 'todos' | 'casados' | 'conferir' | 'sem-titulo'

export interface FiltrosBoletosDda {
  escopo: BoletoDdaEscopo
  /** O MESMO estado do segmento, dos chips "Por situação" e da coluna Situação. */
  situacoes: BoletoDdaSituacao[]
  emGrupo: boolean
  busca: string
  numero: string
  titulo: string
  valorMin: string
  valorMax: string
  faixas: BoletoDdaFaixa[]
  /** `YYYY-MM-DD`. */
  vencDe: string
  vencAte: string
  bancos: string[]
  filiais: BoletoDdaFiltroFilial[]
}

export const FILTROS_DDA_VAZIOS: FiltrosBoletosDda = {
  escopo: 'a-vencer',
  situacoes: [],
  emGrupo: false,
  busca: '',
  numero: '',
  titulo: '',
  valorMin: '',
  valorMax: '',
  faixas: [],
  vencDe: '',
  vencAte: '',
  bancos: [],
  filiais: [],
}

/** Campos digitados: vão ao servidor depois do debounce, não a cada tecla. */
export type TextosDda = Pick<FiltrosBoletosDda, 'busca' | 'numero' | 'titulo' | 'valorMin' | 'valorMax'>
export const textosDe = (f: FiltrosBoletosDda): TextosDda => ({
  busca: f.busca,
  numero: f.numero,
  titulo: f.titulo,
  valorMin: f.valorMin,
  valorMax: f.valorMax,
})

export interface OrdemDda {
  coluna: BoletoDdaColuna
  direcao: 1 | -1
}

const mesmoConjunto = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

/** Que segmento as situações escolhidas representam (`undefined` = combinação sem segmento). */
export const segmentoDe = (situacoes: readonly BoletoDdaSituacao[]): SegmentoDda | undefined => {
  if (situacoes.length === 0) return 'todos'
  if (mesmoConjunto(situacoes, ['VINCULADO'])) return 'casados'
  if (mesmoConjunto(situacoes, ['SEM_TITULO'])) return 'sem-titulo'
  if (situacoes.every((s) => SITUACOES_PARA_CONFERIR.includes(s))) return 'conferir'
  return undefined
}

export const situacoesDoSegmento = (s: SegmentoDda): BoletoDdaSituacao[] => {
  switch (s) {
    case 'todos':
      return []
    case 'casados':
      return ['VINCULADO']
    case 'conferir':
      return [...SITUACOES_PARA_CONFERIR]
    case 'sem-titulo':
      return ['SEM_TITULO']
  }
}

/**
 * Chip "Candidato"/"Ambíguo" dentro de Para conferir. Nenhum marcado = os dois (como os motivos
 * de Títulos); marcar um restringe; desmarcar volta aos dois.
 */
export const alternarSituacaoConferir = (
  situacoes: readonly BoletoDdaSituacao[],
  s: BoletoDdaSituacao,
): BoletoDdaSituacao[] => {
  const marcadas = situacoes.length === 1 ? situacoes : []
  return marcadas.includes(s) || marcadas.length > 0 ? [...SITUACOES_PARA_CONFERIR] : [s]
}

export const urgentesAtivo = (f: FiltrosBoletosDda): boolean =>
  mesmoConjunto(f.faixas, FAIXAS_URGENTES_DDA) && mesmoConjunto(f.situacoes, SITUACOES_NAO_CASADAS)

const numeroOuNada = (s: string): number | undefined => {
  if (s.trim() === '') return undefined
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** O pedido ao servidor: só o que está ativo (a query fica igual à de antes sem filtro). */
export const filtroDoServidor = (
  f: FiltrosBoletosDda,
  textos: TextosDda,
  pagina: number,
  ordem: OrdemDda | null,
): FiltroBoletosDda => {
  const valorMin = numeroOuNada(textos.valorMin)
  const valorMax = numeroOuNada(textos.valorMax)
  return {
    escopo: f.escopo,
    pagina,
    tamanho: BOLETOS_DDA_POR_PAGINA,
    ...(f.situacoes.length ? { situacoes: f.situacoes } : {}),
    ...(f.emGrupo ? { emGrupo: true } : {}),
    ...(textos.busca.trim() ? { busca: textos.busca.trim() } : {}),
    ...(textos.numero.trim() ? { numero: textos.numero.trim() } : {}),
    ...(textos.titulo.trim() ? { titulo: textos.titulo.trim() } : {}),
    ...(valorMin !== undefined ? { valorMin } : {}),
    ...(valorMax !== undefined ? { valorMax } : {}),
    ...(f.faixas.length ? { faixas: f.faixas } : {}),
    ...(f.vencDe ? { vencimentoDe: f.vencDe } : {}),
    ...(f.vencAte ? { vencimentoAte: f.vencAte } : {}),
    ...(f.bancos.length ? { bancos: f.bancos } : {}),
    ...(f.filiais.length ? { filiais: f.filiais } : {}),
    ...(ordem ? { ordem } : {}),
  }
}

/** Algum filtro além do escopo (para "Limpar filtros" e o texto do estado vazio). */
export const haFiltroDda = (f: FiltrosBoletosDda): boolean =>
  f.situacoes.length > 0 ||
  f.emGrupo ||
  f.busca.trim() !== '' ||
  descreverFiltrosDda(f).length > 0

export interface FiltroAtivoDda {
  id: string
  texto: string
  remover: Partial<FiltrosBoletosDda>
}

const reais = (s: string): string => Number(s.replace(',', '.')).toLocaleString('pt-BR')
export const rotuloFilial = (f: BoletoDdaFiltroFilial): string =>
  f === 'sem' ? 'sem filial' : String(f)

/** Etiquetas dos filtros de COLUNA ativos (segmento e chips têm a própria barra). */
export const descreverFiltrosDda = (f: FiltrosBoletosDda): FiltroAtivoDda[] => {
  const out: FiltroAtivoDda[] = []
  if (f.numero.trim()) {
    out.push({ id: 'numero', texto: `Boleto contém "${f.numero.trim()}"`, remover: { numero: '' } })
  }
  if (f.titulo.trim()) {
    out.push({ id: 'titulo', texto: `Título contém "${f.titulo.trim()}"`, remover: { titulo: '' } })
  }
  if (f.valorMin !== '' || f.valorMax !== '') {
    const partes = [
      f.valorMin !== '' ? `de R$ ${reais(f.valorMin)}` : '',
      f.valorMax !== '' ? `até R$ ${reais(f.valorMax)}` : '',
    ].filter(Boolean)
    out.push({ id: 'valor', texto: `Valor ${partes.join(' ')}`, remover: { valorMin: '', valorMax: '' } })
  }
  if (f.faixas.length > 0) {
    out.push({
      id: 'faixas',
      texto: `Vencimento: ${f.faixas.map((x) => ROTULO_FAIXA[x].toLowerCase()).join(', ')}`,
      remover: { faixas: [] },
    })
  }
  if (f.vencDe || f.vencAte) {
    const partes = [
      f.vencDe ? `de ${formatarDia(f.vencDe)}` : '',
      f.vencAte ? `até ${formatarDia(f.vencAte)}` : '',
    ].filter(Boolean)
    out.push({ id: 'periodo', texto: `Vencimento ${partes.join(' ')}`, remover: { vencDe: '', vencAte: '' } })
  }
  if (f.bancos.length > 0) {
    out.push({ id: 'bancos', texto: `Banco ${f.bancos.join(', ')}`, remover: { bancos: [] } })
  }
  if (f.filiais.length > 0) {
    out.push({
      id: 'filiais',
      texto: `Filial ${f.filiais.map(rotuloFilial).join(', ')}`,
      remover: { filiais: [] },
    })
  }
  if (f.situacoes.length > 0 && segmentoDe(f.situacoes) === undefined) {
    out.push({
      id: 'situacoes',
      texto: `Situação: ${f.situacoes.map((s) => ROTULO_SITUACAO_DDA[s].toLowerCase()).join(', ')}`,
      remover: { situacoes: [] },
    })
  }
  return out
}

/** Quantidade e valor de uma chave dos totais; backend antigo manda só a contagem (valor "—"). */
export interface TotalDda {
  qtd?: number
  valor?: number
}
export type ChaveTotalDda = keyof NonNullable<BoletosDdaResposta['totais']>

export const totalDe = (dados: BoletosDdaResposta | undefined, chave: ChaveTotalDda): TotalDda => {
  if (!dados) return {}
  const t = dados.totais?.[chave]
  if (t) return t
  const qtd = (dados.contagem as Record<string, number | undefined> | undefined)?.[chave]
  return qtd === undefined ? {} : { qtd }
}

export const somaTotais = (...ts: TotalDda[]): TotalDda => ({
  ...(ts.every((t) => t.qtd !== undefined)
    ? { qtd: ts.reduce((a, t) => a + (t.qtd ?? 0), 0) }
    : {}),
  ...(ts.every((t) => t.valor !== undefined)
    ? { valor: Math.round(ts.reduce((a, t) => a + (t.valor ?? 0), 0) * 100) / 100 }
    : {}),
})

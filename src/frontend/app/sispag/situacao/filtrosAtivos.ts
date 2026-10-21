import {
  formaDePagamento,
  MOTIVO_PAGAMENTO,
  ORDEM_FORMA_DE_PAGAMENTO,
  type TituloAPagar,
} from '@/lib/sispag'
import { formatarDia } from '../components/filtrosAbas'
import { ROTULO_DONO, ROTULO_MOTIVO, ROTULO_SUGESTAO_BOLETO } from './rotulos'
import {
  donoDe,
  type FiltrosTitulos,
  ROTULO_FAIXA,
  SITUACAO_PRONTO,
  type SituacaoChave,
  situacaoChave,
} from './situacaoTitulos'

/** Uma etiqueta de filtro ativo, com o que zerar quando a analista a remove. */
export interface FiltroAtivo {
  id: string
  texto: string
  remover: Partial<FiltrosTitulos>
}

const reais = (s: string): string => Number(s.replace(',', '.')).toLocaleString('pt-BR')

const rotuloSituacaoChave = (s: SituacaoChave): string =>
  s === SITUACAO_PRONTO ? 'Pronto' : ROTULO_MOTIVO[s]

/** Etiquetas dos filtros de COLUNA ativos (o filtro externo tem a própria barra). */
export const descreverFiltros = (f: FiltrosTitulos): FiltroAtivo[] => {
  const out: FiltroAtivo[] = []
  if (f.credor) out.push({ id: 'credor', texto: `Credor contém "${f.credor}"`, remover: { credor: '' } })
  if (f.documento) {
    out.push({ id: 'documento', texto: `Documento contém "${f.documento}"`, remover: { documento: '' } })
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
  if (f.formas.length > 0) {
    out.push({ id: 'formas', texto: `Forma: ${f.formas.join(', ')}`, remover: { formas: [] } })
  }
  if (f.situacoes.length > 0) {
    out.push({
      id: 'situacoes',
      texto: `Situação: ${f.situacoes.map((s) => rotuloSituacaoChave(s).toLowerCase()).join(', ')}`,
      remover: { situacoes: [], sugestoesBoleto: [] },
    })
  }
  if (f.sugestoesBoleto.length > 0 && f.situacoes.includes(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA)) {
    out.push({
      id: 'sugestoesBoleto',
      texto: `Boleto sem DDA: ${f.sugestoesBoleto.map((s) => ROTULO_SUGESTAO_BOLETO[s].toLowerCase()).join(', ')}`,
      remover: { sugestoesBoleto: [] },
    })
  }
  if (f.donos.length > 0) {
    out.push({
      id: 'donos',
      texto: `Resolve: ${f.donos.map((d) => ROTULO_DONO[d].toLowerCase()).join(', ')}`,
      remover: { donos: [] },
    })
  }
  if (f.filiais.length > 0) {
    out.push({ id: 'filiais', texto: `Filial ${f.filiais.join(', ')}`, remover: { filiais: [] } })
  }
  return out
}

export interface OpcoesDosFiltros {
  formas: Array<{ valor: string; rotulo: string; total: number }>
  situacoes: Array<{ valor: SituacaoChave; rotulo: string; total: number }>
  donos: Array<{ valor: ReturnType<typeof donoDe>; rotulo: string; total: number }>
  filiais: Array<{ valor: number; rotulo: string; total: number }>
}

const contar = <K,>(titulos: TituloAPagar[], chave: (t: TituloAPagar) => K): Map<K, number> => {
  const m = new Map<K, number>()
  for (const t of titulos) m.set(chave(t), (m.get(chave(t)) ?? 0) + 1)
  return m
}

/** Opções dos filtros de múltipla escolha: só o que existe na lista, com a contagem de cada uma. */
export const opcoesDosFiltros = (titulos: TituloAPagar[]): OpcoesDosFiltros => {
  const formas = new Map<string, { rotulo: string; total: number }>()
  for (const t of titulos) {
    const { chave, rotulo } = formaDePagamento(t)
    formas.set(chave, { rotulo, total: (formas.get(chave)?.total ?? 0) + 1 })
  }
  const ordem = ORDEM_FORMA_DE_PAGAMENTO as readonly string[]
  const situacoes = contar(titulos, situacaoChave)
  const donos = contar(titulos, donoDe)
  const filiais = contar(titulos, (t) => t.filCod)
  return {
    formas: [...formas.entries()]
      .sort(([a], [b]) => {
        const ia = ordem.indexOf(a)
        const ib = ordem.indexOf(b)
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b)
      })
      .map(([valor, v]) => ({ valor, ...v })),
    situacoes: [SITUACAO_PRONTO, ...Object.values(MOTIVO_PAGAMENTO)].flatMap((valor) => {
      const total = situacoes.get(valor)
      return total ? [{ valor, rotulo: rotuloSituacaoChave(valor), total }] : []
    }),
    donos: [...donos.entries()].map(([valor, total]) => ({ valor, rotulo: ROTULO_DONO[valor], total })),
    filiais: [...filiais.entries()]
      .sort(([a], [b]) => a - b)
      .map(([valor, total]) => ({ valor, rotulo: `Filial ${valor}`, total })),
  }
}

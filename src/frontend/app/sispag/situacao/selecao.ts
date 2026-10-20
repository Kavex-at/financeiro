import type { TituloAPagar } from '@/lib/sispag'
import { chaveTitulo } from '../components/selecionarTodos'
import { motivoSelecaoBloqueada } from '../components/moverParaLote'
import { ehPronto } from './situacaoTitulos'

/**
 * Seleção da aba de títulos com situação de pagamento (ADR-0075). Só título PRONTO se seleciona
 * (bloqueado não tem caixa) e, diferente do fluxo antigo, a seleção pode atravessar filiais: o
 * "Criar lotes" cria um lote por filial.
 */

/**
 * Pronto e livre de lote. Título já em lote RASCUNHO não se seleciona aqui: o contrato de
 * `POST /sispag/lotes/por-filial` não tem o `mover` do ADR-0064 (ver CONTRACT-NOTES.md), então o
 * servidor o recusaria. Ele sai do rascunho pelo "Retirar do lote" da linha.
 */
export const selecionavel = (t: TituloAPagar): boolean =>
  ehPronto(t) && !t.loteComprometido && !t.loteRascunho

/** Motivo de uma linha não ser selecionável (tooltip/aria-label), ou `undefined` se é. */
export const motivoNaoSelecionavel = (t: TituloAPagar): string | undefined => {
  if (!ehPronto(t)) {
    const s = t.situacaoPagamento
    return s?.rotulo
      ? `Bloqueado: ${s.rotulo}. Resolva antes de incluir em um lote.`
      : 'Bloqueado. Resolva antes de incluir em um lote.'
  }
  if (t.loteComprometido) return motivoSelecaoBloqueada(t)
  if (t.loteRascunho) return 'Já está em um lote em rascunho. Use "Retirar do lote" para usá-lo em outro.'
  return undefined
}

export interface EstadoSelecionarTodosSituacao {
  marcado: boolean | 'indeterminate'
  /** Chaves das linhas selecionáveis do filtro (todas as páginas). */
  chaves: string[]
  /** Motivo de estar desabilitado, ou `undefined`. */
  bloqueio?: string
}

export const estadoSelecionarTodosSituacao = (
  filtrados: TituloAPagar[],
  selecionados: ReadonlySet<string>,
): EstadoSelecionarTodosSituacao => {
  const chaves = filtrados.filter(selecionavel).map(chaveTitulo)
  if (chaves.length === 0) return { marcado: false, chaves, bloqueio: 'Nenhum título pronto neste filtro' }
  const marcadas = chaves.filter((k) => selecionados.has(k)).length
  return {
    marcado: marcadas === 0 ? false : marcadas === chaves.length ? true : 'indeterminate',
    chaves,
  }
}

/** Marca todos os prontos do filtro, ou desmarca se já havia alguma marcada. Fora do filtro: intacto. */
export const alternarTodosSituacao = (
  estado: EstadoSelecionarTodosSituacao,
  selecionados: ReadonlySet<string>,
): Set<string> => {
  const next = new Set(selecionados)
  if (estado.bloqueio) return next
  if (estado.marcado === false) for (const k of estado.chaves) next.add(k)
  else for (const k of estado.chaves) next.delete(k)
  return next
}

export interface ResumoSelecao {
  qtd: number
  valor: number
  filiais: number[]
}

export const resumirSelecao = (
  titulos: TituloAPagar[],
  selecionados: ReadonlySet<string>,
): ResumoSelecao => {
  const marcados = titulos.filter((t) => selecionados.has(chaveTitulo(t)))
  return {
    qtd: marcados.length,
    valor: marcados.reduce((acc, t) => acc + t.valor, 0),
    filiais: [...new Set(marcados.map((t) => t.filCod))].sort((a, b) => a - b),
  }
}

import {
  ESTADO_PRONTIDAO,
  EFEITO_PENDENCIA,
  type ItemLote,
  type LotePagamento,
  type PendenciaLote,
} from '@/lib/sispag'

/**
 * Lógica pura da aba de lotes em rascunho (ADR-0076): filtro "Todos / Prontos para finalizar / Com
 * pendência", ordenação e a seleção dos lotes para "Finalizar os N lotes prontos". A regra do que
 * é pendência vem pronta do backend (`lote.prontidao`); aqui só se conta, filtra e ordena.
 */

export type FiltroProntidao = 'todos' | 'prontos' | 'com-pendencia'
export type OrdemLotes = 'pendencias' | 'vencimento' | 'valor' | 'filial'

export const ROTULO_FILTRO_PRONTIDAO: Readonly<Record<FiltroProntidao, string>> = {
  todos: 'Todos',
  prontos: 'Prontos para finalizar',
  'com-pendencia': 'Com pendência',
}

export const ROTULO_ORDEM_LOTES: Readonly<Record<OrdemLotes, string>> = {
  pendencias: 'Pendências primeiro',
  vencimento: 'Vencimento',
  valor: 'Valor',
  filial: 'Filial',
}

export const ROTULO_EFEITO: Readonly<Record<PendenciaLote['efeito'], string>> = {
  [EFEITO_PENDENCIA.BARRA]: 'Barra a finalização',
  [EFEITO_PENDENCIA.SAI]: 'Sai do lote',
}

/** Pronto só com a prontidão do servidor dizendo PRONTO; sem ela (backend antigo, falha), não. */
export const ehPronto = (l: LotePagamento): boolean =>
  l.prontidao?.estado === ESTADO_PRONTIDAO.PRONTO

/** "Com pendência" = há prontidão e ela não é PRONTO. Lote sem prontidão só aparece em Todos. */
const temPendencia = (l: LotePagamento): boolean =>
  l.prontidao !== undefined && l.prontidao.estado !== ESTADO_PRONTIDAO.PRONTO

export const contarProntidao = (lotes: readonly LotePagamento[]): Record<FiltroProntidao, number> => ({
  todos: lotes.length,
  prontos: lotes.filter(ehPronto).length,
  'com-pendencia': lotes.filter(temPendencia).length,
})

export const filtrarPorProntidao = (
  lotes: readonly LotePagamento[],
  filtro: FiltroProntidao,
): LotePagamento[] =>
  filtro === 'prontos'
    ? lotes.filter(ehPronto)
    : filtro === 'com-pendencia'
      ? lotes.filter(temPendencia)
      : [...lotes]

export const totalDoLote = (l: LotePagamento): number =>
  l.itens.reduce((acc, i: ItemLote) => acc + (i.valor ?? 0), 0)

/** Vencimento mais próximo dos itens (epoch); `undefined` quando nenhum item tem. */
export const vencimentoDoLote = (l: LotePagamento): number | undefined => {
  const vs = l.itens.map((i) => i.vencimento).filter((v): v is number => v !== undefined)
  return vs.length > 0 ? Math.min(...vs) : undefined
}

/** O que barra pesa mais do que o que sai: um lote que não finaliza vem antes. */
const pesoPendencia = (l: LotePagamento): number =>
  l.prontidao ? l.prontidao.barram * 10 + l.prontidao.saem + (l.prontidao.estado === ESTADO_PRONTIDAO.PRONTO ? 0 : 1) : 0

const porVencimento = (a: LotePagamento, b: LotePagamento): number =>
  (vencimentoDoLote(a) ?? Number.POSITIVE_INFINITY) - (vencimentoDoLote(b) ?? Number.POSITIVE_INFINITY)

export const ordenarLotes = (lotes: readonly LotePagamento[], ordem: OrdemLotes): LotePagamento[] => {
  const copia = [...lotes]
  switch (ordem) {
    case 'pendencias':
      return copia.sort((a, b) => pesoPendencia(b) - pesoPendencia(a) || porVencimento(a, b))
    case 'vencimento':
      return copia.sort(porVencimento)
    case 'valor':
      return copia.sort((a, b) => totalDoLote(b) - totalDoLote(a))
    case 'filial':
      return copia.sort((a, b) => a.filCod - b.filCod || porVencimento(a, b))
  }
}

export interface ResultadoFinalizacao {
  lote: LotePagamento
  ok: boolean
  /** Sucesso: itens TED/PIX que a verificação retirou. Falha: a mensagem do servidor. */
  mensagem?: string
  retirados?: number
}

/**
 * Finaliza um lote por vez (D20): cada um pelo endpoint que já existe, na ordem dada. Um lote que
 * falha não interrompe os outros; o resultado volta lote a lote.
 */
export const finalizarEmSequencia = async (
  lotes: readonly LotePagamento[],
  finalizar: (l: LotePagamento) => Promise<{ retirados: unknown[] }>,
  aoAvancar?: (feitos: number) => void,
): Promise<ResultadoFinalizacao[]> => {
  const resultados: ResultadoFinalizacao[] = []
  for (const lote of lotes) {
    try {
      const { retirados } = await finalizar(lote)
      resultados.push({ lote, ok: true, retirados: retirados.length })
    } catch (e) {
      resultados.push({
        lote,
        ok: false,
        mensagem: e instanceof Error ? e.message : 'Não foi possível finalizar este lote.',
      })
    }
    aoAvancar?.(resultados.length)
  }
  return resultados
}

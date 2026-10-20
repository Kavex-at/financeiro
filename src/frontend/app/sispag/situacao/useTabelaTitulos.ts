'use client'

import * as React from 'react'
import type { MotivoPagamento, TituloAPagar } from '@/lib/sispag'
import {
  aplicarFiltros,
  type ColunaTitulo,
  type EstadoFiltro,
  FILTROS_VAZIOS,
  type FaixaVencimento,
  type FiltrosTitulos,
  ORDENACAO_PADRAO,
  ordenarTitulos,
  type Ordenacao,
  SITUACAO_PRONTO,
  type SituacaoChave,
} from './situacaoTitulos'

export const TITULOS_POR_PAGINA = 25

/** Faixas que o card "Vencem em até 2 dias" liga: hoje e 1 a 2 dias. */
export const FAIXAS_URGENTES: readonly FaixaVencimento[] = ['HOJE', '1-2']

const mesmaLista = <T,>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x))

/**
 * Estado da tabela de títulos com situação de pagamento: filtros por coluna, o filtro externo,
 * a ordenação e a paginação. Mudar filtro ou ordem volta à primeira página. Não toca o contrato do
 * `useTabelaFiltro` de Permutas: é um hook ao lado, com as regras puras em `situacaoTitulos.ts`.
 */
export function useTabelaTitulos(titulos: TituloAPagar[]) {
  const [filtros, setFiltros] = React.useState<FiltrosTitulos>(FILTROS_VAZIOS)
  const [ordenacao, setOrdenacao] = React.useState<Ordenacao>(ORDENACAO_PADRAO)
  const [paginaBruta, setPaginaBruta] = React.useState(1)

  const filtrados = React.useMemo(
    () => ordenarTitulos(aplicarFiltros(titulos, filtros), ordenacao),
    [titulos, filtros, ordenacao],
  )
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / TITULOS_POR_PAGINA))
  const pagina = Math.min(paginaBruta, totalPaginas)
  const slice = React.useMemo(
    () => filtrados.slice((pagina - 1) * TITULOS_POR_PAGINA, pagina * TITULOS_POR_PAGINA),
    [filtrados, pagina],
  )

  const atualizar = React.useCallback((parcial: Partial<FiltrosTitulos>) => {
    setFiltros((f) => ({ ...f, ...parcial }))
    setPaginaBruta(1)
  }, [])

  const definirEstado = React.useCallback(
    (estado: EstadoFiltro) => {
      // Sair de Bloqueados descarta os motivos escolhidos: eles só existem ali.
      setFiltros((f) => ({
        ...f,
        estado,
        situacoes:
          estado === 'bloqueados' ? f.situacoes : f.situacoes.filter((s) => s === SITUACAO_PRONTO),
      }))
      setPaginaBruta(1)
    },
    [],
  )

  const alternarMotivo = React.useCallback((motivo: MotivoPagamento) => {
    setFiltros((f) => ({
      ...f,
      situacoes: f.situacoes.includes(motivo)
        ? f.situacoes.filter((s) => s !== motivo)
        : [...f.situacoes, motivo],
    }))
    setPaginaBruta(1)
  }, [])

  const ordenar = React.useCallback((coluna: ColunaTitulo, direcao: 1 | -1) => {
    setOrdenacao({ coluna, direcao })
    setPaginaBruta(1)
  }, [])

  const limpar = React.useCallback(() => {
    setFiltros(FILTROS_VAZIOS)
    setPaginaBruta(1)
  }, [])

  const urgentesAtivo = mesmaLista(filtros.faixas, FAIXAS_URGENTES)
  const alternarUrgentes = React.useCallback(() => {
    setFiltros((f) => ({
      ...f,
      faixas: mesmaLista(f.faixas, FAIXAS_URGENTES) ? [] : [...FAIXAS_URGENTES],
    }))
    setPaginaBruta(1)
  }, [])

  return {
    filtros,
    ordenacao,
    filtrados,
    slice,
    pagina,
    totalPaginas,
    pageSize: TITULOS_POR_PAGINA,
    setPagina: setPaginaBruta,
    atualizar,
    definirEstado,
    alternarMotivo,
    ordenar,
    limpar,
    urgentesAtivo,
    alternarUrgentes,
  }
}

export type TabelaTitulosEstado = ReturnType<typeof useTabelaTitulos>

export type { SituacaoChave }

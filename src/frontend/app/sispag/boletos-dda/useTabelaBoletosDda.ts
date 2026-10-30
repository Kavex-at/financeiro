'use client'

import * as React from 'react'
import type { BoletoDdaColuna, FiltroBoletosDda } from '@/lib/sispag'
import {
  alternarSituacaoConferir,
  FAIXAS_URGENTES_DDA,
  FILTROS_DDA_VAZIOS,
  type FiltrosBoletosDda,
  filtroDoServidor,
  type OrdemDda,
  type SegmentoDda,
  SITUACOES_NAO_CASADAS,
  situacoesDoSegmento,
  segmentoDe,
  type TextosDda,
  textosDe,
  urgentesAtivo,
} from './filtrosBoletosDda'

/** Espera antes de mandar o que foi digitado: sem isto, cada tecla vira uma requisição. */
export const DEBOUNCE_TEXTO_MS = 300

interface EstadoGuardado {
  filtros: FiltrosBoletosDda
  ordem: OrdemDda | null
  pagina: number
}

/**
 * Estado da aba guardado no MÓDULO: o `TabsContent` desmonta a aba ao trocar de aba, e sem isto
 * os filtros voltavam ao zero (Q7 da entrevista `sispag-dda-paridade`). Vive enquanto a página
 * vive; recarregar a página zera. Não vai para a URL, como em Títulos a pagar.
 */
let guardado: EstadoGuardado | undefined

/** Para testes: esquece o estado guardado entre renderizações. */
export const esquecerEstadoBoletosDda = (): void => {
  guardado = undefined
}

/**
 * Estado da tabela de Boletos DDA: filtros (segmento, chips e colunas são UM estado), ordem e
 * página. O servidor filtra, ordena e pagina; este hook só monta o pedido (`filtro`). Textos
 * digitados vão depois do debounce. Mudar filtro ou ordem volta à primeira página.
 */
export function useTabelaBoletosDda() {
  const [filtros, setFiltros] = React.useState<FiltrosBoletosDda>(
    () => guardado?.filtros ?? FILTROS_DDA_VAZIOS,
  )
  const [ordem, setOrdem] = React.useState<OrdemDda | null>(() => guardado?.ordem ?? null)
  const [pagina, setPagina] = React.useState(() => guardado?.pagina ?? 1)
  const [textosAplicados, setTextosAplicados] = React.useState<TextosDda>(() => textosDe(filtros))

  React.useEffect(() => {
    guardado = { filtros, ordem, pagina }
  }, [filtros, ordem, pagina])

  const textosAtuais = React.useMemo(() => textosDe(filtros), [filtros])
  const chaveTextos = JSON.stringify(textosAtuais)
  React.useEffect(() => {
    if (chaveTextos === JSON.stringify(textosAplicados)) return
    const t = setTimeout(() => {
      setTextosAplicados(JSON.parse(chaveTextos) as TextosDda)
      setPagina(1)
    }, DEBOUNCE_TEXTO_MS)
    return () => clearTimeout(t)
  }, [chaveTextos, textosAplicados])

  const atualizar = React.useCallback((parcial: Partial<FiltrosBoletosDda>) => {
    setFiltros((f) => ({ ...f, ...parcial }))
    setPagina(1)
  }, [])

  const definirSegmento = React.useCallback(
    (s: SegmentoDda) => atualizar({ situacoes: situacoesDoSegmento(s) }),
    [atualizar],
  )

  const alternarConferir = React.useCallback(
    (s: FiltrosBoletosDda['situacoes'][number]) => {
      setFiltros((f) => ({ ...f, situacoes: alternarSituacaoConferir(f.situacoes, s) }))
      setPagina(1)
    },
    [],
  )

  const alternarEmGrupo = React.useCallback(() => {
    setFiltros((f) => ({ ...f, emGrupo: !f.emGrupo }))
    setPagina(1)
  }, [])

  const alternarUrgentes = React.useCallback(() => {
    setFiltros((f) =>
      urgentesAtivo(f)
        ? { ...f, faixas: [], situacoes: [] }
        : { ...f, faixas: [...FAIXAS_URGENTES_DDA], situacoes: [...SITUACOES_NAO_CASADAS] },
    )
    setPagina(1)
  }, [])

  /** "Ver só estes" da faixa: os não casados que vencem hoje, sem os demais filtros. */
  const verSoHoje = React.useCallback(() => {
    setFiltros((f) => ({
      ...FILTROS_DDA_VAZIOS,
      escopo: f.escopo,
      faixas: ['HOJE'],
      situacoes: [...SITUACOES_NAO_CASADAS],
    }))
    setTextosAplicados(textosDe(FILTROS_DDA_VAZIOS))
    setPagina(1)
  }, [])

  const limpar = React.useCallback(() => {
    setFiltros((f) => ({ ...FILTROS_DDA_VAZIOS, escopo: f.escopo }))
    setTextosAplicados(textosDe(FILTROS_DDA_VAZIOS))
    setOrdem(null)
    setPagina(1)
  }, [])

  const ordenar = React.useCallback((coluna: BoletoDdaColuna, direcao: 1 | -1) => {
    setOrdem({ coluna, direcao })
    setPagina(1)
  }, [])

  // Estável por CONTEÚDO: digitar muda `filtros` a cada tecla, mas o pedido só muda no debounce.
  const chaveFiltro = JSON.stringify(filtroDoServidor(filtros, textosAplicados, pagina, ordem))
  const filtro = React.useMemo(() => JSON.parse(chaveFiltro) as FiltroBoletosDda, [chaveFiltro])

  return {
    filtros,
    ordem,
    pagina,
    setPagina,
    filtro,
    segmento: segmentoDe(filtros.situacoes),
    urgentesAtivo: urgentesAtivo(filtros),
    atualizar,
    definirSegmento,
    alternarConferir,
    alternarEmGrupo,
    alternarUrgentes,
    verSoHoje,
    limpar,
    ordenar,
  }
}

export type TabelaBoletosDdaEstado = ReturnType<typeof useTabelaBoletosDda>

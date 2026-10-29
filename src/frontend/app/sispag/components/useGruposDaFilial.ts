'use client'

import * as React from 'react'
import { fetchGruposBoleto, fetchSugestoesGrupoBoleto } from '@/lib/sispag'
import type { GruposDaFilial } from './grupoBoleto'

/**
 * Sugestões de grupo e grupos confirmados de UMA filial (os mesmos endpoints da antiga aba Boletos
 * agrupados), lidos quando a gaveta do título ou a linha do boleto abre. Falha vira `erro` com
 * "tentar de novo"; nunca derruba a tela que a hospeda.
 */
export function useGruposDaFilial(filCod: number | undefined, ativo = true) {
  const [recarga, setRecarga] = React.useState(0)
  const chave = `${filCod ?? ''}#${recarga}`
  const [estado, setEstado] = React.useState<{
    chave: string
    dados?: GruposDaFilial
    erro?: string
  } | null>(null)

  React.useEffect(() => {
    if (!ativo || filCod === undefined) return
    let vivo = true
    Promise.all([fetchSugestoesGrupoBoleto(filCod), fetchGruposBoleto(filCod)])
      .then(([sugestoes, grupos]) => {
        if (vivo) setEstado({ chave, dados: { sugestoes, grupos } })
      })
      .catch((e: unknown) => {
        if (vivo) {
          setEstado({
            chave,
            erro: e instanceof Error && e.message ? e.message : 'Falha ao carregar o grupo.',
          })
        }
      })
    return () => {
      vivo = false
    }
  }, [ativo, filCod, chave])

  const carregando = ativo && filCod !== undefined && estado?.chave !== chave
  const recarregar = React.useCallback(async () => setRecarga((n) => n + 1), [])
  return {
    dados: estado?.dados,
    erro: carregando ? undefined : estado?.erro,
    carregando,
    recarregar,
  }
}

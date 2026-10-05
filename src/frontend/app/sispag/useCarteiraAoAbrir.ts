'use client'

import * as React from 'react'
import { atualizarCarteiraSeDefasada } from '@/lib/sispag'

/** Espera entre reconferências quando OUTRA ingestão está rodando (cron ou outra pessoa). */
export const ESPERA_REFRESH_MS = 8_000
/** Quantas vezes reconferir antes de desistir (≈ 48 s; a ingestão leva ~10 s). */
export const TENTATIVAS_REFRESH = 6

export type SituacaoRefresh = 'ocioso' | 'atualizando' | 'falhou'

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Atualiza a carteira SISPAG ao abrir a tela (ADR-0060): a tela já mostra o que está gravado; este
 * hook pede ao backend o refresh se a carteira estiver defasada (TTL no servidor) e, quando uma
 * ingestão termina, chama `aoAtualizar` para recarregar o painel — sem spinner de página inteira.
 *
 * Dispara UMA vez por abertura, quando `habilitado` vira `true` (painel já carregado). Em
 * StrictMode de desenvolvimento o efeito roda duas vezes; o backend absorve (TTL e lock).
 */
export function useCarteiraAoAbrir(opts: {
  habilitado: boolean
  aoAtualizar: () => void | Promise<void>
}): { situacao: SituacaoRefresh; aviso: string | null } {
  const [situacao, setSituacao] = React.useState<SituacaoRefresh>('ocioso')
  const [aviso, setAviso] = React.useState<string | null>(null)
  // O callback muda a cada render do pai; o efeito não pode depender dele.
  const aoAtualizar = React.useRef(opts.aoAtualizar)
  React.useEffect(() => {
    aoAtualizar.current = opts.aoAtualizar
  })

  React.useEffect(() => {
    if (!opts.habilitado) return
    let vivo = true
    const rodar = async () => {
      setSituacao('atualizando')
      let esperouOutra = false
      try {
        for (let i = 0; i < TENTATIVAS_REFRESH; i += 1) {
          const r = await atualizarCarteiraSeDefasada()
          if (!vivo) return
          if (r.estado === 'atualizada') {
            await aoAtualizar.current()
            break
          }
          if (r.estado === 'falha_recente') {
            setAviso(r.motivo ?? 'a última ingestão falhou')
            setSituacao('falhou')
            return
          }
          if (r.estado === 'em_andamento') {
            esperouOutra = true
            await esperar(ESPERA_REFRESH_MS)
            if (!vivo) return
            continue
          }
          // `fresca`: se antes havia outra ingestão rodando, ela terminou — traz os dados novos.
          if (esperouOutra) await aoAtualizar.current()
          break
        }
        if (vivo) setSituacao('ocioso')
      } catch (e) {
        if (!vivo) return
        setAviso(e instanceof Error ? e.message : 'falha ao atualizar')
        setSituacao('falhou')
      }
    }
    void rodar()
    return () => {
      vivo = false
    }
  }, [opts.habilitado])

  return { situacao, aviso }
}

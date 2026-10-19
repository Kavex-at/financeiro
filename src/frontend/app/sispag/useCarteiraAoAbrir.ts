'use client'

import * as React from 'react'
import {
  atualizarCarteiraSeDefasada,
  retomarAjustesCentavos,
  sincronizarLotesSeDefasado,
} from '@/lib/sispag'

/** Espera entre reconferências quando OUTRA execução está rodando (cron ou outra pessoa). */
export const ESPERA_REFRESH_MS = 8_000
/** Quantas vezes reconferir antes de desistir (≈ 48 s; a ingestão leva ~10 s, a sincronização ~25 s). */
export const TENTATIVAS_REFRESH = 6

export type SituacaoRefresh = 'ocioso' | 'atualizando' | 'falhou'

/** O que os endpoints de "atualizar se defasado" devolvem (ADR-0060, ADR-0066). */
interface RespostaRefresh {
  estado: 'fresca' | 'atualizada' | 'em_andamento' | 'falha_recente'
  motivo?: string
}

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Refresh ao abrir a tela (*stale-while-revalidate*): a tela já mostra o que está gravado; este
 * hook pede ao backend o refresh (o TTL é do servidor) e, quando um refresh termina, chama
 * `aoAtualizar` para recarregar — sem spinner de página inteira.
 *
 * Dispara UMA vez por abertura, quando `habilitado` vira `true`. `concluido` vira `true` quando
 * o passo termina, com sucesso ou não — é o que encadeia o próximo passo. Em StrictMode de
 * desenvolvimento o efeito roda duas vezes; o backend absorve (TTL e trava).
 */
export function useRefreshAoAbrir(opts: {
  habilitado: boolean
  pedir: () => Promise<RespostaRefresh>
  aoAtualizar: () => void | Promise<void>
}): { situacao: SituacaoRefresh; aviso: string | null; concluido: boolean } {
  const [situacao, setSituacao] = React.useState<SituacaoRefresh>('ocioso')
  const [aviso, setAviso] = React.useState<string | null>(null)
  const [concluido, setConcluido] = React.useState(false)
  // Os callbacks mudam a cada render do pai; o efeito não pode depender deles.
  const aoAtualizar = React.useRef(opts.aoAtualizar)
  const pedir = React.useRef(opts.pedir)
  React.useEffect(() => {
    aoAtualizar.current = opts.aoAtualizar
    pedir.current = opts.pedir
  })

  React.useEffect(() => {
    if (!opts.habilitado) return
    let vivo = true
    const rodar = async () => {
      setSituacao('atualizando')
      let esperouOutra = false
      try {
        for (let i = 0; i < TENTATIVAS_REFRESH; i += 1) {
          const r = await pedir.current()
          if (!vivo) return
          if (r.estado === 'atualizada') {
            await aoAtualizar.current()
            // Rodou, mas fechou em erro (ex.: nenhum título lido): os dados gravados ficam.
            if (r.motivo) {
              setAviso(r.motivo)
              setSituacao('falhou')
              return
            }
            break
          }
          if (r.estado === 'falha_recente') {
            setAviso(r.motivo ?? 'a última execução falhou')
            setSituacao('falhou')
            return
          }
          if (r.estado === 'em_andamento') {
            esperouOutra = true
            await esperar(ESPERA_REFRESH_MS)
            if (!vivo) return
            continue
          }
          // `fresca`: se antes havia outra execução rodando, ela terminou — traz os dados novos.
          if (esperouOutra) await aoAtualizar.current()
          break
        }
        if (vivo) setSituacao('ocioso')
      } catch (e) {
        if (!vivo) return
        setAviso(e instanceof Error ? e.message : 'falha ao atualizar')
        setSituacao('falhou')
      } finally {
        if (vivo) setConcluido(true)
      }
    }
    void rodar()
    return () => {
      vivo = false
    }
  }, [opts.habilitado])

  return { situacao, aviso, concluido }
}

/** Carteira SISPAG ao abrir a tela (ADR-0060). */
export function useCarteiraAoAbrir(opts: {
  habilitado: boolean
  aoAtualizar: () => void | Promise<void>
}) {
  return useRefreshAoAbrir({ ...opts, pedir: atualizarCarteiraSeDefasada })
}

/**
 * Lotes SISPAG ao abrir a tela (ADR-0066): a passada de L11 roda DEPOIS da carteira, nunca junto
 * (cap de sessões do robô no Conexos) — passe `habilitado` = carteira concluída.
 */
export function useLotesAoAbrir(opts: {
  habilitado: boolean
  aoAtualizar: () => void | Promise<void>
}) {
  return useRefreshAoAbrir({ ...opts, pedir: sincronizarLotesSeDefasado })
}

/**
 * Varredura de retomada do ajuste de centavos ao abrir a tela (ADR-0073, I18g(3)). Só para quem tem
 * `sispag:executar` (quem só vê não dispara nada; o servidor recusaria com 403). Uma vez por
 * abertura, sem esperar o ERP: o servidor agenda e responde 202. Falha não incomoda a tela.
 */
export function useAjustesCentavosAoAbrir(opts: { habilitado: boolean; podeExecutar: boolean }) {
  const disparado = React.useRef(false)
  React.useEffect(() => {
    if (!opts.habilitado || !opts.podeExecutar || disparado.current) return
    disparado.current = true
    retomarAjustesCentavos().catch(() => undefined)
  }, [opts.habilitado, opts.podeExecutar])
}

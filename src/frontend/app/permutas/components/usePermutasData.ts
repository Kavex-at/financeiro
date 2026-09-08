'use client'

import * as React from 'react'
import { fetchGestaoPermutas, fetchPermutaStatus } from '@/lib/api'
import { isSessionExpiredError } from '@/lib/http'
import type { GestaoPermutasResponse, PermutaBorderoVinculo } from '@/lib/types'

/** Mensagem para o operador (português — é quem lê o painel durante o incidente). */
const mensagemDeFalha = (err: unknown): string =>
  err instanceof Error && err.message ? err.message : 'Falha ao carregar a gestão de permutas.'

/**
 * Estado compartilhado da tela de permutas: o snapshot da gestão (`/gestao`) + o
 * status vivo PERMUTA→BORDERÔ por adiantamento (carga LAZY do nosso banco). `load`
 * rebusca ambos; é o gatilho usado por todos os fluxos de baixa/processamento.
 */
export function usePermutasData() {
  const [data, setData] = React.useState<GestaoPermutasResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  /**
   * Mensagem da última falha de carga, ou `null`. Existe porque
   * `fetchGestaoPermutas` passou a LANÇAR em vez de mascarar a falha com o
   * fixture: sem este estado a tela não teria como distinguir "o backend caiu"
   * de "a carteira está vazia". `SessionExpiredError` NÃO entra aqui — o
   * `SessionExpiredModal` é o dono daquela UX (`lib/http.ts`).
   */
  const [error, setError] = React.useState<string | null>(null)
  // Status PERMUTA→BORDERÔ por adiantamento (carga LAZY, status vivo do fin010). Mantém o painel
  // rápido (o /gestao não bate no ERP) e enriquece os badges depois. {} = sem vínculo (pendente).
  const [statusPorAdto, setStatusPorAdto] = React.useState<Record<string, PermutaBorderoVinculo>>(
    {},
  )

  const carregarStatus = React.useCallback(async () => {
    try {
      const r = await fetchPermutaStatus()
      setStatusPorAdto(r.porAdiantamento ?? {})
    } catch {
      // best-effort: badge cai pra "pendente" se o status não vier.
    }
  }, [])

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setData(await fetchGestaoPermutas())
      setError(null)
    } catch (err) {
      // Falha de REFRESH preserva o dado anterior de propósito
      // (`docs/design-system/patterns.md` §Error states): a analista continua
      // vendo a carteira que já estava na tela, com o banner dizendo que ela
      // pode estar desatualizada. Melhor que esvaziar o painel.
      if (!isSessionExpiredError(err)) setError(mensagemDeFalha(err))
    } finally {
      setLoading(false)
    }
    void carregarStatus()
  }, [carregarStatus])

  // Carga inicial: resolve a promise num callback (sem setState síncrono no
  // corpo do effect) e ignora o resultado se o componente desmontar.
  React.useEffect(() => {
    let active = true
    fetchGestaoPermutas()
      .then((d) => {
        if (!active) return
        setData(d)
        setError(null)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (!active) return
        if (!isSessionExpiredError(err)) setError(mensagemDeFalha(err))
        setLoading(false)
      })
    void carregarStatus()
    return () => {
      active = false
    }
  }, [carregarStatus])

  return { data, loading, error, statusPorAdto, carregarStatus, load }
}

'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { ExcecaoManualRecusadaError, desfazerExcecaoManual, marcarExcecaoManual } from '@/lib/api'
import { isSessionExpiredError } from '@/lib/http'
import type { PermutaPendente } from '@/lib/types'

/**
 * Exceção manual "permutado fora do painel" (ADR-0047): estado dos dois modais (marcar e desfazer)
 * e as ações. Marcar/desfazer reclassificam a linha do adto no banco na mesma transação, então o
 * `load` (passado de fora) já traz o adiantamento no card certo ("Bloqueadas" ↔ "Já permutado"),
 * sem nova ingestão. Recusa de regra (422/409/404) vira aviso; o resto, erro.
 */
export function useExcecaoManual(load: () => Promise<void>) {
  const [marcandoExcecao, setMarcandoExcecao] = React.useState<PermutaPendente | null>(null)
  const [salvandoExcecao, setSalvandoExcecao] = React.useState(false)
  const [desfazendoExcecao, setDesfazendoExcecao] = React.useState<PermutaPendente | null>(null)
  const [removendoExcecao, setRemovendoExcecao] = React.useState(false)

  const confirmarExcecao = React.useCallback(
    async (justificativa: string) => {
      if (!marcandoExcecao) return
      const docCod = marcandoExcecao.docCod
      setSalvandoExcecao(true)
      try {
        await marcarExcecaoManual(docCod, justificativa)
        toast.success(`Adiantamento ${docCod} marcado como permutado fora do painel.`)
        setMarcandoExcecao(null)
        await load()
      } catch (err) {
        if (isSessionExpiredError(err)) return
        if (err instanceof ExcecaoManualRecusadaError) {
          toast.warning(err.message)
        } else {
          toast.error(
            `Falha ao registrar a exceção${err instanceof Error ? ` — ${err.message}` : ''}.`,
          )
        }
      } finally {
        setSalvandoExcecao(false)
      }
    },
    [marcandoExcecao, load],
  )

  const confirmarDesfazerExcecao = React.useCallback(async () => {
    if (!desfazendoExcecao) return
    const docCod = desfazendoExcecao.docCod
    setRemovendoExcecao(true)
    try {
      await desfazerExcecaoManual(docCod)
      toast.success(`Exceção do adiantamento ${docCod} desfeita.`)
      setDesfazendoExcecao(null)
      await load()
    } catch (err) {
      if (isSessionExpiredError(err)) return
      if (err instanceof ExcecaoManualRecusadaError) {
        toast.warning(err.message)
      } else {
        toast.error(`Falha ao desfazer a exceção${err instanceof Error ? ` — ${err.message}` : ''}.`)
      }
    } finally {
      setRemovendoExcecao(false)
    }
  }, [desfazendoExcecao, load])

  return {
    marcandoExcecao,
    setMarcandoExcecao,
    salvandoExcecao,
    confirmarExcecao,
    desfazendoExcecao,
    setDesfazendoExcecao,
    removendoExcecao,
    confirmarDesfazerExcecao,
  }
}

'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { isSessionExpiredError } from '@/lib/http'
import {
  type CriarLotesPorFilialResult,
  criarLotesPorFilial,
  type TituloAPagar,
} from '@/lib/sispag'
import { resumirResultadoLotes } from './resultadoLotes'

/**
 * "Criar lotes" da aba de títulos com situação (decisão D8/D15): uma chamada a
 * `POST /sispag/lotes/por-filial`, um lote por filial, resultado por lote. Substitui o
 * `useCriarLoteManual` (título a título) quando o backend já manda `resumoSituacao`.
 */
export function useCriarLotesPorFilial({
  selecionados,
  aoConcluir,
}: {
  selecionados: TituloAPagar[]
  aoConcluir: () => Promise<void>
}) {
  const [criando, setCriando] = React.useState(false)
  const [resultado, setResultado] = React.useState<CriarLotesPorFilialResult | null>(null)

  const criar = React.useCallback(async () => {
    if (selecionados.length === 0 || criando) return
    setCriando(true)
    try {
      const r = await criarLotesPorFilial({
        titulos: selecionados.map((t) => ({ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod })),
      })
      await aoConcluir()
      const resumo = resumirResultadoLotes(r)
      if (resumo.tom === 'sucesso') {
        toast.success(resumo.titulo, {
          description: 'Os lotes foram criados localmente. Nada foi escrito no ERP ainda.',
        })
      } else {
        // Parcial ou recusado: o diálogo diz título a título o que não entrou e por quê.
        setResultado(r)
        const fn = resumo.tom === 'erro' ? toast.error : toast.warning
        fn(resumo.titulo, { description: 'Veja o resultado por filial.' })
      }
    } catch (e) {
      if (isSessionExpiredError(e)) return
      toast.error('Não foi possível criar os lotes', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setCriando(false)
    }
  }, [selecionados, criando, aoConcluir])

  return { criar, criando, resultado, fecharResultado: () => setResultado(null) }
}

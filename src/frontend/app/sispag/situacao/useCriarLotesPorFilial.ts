'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { isSessionExpiredError } from '@/lib/http'
import {
  type CriarLotesPorFilialResult,
  criarLotesPorFilial,
  type LotePagamento,
  type TituloAPagar,
} from '@/lib/sispag'
import { planoDeSaida, type SaidaDeLote } from '../components/moverParaLote'
import { resumirResultadoLotes } from './resultadoLotes'

/**
 * "Criar lotes" da aba de títulos com situação (decisão D8/D15): uma chamada a
 * `POST /sispag/lotes/por-filial`, um lote por filial, resultado por lote. Substitui o
 * `useCriarLoteManual` (título a título) quando o backend já manda `resumoSituacao`.
 */
export function useCriarLotesPorFilial({
  selecionados,
  lotes,
  aoConcluir,
}: {
  selecionados: TituloAPagar[]
  /** Lotes carregados na tela: servem para dizer, antes de mover, de quais lotes os títulos saem. */
  lotes: LotePagamento[]
  aoConcluir: () => Promise<void>
}) {
  const [criando, setCriando] = React.useState(false)
  const [resultado, setResultado] = React.useState<CriarLotesPorFilialResult | null>(null)
  /** Plano de saída dos lotes de origem, aguardando a confirmação da analista (ADR-0064). */
  const [confirmacao, setConfirmacao] = React.useState<SaidaDeLote[] | null>(null)

  const executar = React.useCallback(
    async (mover: boolean) => {
      if (selecionados.length === 0) return
      setCriando(true)
      try {
        const r = await criarLotesPorFilial({
          titulos: selecionados.map((t) => ({
            filCod: t.filCod,
            docCod: t.docCod,
            titCod: t.titCod,
          })),
          ...(mover ? { mover: true } : {}),
        })
        setConfirmacao(null)
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
    },
    [selecionados, aoConcluir],
  )

  /** Sem título em rascunho vai direto; com, pede a confirmação do que sai de cada lote. */
  const criar = React.useCallback(async () => {
    if (selecionados.length === 0 || criando) return
    const plano = planoDeSaida(selecionados, lotes)
    if (plano.length > 0) {
      setConfirmacao(plano)
      return
    }
    await executar(false)
  }, [selecionados, lotes, criando, executar])

  return {
    criar,
    criando,
    resultado,
    fecharResultado: () => setResultado(null),
    confirmacao,
    confirmarMover: () => executar(true),
    cancelarMover: () => setConfirmacao(null),
  }
}

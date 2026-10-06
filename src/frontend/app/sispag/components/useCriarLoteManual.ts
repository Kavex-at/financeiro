'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { isSessionExpiredError } from '@/lib/http'
import { cancelarLote, criarLote, incluirTitulo, type LotePagamento, type TituloAPagar } from '@/lib/sispag'
import { planoDeSaida, type SaidaDeLote } from './moverParaLote'

const chave = (t: TituloAPagar) => `${t.filCod}:${t.docCod}:${t.titCod}`

/**
 * "Criar lote" da aba de títulos (ADR-0064). Se nenhum selecionado está em lote, cria direto. Se
 * algum está num lote em rascunho, abre a confirmação (`plano`) e, ao confirmar, os títulos que a
 * analista viu na lista entram com `mover: true`: saem da origem e entram no lote novo na mesma
 * transação. Título que entrou num lote DEPOIS da confirmação não é movido (o servidor recusa).
 */
export function useCriarLoteManual({
  selecionados,
  lotes,
  aoConcluir,
}: {
  selecionados: TituloAPagar[]
  lotes: LotePagamento[]
  aoConcluir: () => Promise<void>
}) {
  const [confirmacao, setConfirmacao] = React.useState<{
    plano: SaidaDeLote[]
    titulos: TituloAPagar[]
  } | null>(null)
  const [criando, setCriando] = React.useState(false)

  const executar = React.useCallback(
    async (titulos: TituloAPagar[], mover: ReadonlySet<string>) => {
      setCriando(true)
      try {
        const lote = await criarLote({ filCod: titulos[0].filCod })
        let ok = 0
        let movidos = 0
        const falhas: string[] = []
        for (const t of titulos) {
          const moverEste = mover.has(chave(t))
          try {
            await incluirTitulo(lote.id, {
              filCod: t.filCod,
              docCod: t.docCod,
              titCod: t.titCod,
              ...(moverEste ? { mover: true } : {}),
            })
            ok += 1
            if (moverEste) movidos += 1
          } catch (e) {
            if (isSessionExpiredError(e)) throw e
            falhas.push(`${t.docCod}/${t.titCod}: ${e instanceof Error ? e.message : 'erro'}`)
          }
        }
        // Nenhum título entrou: não deixa um lote manual vazio para trás (o lote nasceu na versão 1
        // e nenhuma inclusão o tocou). Falhar ao cancelar não muda o aviso abaixo.
        if (ok === 0) {
          await cancelarLote(lote.id, lote.versao).catch(() => undefined)
        }
        setConfirmacao(null)
        await aoConcluir()
        const descricaoMovidos = movidos > 0 ? `${movidos} movido(s) de outro lote. ` : ''
        if (ok === 0) {
          toast.error('Nenhum título entrou no lote; o lote foi descartado', {
            description: falhas.slice(0, 3).join(' · '),
          })
        } else if (falhas.length === 0) {
          toast.success(`Lote criado com ${ok} título(s)`, {
            description: `${descricaoMovidos}Lote criado localmente — nada foi escrito no ERP ainda.`,
          })
        } else {
          toast.warning(`Lote criado com ${ok} título(s); ${falhas.length} não entraram`, {
            description: falhas.slice(0, 3).join(' · '),
          })
        }
      } catch (e) {
        if (isSessionExpiredError(e)) return
        toast.error('Não foi possível criar o lote', {
          description: e instanceof Error ? e.message : undefined,
        })
      } finally {
        setCriando(false)
      }
    },
    [aoConcluir],
  )

  const iniciar = React.useCallback(() => {
    if (selecionados.length === 0) return
    if (new Set(selecionados.map((t) => t.filCod)).size > 1) {
      toast.error('Selecione títulos de uma única filial', {
        description: 'Um lote é de uma filial só. Filtre por filial e monte um lote por vez.',
      })
      return
    }
    const plano = planoDeSaida(selecionados, lotes)
    if (plano.length === 0) {
      void executar(selecionados, new Set())
      return
    }
    setConfirmacao({ plano, titulos: selecionados })
  }, [selecionados, lotes, executar])

  const confirmar = React.useCallback(() => {
    if (!confirmacao) return
    const mover = new Set(confirmacao.plano.flatMap((s) => s.titulos.map(chave)))
    void executar(confirmacao.titulos, mover)
  }, [confirmacao, executar])

  const cancelar = React.useCallback(() => setConfirmacao(null), [])

  return {
    iniciar,
    confirmar,
    cancelar,
    criando,
    plano: confirmacao?.plano ?? null,
    totalConfirmacao: confirmacao?.titulos.length ?? 0,
  }
}

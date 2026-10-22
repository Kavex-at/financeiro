'use client'

import { Badge } from '@/components/ui/badge'
import { EFEITO_PENDENCIA, ESTADO_PRONTIDAO, type ProntidaoLote } from '@/lib/sispag'

/**
 * Resumo da prontidão no cabeçalho do card (ADR-0076): diz o que falta SEM abrir o lote. "Não
 * finaliza" quando há o que barre; "N saem do lote" para os TED/PIX que a finalização retiraria.
 * A barra mostra a proporção de itens prontos, que saem e que barram.
 */
export function SeloProntidao({
  prontidao,
  itens,
}: {
  prontidao?: ProntidaoLote
  itens: number
}) {
  if (!prontidao) return null
  if (prontidao.estado === ESTADO_PRONTIDAO.PRONTO) {
    return (
      <Badge variant="outline" className="border-success/40 text-success-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-success" />
        Pronto para finalizar
      </Badge>
    )
  }
  const naoFinaliza = prontidao.pendencias.some((p) => p.efeito === EFEITO_PENDENCIA.BARRA)
  const ok = Math.max(itens - prontidao.barram - prontidao.saem, 0)
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {naoFinaliza ? (
        <Badge variant="outline" className="border-danger/40 text-danger-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-danger" />
          Não finaliza
        </Badge>
      ) : null}
      {prontidao.saem > 0 ? (
        <Badge variant="outline" className="border-warning/40 text-warning-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-warning" />
          {prontidao.saem === 1 ? '1 sai do lote' : `${prontidao.saem} saem do lote`}
        </Badge>
      ) : null}
      {itens > 0 ? (
        <span
          role="img"
          aria-label={`${ok} de ${itens} itens prontos, ${prontidao.saem} saem, ${prontidao.barram} barram`}
          className="flex h-1.5 w-16 overflow-hidden rounded-full bg-muted"
        >
          <span className="bg-success" style={{ width: `${(ok / itens) * 100}%` }} />
          <span className="bg-warning" style={{ width: `${(prontidao.saem / itens) * 100}%` }} />
          <span className="bg-danger" style={{ width: `${(prontidao.barram / itens) * 100}%` }} />
        </span>
      ) : null}
    </span>
  )
}

'use client'

import { AlertTriangle, CheckCircle2, Loader2, MinusCircle } from 'lucide-react'
import type { SeloAjusteCentavos } from './sugestaoBoleto'

const ESTILO: Record<SeloAjusteCentavos['tipo'], string> = {
  simulacao: 'border-border bg-muted text-muted-foreground',
  em_curso: 'border-info/40 bg-info-subtle text-info-foreground',
  concluido: 'border-success/40 bg-success-subtle text-success-foreground',
  aviso: 'border-warning/40 bg-warning-subtle text-warning-foreground',
}

const ICONE = {
  simulacao: MinusCircle,
  em_curso: Loader2,
  concluido: CheckCircle2,
  aviso: AlertTriangle,
} as const

/** Selo do ajuste de centavos do título (ADR-0074). Só texto já mascarado. */
export function AjusteCentavosSelo({ selo }: { selo: SeloAjusteCentavos | null }) {
  if (!selo) return null
  const Icone = ICONE[selo.tipo]
  return (
    <p
      role="status"
      data-testid={`selo-ajuste-${selo.tipo}`}
      className={`mt-1 flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs ${ESTILO[selo.tipo]}`}
    >
      <Icone
        className={`mt-0.5 size-3.5 shrink-0 ${selo.tipo === 'em_curso' ? 'motion-safe:animate-spin' : ''}`}
        aria-hidden
      />
      <span>{selo.texto}</span>
    </p>
  )
}

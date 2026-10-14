'use client'

import { AlertTriangle, CheckCircle2, Link2 } from 'lucide-react'
import type { SeloVinculo } from './vinculoCodigoBarras'

const ESTILO: Record<SeloVinculo['tipo'], string> = {
  vinculado: 'border-success/40 bg-success-subtle text-success-foreground',
  previsto: 'border-info/40 bg-info-subtle text-info-foreground',
  inelegivel: 'border-warning/40 bg-warning-subtle text-warning-foreground',
  retirado: 'border-danger/40 bg-danger-subtle text-danger-foreground',
}

/** Selo do vínculo do código de barras (ADR-0071). Só texto já mascarado. */
export function VinculoCodigoBarrasSelo({ selo }: { selo: SeloVinculo | null }) {
  if (!selo) return null
  const Icone =
    selo.tipo === 'vinculado' ? CheckCircle2 : selo.tipo === 'previsto' ? Link2 : AlertTriangle
  return (
    <p
      role="status"
      data-testid={`selo-vinculo-${selo.tipo}`}
      className={`mt-1 flex items-start gap-1.5 rounded-md border px-2 py-1 text-xs ${ESTILO[selo.tipo]}`}
    >
      <Icone className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{selo.texto}</span>
    </p>
  )
}

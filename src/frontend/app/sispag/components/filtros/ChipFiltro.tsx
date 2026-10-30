'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

const CHIP =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]'
const chipMarcado = (marcado: boolean): string =>
  marcado ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-accent'

/**
 * Chip de filtro com `aria-pressed` (os "Por motivo" de Títulos a pagar e os da aba Boletos DDA).
 * Marcado = preenchido com a cor do texto; desmarcado = borda.
 */
export function ChipFiltro({
  marcado,
  onClick,
  title,
  children,
}: {
  marcado: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={marcado}
      onClick={onClick}
      title={title}
      className={cn(CHIP, chipMarcado(marcado))}
    >
      {children}
    </button>
  )
}

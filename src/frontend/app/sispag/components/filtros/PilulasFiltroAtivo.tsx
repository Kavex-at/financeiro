'use client'

export interface PilulaFiltro {
  id: string
  texto: string
}

/** Etiquetas removíveis dos filtros de coluna ativos (Títulos a pagar e Boletos DDA). */
export function PilulasFiltroAtivo({
  etiquetas,
  onRemover,
}: {
  etiquetas: ReadonlyArray<PilulaFiltro>
  onRemover: (id: string) => void
}) {
  if (etiquetas.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Filtros ativos">
      {etiquetas.map((e) => (
        <button
          key={e.id}
          type="button"
          aria-label={`Remover filtro: ${e.texto}`}
          onClick={() => onRemover(e.id)}
          className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-2.5 py-1 text-xs text-info-foreground outline-none hover:opacity-80 focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          {e.texto} <span aria-hidden>×</span>
        </button>
      ))}
    </div>
  )
}

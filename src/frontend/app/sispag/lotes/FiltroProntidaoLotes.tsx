'use client'

import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  type FiltroProntidao,
  type OrdemLotes,
  ROTULO_FILTRO_PRONTIDAO,
  ROTULO_ORDEM_LOTES,
} from './prontidaoLotes'

const PONTO: Readonly<Record<FiltroProntidao, string>> = {
  todos: '',
  prontos: 'bg-success',
  'com-pendencia': 'bg-danger',
}

/**
 * Topo da aba de lotes em rascunho (ADR-0076): "Todos / Prontos para finalizar / Com pendência"
 * com contagem, e "Ordenar por" (pendências primeiro por padrão). Mesmo desenho do filtro de
 * situação da tela de títulos.
 */
export function FiltroProntidaoLotes({
  filtro,
  contagens,
  onFiltro,
  ordem,
  onOrdem,
}: {
  filtro: FiltroProntidao
  contagens: Record<FiltroProntidao, number>
  onFiltro: (f: FiltroProntidao) => void
  ordem: OrdemLotes
  onOrdem: (o: OrdemLotes) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div
        role="group"
        aria-label="Situação do lote"
        className="inline-flex overflow-hidden rounded-lg border bg-card"
      >
        {(Object.keys(ROTULO_FILTRO_PRONTIDAO) as FiltroProntidao[]).map((f, i) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => onFiltro(f)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]',
              i > 0 && 'border-l',
              filtro === f ? 'bg-primary/10 font-medium' : 'hover:bg-accent',
            )}
          >
            {PONTO[f] ? <span aria-hidden className={cn('size-2 rounded-full', PONTO[f])} /> : null}
            {ROTULO_FILTRO_PRONTIDAO[f]}
            <span className="tabular-nums text-muted-foreground">{contagens[f]}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="ordem-lotes" className="text-xs text-muted-foreground">
          Ordenar por
        </Label>
        <Select value={ordem} onValueChange={(v) => onOrdem(v as OrdemLotes)}>
          <SelectTrigger id="ordem-lotes" className="h-8 w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULO_ORDEM_LOTES) as OrdemLotes[]).map((o) => (
              <SelectItem key={o} value={o}>
                {ROTULO_ORDEM_LOTES[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

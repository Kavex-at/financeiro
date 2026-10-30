'use client'

import { cn, formatBRL } from '@/lib/utils'

export interface Segmento<V extends string> {
  valor: V
  rotulo: string
  /** Classe do ponto de cor (`bg-success`…); vazio = sem ponto. */
  ponto?: string
  qtd?: number
  /** `undefined` = ainda não carregou (mostra "—"). */
  valorReais?: number
}

/**
 * Controle segmentado com quantidade e valor em cada segmento (o "Todos | Prontos | Bloqueados" de
 * Títulos a pagar e o de Boletos DDA). Um só ativo; cada segmento é um botão com `aria-pressed`.
 */
export function SegmentosComTotal<V extends string>({
  rotulo,
  segmentos,
  ativo,
  onSelecionar,
}: {
  /** Nome do grupo para leitor de tela. */
  rotulo: string
  segmentos: ReadonlyArray<Segmento<V>>
  ativo: V
  onSelecionar: (v: V) => void
}) {
  return (
    <div role="group" aria-label={rotulo} className="inline-flex overflow-hidden rounded-lg border bg-card">
      {segmentos.map((o, i) => (
        <button
          key={o.valor}
          type="button"
          aria-pressed={ativo === o.valor}
          onClick={() => onSelecionar(o.valor)}
          className={cn(
            'flex min-w-32 flex-col items-start px-4 py-2 text-left outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            i > 0 && 'border-l',
            ativo === o.valor ? 'bg-primary/10' : 'hover:bg-accent',
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {o.ponto ? <span className={cn('size-2 rounded-full', o.ponto)} aria-hidden /> : null}
            {o.rotulo}
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums">
              {o.qtd === undefined ? '—' : o.qtd.toLocaleString('pt-BR')}
            </span>
          </span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {o.valorReais === undefined ? '—' : formatBRL(o.valorReais)}
          </span>
        </button>
      ))}
    </div>
  )
}

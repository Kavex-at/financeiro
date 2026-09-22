'use client'

import { PauseCircle } from 'lucide-react'
import type { RetencaoFormacao } from '@/lib/sispag'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { detalheRetencao } from './retencao'

/**
 * Badge "Não lotar automaticamente" (ADR-0050): o título está retido da formação automática.
 * Autor, data e motivo ficam no tooltip; o badge recebe foco para o tooltip abrir pelo teclado.
 */
export function RetencaoBadge({ retencao }: { retencao: RetencaoFormacao }) {
  const linhas = detalheRetencao(retencao)
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            className="border-warning/40 text-warning"
            aria-label={`Não lotar automaticamente. ${linhas.join('. ')}`}
          >
            <PauseCircle className="mr-1 size-3" aria-hidden />
            Não lotar automaticamente
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {linhas.map((linha) => (
            <p key={linha} className="whitespace-pre-wrap text-xs">
              {linha}
            </p>
          ))}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

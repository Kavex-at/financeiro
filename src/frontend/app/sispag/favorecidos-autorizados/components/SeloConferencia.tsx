'use client'

import { Badge } from '@/components/ui/badge'
import type { FavorecidoAutorizado } from '@/lib/sispag'
import { textoSelo } from './formatar'

const CLASSE: Record<string, string> = {
  IGUAL: 'border-success/40 text-success',
  DIFERENTE: 'border-warning/40 text-warning',
  SEM_DADO: 'border-warning/40 text-warning',
  FALHA_LEITURA: 'text-muted-foreground',
}

/** Selo "igual ao Conexos / diferente do aprovado" de uma autorização (I14l). Só texto. */
export function SeloConferencia({ autorizacao }: { autorizacao: FavorecidoAutorizado }) {
  const r = autorizacao.ultimaConferenciaResultado
  return (
    <Badge
      variant="outline"
      className={`max-w-72 whitespace-normal text-left ${r ? CLASSE[r] : 'text-muted-foreground'}`}
    >
      {textoSelo(autorizacao)}
    </Badge>
  )
}

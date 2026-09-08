'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GestaoPermutasResponse } from '@/lib/types'

/**
 * Banners de FONTE e de FALHA da Gestão de Permutas.
 *
 * Os dois existem pela mesma razão: a tela precisa dizer de onde veio o que
 * está nela. Antes, `fetchGestaoPermutas` devolvia o fixture de demonstração
 * tanto em falha quanto em carteira vazia, e nada na tela avisava — a analista
 * decidia baixa de adiantamento olhando para dados que não eram do banco.
 *
 * Padrão de estados: `docs/design-system/patterns.md` §Error states — banner
 * em cima, dados prévios preservados, retry explícito.
 */

/**
 * Aviso PERSISTENTE de que a tela está servindo o fixture de demonstração e
 * não o banco (`NEXT_PUBLIC_DEMO_MODE`). Deliberadamente um banner destrutivo,
 * e não um toast: toast é dispensável e some sozinho, e o risco aqui dura
 * enquanto a tela estiver aberta.
 */
export function DemoDataBanner({ fonte }: { fonte: GestaoPermutasResponse['fonte'] }) {
  if (fonte !== 'fixture') return null

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <strong>Dados de demonstração.</strong> Esta tela está exibindo um fixture, não a carteira
        do banco — o modo demonstração (<code>NEXT_PUBLIC_DEMO_MODE</code>) está ligado. Nenhum
        número aqui serve para decidir baixa.
      </p>
    </div>
  )
}

/**
 * Banner de falha de carga, com retry. `null` quando não há erro. Aparece
 * ACIMA dos dados: numa falha de refresh a carteira anterior continua visível
 * (ela é o que havia de verdade no banco), e o banner diz que pode estar
 * desatualizada.
 */
export function LoadErrorBanner({
  message,
  onRetry,
  retrying,
  stale,
}: {
  message?: string | null
  onRetry: () => void
  retrying?: boolean
  /** Há dados antigos na tela — muda o texto de "não carregou" para "pode estar desatualizada". */
  stale?: boolean
}) {
  if (!message) return null

  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-2 rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        {stale
          ? 'Não foi possível atualizar a gestão de permutas — os números abaixo são da última carga bem-sucedida e podem estar desatualizados.'
          : 'Não foi possível carregar a gestão de permutas.'}{' '}
        <span className="opacity-80">({message})</span>
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        <RefreshCw className={retrying ? 'animate-spin' : undefined} aria-hidden /> Tentar novamente
      </Button>
    </div>
  )
}

'use client'

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * Boundary de erro do App Router: qualquer throw no render de uma página autenticada para aqui,
 * em vez de derrubar a árvore e deixar a tela em branco.
 *
 * Como este arquivo está em `app/`, o **layout raiz sobrevive**: header, sidebar e BottomNav
 * continuam montados e o usuário sai daqui navegando, sem precisar do botão voltar. É esse o
 * ponto — antes da moldura não havia para onde ir a partir de uma tela quebrada.
 *
 * O que este boundary NÃO cobre: um throw dentro do próprio layout raiz (a moldura). Esses ficam
 * com o `ErrorBoundary` em volta da navegação (`components/AppShell.tsx`) e, em último caso, com
 * `app/global-error.tsx`.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app/error] falha de render na rota:', error)
  }, [error])

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-lg flex-col items-center gap-4 rounded-lg border border-dashed bg-card p-10 text-center"
    >
      <AlertTriangle aria-hidden className="size-8 text-danger" />

      <div className="space-y-1">
        <h2 className="text-base font-semibold">Esta tela falhou ao carregar</h2>
        <p className="text-sm text-muted-foreground">
          O erro ficou contido nesta página — o restante do sistema segue funcionando. Tentar de
          novo costuma resolver quando a causa foi uma resposta incompleta do ERP.
        </p>
      </div>

      {/*
        O `digest` é o identificador que o Next também grava no log do servidor. É o único fio que
        liga "deu erro na tela da analista" ao stack real, já que a mensagem original é ocultada em
        produção. Sem ele, o suporte pede print de uma tela que não diz nada.
      */}
      {error.digest ? (
        <p className="font-mono text-xs text-muted-foreground">
          Código para o suporte: {error.digest}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw aria-hidden />
          Tentar de novo
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">Voltar ao início</Link>
        </Button>
      </div>
    </div>
  )
}

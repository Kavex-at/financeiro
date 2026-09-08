'use client'

import * as React from 'react'

/**
 * Fronteira de erro do React — o único mecanismo que contém um throw de render dentro de uma
 * subárvore em vez de deixá-lo desmontar a árvore inteira.
 *
 * É classe porque `getDerivedStateFromError`/`componentDidCatch` não têm equivalente em componente
 * de função: este é o lugar do frontend onde a classe é obrigatória, não uma escolha de estilo.
 *
 * **Para conteúdo de rota, não use isto** — o App Router já oferece `app/error.tsx`, que é o
 * boundary por segmento e vem com `reset()`. Este componente é para pedaços da **moldura**, que
 * vivem no layout raiz e portanto ficam fora do alcance do `error.tsx`.
 */

interface ErrorBoundaryProps {
  /** Nome do trecho protegido. Vai para o log — "algo quebrou" não ajuda ninguém às 2h. */
  boundaryName: string
  /** O que renderizar no lugar da subárvore quebrada. Omitido = a subárvore simplesmente some. */
  fallback?: React.ReactNode
  children: React.ReactNode
}

interface ErrorBoundaryState {
  failed: boolean
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { failed: false }

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  public componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // `console.error` é o destino honesto hoje: o projeto não tem coletor de erro de browser
    // (ver `moldura-navegacao-regis-followups.md`). Melhor um rastro no console do dev do que
    // um catch mudo, que é como um defeito de moldura sobrevive a semanas de uso.
    console.error(
      `[ErrorBoundary:${this.props.boundaryName}] subárvore isolada após falha de render:`,
      error,
      info.componentStack,
    )
  }

  public render(): React.ReactNode {
    if (this.state.failed) return this.props.fallback ?? null
    return this.props.children
  }
}

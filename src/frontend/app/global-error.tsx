'use client'

import { useEffect } from 'react'

/**
 * Último recurso: o boundary que o Next usa quando o próprio **layout raiz** falha.
 *
 * `app/error.tsx` vive dentro do layout e por isso não alcança um throw do layout — é exatamente o
 * caso que a moldura criou. Antes deste ciclo o `AppShell` tinha 47 linhas e nenhuma lógica; agora
 * é código com estado, `localStorage` e fetch, montado em toda rota autenticada. Sem este arquivo,
 * um defeito ali é tela branca em 100% do sistema, sem sequer um botão.
 *
 * Substitui o layout inteiro, então precisa emitir o próprio `<html>`/`<body>` — e não pode contar
 * com o `globals.css`, que é importado pelo layout que acabou de ser descartado. Daí o estilo
 * inline: um arquivo que só roda quando tudo o mais falhou não pode depender de mais nada.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app/global-error] falha de render no layout raiz:', error)
  }, [error])

  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#fafafa',
          color: '#171717',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <main
          role="alert"
          style={{
            maxWidth: '32rem',
            textAlign: 'center',
            border: '1px solid #e5e5e5',
            borderRadius: '0.5rem',
            background: '#fff',
            padding: '2.5rem',
          }}
        >
          <h1 style={{ fontSize: '1.125rem', margin: '0 0 0.5rem' }}>
            A aplicação não conseguiu carregar
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#525252', margin: '0 0 1.5rem' }}>
            A falha foi na moldura da aplicação, não numa tela específica. Recarregar resolve na
            maioria dos casos; se persistir, avise o time da Kavex com o código abaixo.
          </p>

          {error.digest ? (
            <p
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.75rem',
                color: '#525252',
                margin: '0 0 1.5rem',
              }}
            >
              Código para o suporte: {error.digest}
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              border: 'none',
              borderRadius: '0.375rem',
              background: '#171717',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 500,
              padding: '0.5rem 1rem',
            }}
          >
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  )
}

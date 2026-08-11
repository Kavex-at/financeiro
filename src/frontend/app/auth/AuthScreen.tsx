'use client'

import pkg from '../../package.json'

/**
 * Esqueleto compartilhado das telas de autenticação.
 *
 * Replica o layout de `app/login/page.tsx` — container gradiente, blobs, bloco de marca,
 * card `max-w-md`, rodapé com a versão — para que a recuperação de senha **não pareça outra
 * aplicação** no meio do fluxo mais sensível do produto.
 *
 * Deliberadamente **sem `AppShell`** (`docs/design-system/layout.md`): telas de auth são
 * página inteira, sem o chrome da app autenticada. Renderizar a navegação aqui ofereceria ao
 * visitante sem sessão exatamente os links que ele não pode seguir.
 *
 * Só tokens semânticos (`primary`, `card`, `muted-foreground`, `background`) — zero cor ou
 * espaçamento literal.
 */
export function AuthScreen({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-primary/10 via-background to-primary/5 p-4">
      {/* Blobs decorativos suaves no fundo. */}
      <div className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 size-72 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Marca */}
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="h-7 w-2 rounded-sm bg-primary" />
          <div className="leading-tight">
            <div className="text-xl font-bold tracking-tight">Columbia Trading</div>
            <div className="text-sm text-muted-foreground">Financeiro</div>
          </div>
        </div>

        <div className="rounded-2xl border bg-card p-8 shadow-xl">
          <div className="mb-6 space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>

        {footer ? <div className="mt-4 text-center text-sm">{footer}</div> : null}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Columbia Trading · Financeiro · v{pkg.version}
        </p>
      </div>
    </div>
  )
}

/**
 * Erro inline — mesmo padrão verbatim de `app/login/page.tsx`: `role="alert"` e os tokens
 * `danger`. Um erro que aparece diferente em cada tela treina o usuário a não confiar nele.
 */
export function AuthInlineError({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <div
      className="rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger-foreground"
      data-testid={testId}
      role="alert"
    >
      {children}
    </div>
  )
}

/** Aviso/confirmação inline com os tokens `success`. Mesmo esqueleto do erro. */
export function AuthInlineNotice({
  children,
  testId,
}: {
  children: React.ReactNode
  testId: string
}) {
  return (
    <div
      className="rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-sm text-success-foreground"
      data-testid={testId}
      role="status"
    >
      {children}
    </div>
  )
}

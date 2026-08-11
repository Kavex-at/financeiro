'use client'

import { usePathname } from 'next/navigation'
import { ConexosStatusBanner } from '@/components/auth/ConexosStatusBanner'
import { RouteGate } from '@/components/auth/RouteGate'
import { UserMenu } from '@/components/auth/UserMenu'
import { isAuthScreen } from '@/lib/supabase/routes'

/**
 * App chrome. Nas rotas de AUTENTICAÇÃO (`/login` e `/auth/*`) o header é escondido, para
 * que a entrada e a recuperação de senha sejam telas limpas de página inteira — e, mais
 * importante, para que elas NÃO apareçam com a navegação da app autenticada em volta,
 * oferecendo links que o visitante sem sessão não pode seguir.
 *
 * `/docs` é público mas NÃO é tela de auth: continua com o header normal.
 *
 * O gate de auth permanece no `RouteGate`.
 */
export function AppShell({ version, children }: { version: string; children: React.ReactNode }) {
  const pathname = usePathname()

  if (isAuthScreen(pathname)) {
    return <RouteGate>{children}</RouteGate>
  }

  return (
    <>
      {/* `bg-card` em vez do antigo `bg-white`: token semântico com o MESMO valor
          (`--card: oklch(1 0 0)`), então zero mudança visual — mas o header passa a
          acompanhar o tema em vez de ficar preso ao branco literal. Migração proporcional
          de dívida do template (CLAUDE.md § política de features). */}
      <header className="sticky top-0 z-50 bg-card border-b shadow-sm">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          <div className="w-2 h-6 rounded-sm bg-primary" />
          <h1 className="text-lg font-bold text-foreground">Columbia Trading</h1>
          <span className="text-sm text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">Financeiro</span>
          <div className="ml-auto flex items-center gap-3">
            <span
              className="text-xs font-mono text-muted-foreground border rounded-md px-2 py-0.5"
              data-testid="app-version"
              title={`Versao da aplicacao: ${version}`}
            >
              v{version}
            </span>
            <UserMenu />
          </div>
        </div>
      </header>
      <ConexosStatusBanner />
      {/* Full-bleed main com padding responsivo — escala com a viewport. */}
      <main className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <RouteGate>{children}</RouteGate>
      </main>
    </>
  )
}

'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useAppNavGroups } from '@/components/nav/app-nav'
import { ConexosStatusBanner } from '@/components/auth/ConexosStatusBanner'
import { RouteGate } from '@/components/auth/RouteGate'
import { UserMenu } from '@/components/auth/UserMenu'
import { BottomNav } from '@/components/ui/bottom-nav'
import { Sidebar } from '@/components/ui/sidebar'
import { useIsAuthenticated } from '@/lib/auth/AuthProvider'
import { cn } from '@/lib/utils'

/**
 * `AppShell` — a moldura persistente da aplicação (`docs/design-system/layout.md` §AppShell).
 *
 * Forma compound: `AppShell.Header`, `.Logo`, `.EnvBadge`, `.HeaderActions`, `.Sidebar`, `.Main`.
 * A composição pré-configurada no fim do arquivo é montada com esses mesmos subcomponentes — eles
 * não existem "para o caso de alguém precisar", são o que constrói a tela.
 *
 * Três coisas que esta moldura resolve e que antes não existiam em lugar nenhum do `src/frontend/`:
 * navegação global (era zero `<nav>`, zero `aria-current`), saída de qualquer tela autenticada
 * (`/sispag`, `/recebimentos`, `/operacao` e `/usuarios` não tinham nenhum link — a única saída era
 * o botão voltar do navegador) e um `<h1>` por página (o header emitia um segundo `<h1>` fixo, de
 * modo que toda tela do sistema se chamava "Columbia Trading" para um leitor de tela).
 */

/** Altura do header. Usada aqui e no `top`/`height` do slot da sidebar — mudam juntas. */
const HEADER_HEIGHT = 'h-14'
const HEADER_OFFSET = 'top-14'

/* -------------------------------------------------------------------------------------------- */
/* Subcomponentes                                                                                 */
/* -------------------------------------------------------------------------------------------- */

/**
 * Primeiro elemento focável da página. Invisível até receber foco pelo Tab — é o atalho de quem
 * navega por teclado para pular a moldura inteira e cair no conteúdo.
 *
 * `--z-max` é o único uso justificado da faixa excepcional da escala (`tokens.md`: "uso emergencial;
 * exige justificativa no PR"): este link precisa ficar acima de TUDO, inclusive do header sticky e
 * de um backdrop de modal. Um skip link ocultado por sobreposição não é um skip link.
 */
export function AppShellSkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[var(--z-max)] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      Pular para o conteúdo
    </a>
  )
}

export function AppShellHeader({
  variant = 'default',
  className,
  children,
}: {
  variant?: 'default' | 'transparent'
  className?: string
  children: React.ReactNode
}) {
  return (
    <header
      role="banner"
      data-slot="app-shell-header"
      className={cn(
        'sticky top-0 z-50',
        variant === 'default' && 'border-b border-border bg-card shadow-sm',
        className,
      )}
    >
      <div className={cn('flex w-full items-center gap-3 px-4 sm:px-6 lg:px-8', HEADER_HEIGHT)}>
        {children}
      </div>
    </header>
  )
}

/**
 * A marca é um **link para `/`**. É a primeira coisa que todo usuário tenta ao querer voltar ao
 * começo, e antes não fazia nada. Não emite `<h1>`: o único `<h1>` da página é o do `PageHeader`.
 */
export function AppShellLogo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="Columbia Trading Financeiro — ir para a página inicial"
      data-slot="app-shell-logo"
      className={cn(
        'group flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <span
        aria-hidden
        className="h-6 w-2 shrink-0 rounded-sm bg-primary transition-opacity group-hover:opacity-80"
      />
      <span className="text-lg font-bold leading-none text-foreground">Columbia Trading</span>
      <span aria-hidden className="text-sm text-muted-foreground">
        /
      </span>
      <span className="hidden text-sm text-muted-foreground sm:inline">Financeiro</span>
    </Link>
  )
}

/**
 * Selo do ambiente. Não renderiza em produção (spec §Estados: "Env badge visível em UAT/DEV;
 * ausente em PRD") — em produção seria ruído permanente; fora dela, é o que impede executar uma
 * baixa achando que se está no outro ambiente.
 */
export function AppShellEnvBadge() {
  const env = process.env.NEXT_PUBLIC_ENV
  if (!env || env === 'production' || env === 'prd') return null

  return (
    <span
      data-testid="app-env-badge"
      className="rounded-md border border-warning bg-warning-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-foreground"
    >
      {env}
    </span>
  )
}

export function AppShellHeaderActions({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="app-shell-header-actions"
      className={cn('ml-auto flex items-center gap-3', className)}
    >
      {children}
    </div>
  )
}

/**
 * Slot de posicionamento da sidebar — o `role="navigation"` mora no `<Sidebar>`, não aqui.
 * `self-start` é o que faz o `sticky` funcionar: sem ele o item de flex estica até a altura da
 * linha e não sobra distância para grudar.
 */
export function AppShellSidebar({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="app-shell-sidebar"
      className={cn(
        'sticky hidden h-[calc(100dvh-3.5rem)] shrink-0 self-start md:block',
        HEADER_OFFSET,
        className,
      )}
    >
      {children}
    </div>
  )
}

const MAIN_PADDING = {
  none: '',
  sm: 'px-3 py-4',
  md: 'px-4 py-6 sm:px-6 lg:px-8',
  lg: 'px-6 py-8 sm:px-8 lg:px-12',
} as const

const MAIN_MAX_WIDTH = {
  none: '',
  sm: 'mx-auto max-w-3xl',
  md: 'mx-auto max-w-5xl',
  lg: 'mx-auto max-w-6xl',
  xl: 'mx-auto max-w-[1440px]',
  full: 'max-w-full',
} as const

/**
 * Área principal. `role="main"` + `id="main-content"` para sustentar o skip link.
 *
 * `maxWidth` default `'none'`, e não `'xl'` como na spec: este app é deliberadamente full-bleed
 * porque as telas são tabelas densas de operação (SISPAG, Recebimentos, Permutas), e estreitar o
 * conteúdo regrediria todas elas. A prop existe e aceita os valores da spec.
 */
export function AppShellMain({
  padding = 'md',
  maxWidth = 'none',
  className,
  children,
}: {
  padding?: keyof typeof MAIN_PADDING
  maxWidth?: keyof typeof MAIN_MAX_WIDTH
  className?: string
  children: React.ReactNode
}) {
  return (
    <main
      role="main"
      id="main-content"
      data-slot="app-shell-main"
      className={cn('min-w-0 flex-1', MAIN_PADDING[padding], MAIN_MAX_WIDTH[maxWidth], className)}
    >
      {children}
    </main>
  )
}

/* -------------------------------------------------------------------------------------------- */
/* Navegação                                                                                      */
/* -------------------------------------------------------------------------------------------- */

/**
 * Sidebar (≥ `md`) e BottomNav (< `md`) a partir de UM modelo de itens. A troca é por CSS e não por
 * hook de breakpoint — ver o comentário em `bottom-nav.tsx`.
 *
 * Componente separado de propósito: `useAppNavGroups` consulta o allow-list de Operação, e não se
 * consulta permissão de quem ainda não tem sessão (`/login`, `/docs` público).
 */
function AppNavigation() {
  const groups = useAppNavGroups()

  return (
    <>
      <AppShellSidebar>
        <Sidebar groups={groups} />
      </AppShellSidebar>
      <BottomNav groups={groups} className="md:hidden" />
    </>
  )
}

/* -------------------------------------------------------------------------------------------- */
/* Composição                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * Na rota pública `/login` a moldura some inteira — a tela de entrada é full-screen. Nas demais,
 * header + sidebar + main; o gate de autenticação continua sendo o `RouteGate`.
 *
 * A navegação só monta com sessão. Em `/docs` (rota pública, `RouteGate:11`) um visitante sem
 * sessão vê header e conteúdo, sem sidebar: oferecer links que terminam num redirect para o login
 * seria pior do que não oferecer link nenhum.
 */
export function AppShell({ version, children }: { version: string; children: React.ReactNode }) {
  const pathname = usePathname()
  const { authenticated } = useIsAuthenticated()

  if (pathname === '/login') {
    return <RouteGate>{children}</RouteGate>
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <AppShellSkipLink />

      <AppShellHeader>
        <AppShellLogo />
        <AppShellEnvBadge />
        <AppShellHeaderActions>
          <span
            className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground"
            data-testid="app-version"
            title={`Versao da aplicacao: ${version}`}
          >
            v{version}
          </span>
          <UserMenu />
        </AppShellHeaderActions>
      </AppShellHeader>

      <ConexosStatusBanner />

      <div className="flex min-h-0 flex-1">
        {/*
          A navegação é o único pedaço da moldura com estado, `localStorage` e fetch — e ela mora no
          layout raiz, fora do alcance do `app/error.tsx`. Sem esta fronteira, um throw em
          `useAppNavGroups` (ou na leitura do colapso da sidebar) levaria junto a página que o
          usuário estava usando. Com ela, o pior caso é a moldura ficar sem navegação: o conteúdo
          continua na tela e o logo do header continua levando para `/`.
        */}
        {authenticated ? (
          <ErrorBoundary boundaryName="AppNavigation">
            <AppNavigation />
          </ErrorBoundary>
        ) : null}
        {/* `pb-24` em mobile reserva a faixa do BottomNav (h-16) — sem isso a última linha da
            tabela fica escondida atrás dele. */}
        <AppShellMain className={authenticated ? 'pb-24 md:pb-6' : undefined}>
          <RouteGate>{children}</RouteGate>
        </AppShellMain>
      </div>
    </div>
  )
}

AppShell.SkipLink = AppShellSkipLink
AppShell.Header = AppShellHeader
AppShell.Logo = AppShellLogo
AppShell.EnvBadge = AppShellEnvBadge
AppShell.HeaderActions = AppShellHeaderActions
AppShell.Sidebar = AppShellSidebar
AppShell.Main = AppShellMain

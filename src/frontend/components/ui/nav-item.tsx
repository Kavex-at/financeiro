'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * `NavItem` — molecule de navegação, bloco de construção da `Sidebar` e do `BottomNav`
 * (ver `docs/design-system/sidebar.md` §Classificação Atomic).
 *
 * Densidade de ferramenta de operação: linha de 32px, label de 13px, ícone de 16px. Uma tela de
 * incidente mostra mais coisa por dobra do que uma landing page mostra — e é isso que se quer aqui.
 */

export type NavBadgeVariant = 'default' | 'warning' | 'danger' | 'success'

export interface NavBadge {
  count: number
  variant?: NavBadgeVariant
}

export interface SidebarItem {
  id: string
  label: string
  icon?: React.ReactNode
  href?: string
  onClick?: () => void
  badge?: NavBadge
  disabled?: boolean
  /**
   * Item ausente da navegação. É assim que **permissão** se expressa: o design system manda
   * esconder, nunca desabilitar (`docs/design-system/feedback.md` — "Nunca use disabled para
   * permissão"). O gate real é sempre server-side; esconder é ergonomia.
   */
  hidden?: boolean
  tooltip?: { title: string; description: string }
  /** Nível 2 apenas. A spec proíbe aninhar mais. */
  children?: SidebarItem[]
}

/** Números ≥ 100 viram "99+" (spec §Badges). */
export const formatNavBadgeCount = (count: number): string => (count >= 100 ? '99+' : String(count))

const BADGE_CLASSES: Record<NavBadgeVariant, string> = {
  default: 'bg-muted text-muted-foreground',
  warning: 'bg-warning-subtle text-warning-foreground',
  danger: 'bg-danger-subtle text-danger-foreground',
  success: 'bg-success-subtle text-success-foreground',
}

/** Badge 0 não renderiza (spec §Badges). */
function NavItemBadge({ badge, collapsed }: { badge: NavBadge; collapsed: boolean }) {
  if (badge.count <= 0) return null
  const tone = BADGE_CLASSES[badge.variant ?? 'default']

  if (collapsed) {
    return (
      <span
        data-slot="nav-item-badge"
        aria-label={badge.count >= 100 ? String(badge.count) : undefined}
        className={cn(
          'absolute right-1 top-0.5 min-w-4 rounded-full px-1 text-[10px] font-semibold leading-4 tabular-nums',
          tone,
        )}
      >
        {formatNavBadgeCount(badge.count)}
      </span>
    )
  }

  return (
    <span
      data-slot="nav-item-badge"
      /* "99+" é o que cabe na barra; o leitor de tela recebe o número real. */
      aria-label={badge.count >= 100 ? String(badge.count) : undefined}
      className={cn(
        'ml-auto min-w-5 rounded-full px-1.5 text-[11px] font-semibold leading-5 tabular-nums',
        tone,
      )}
    >
      {formatNavBadgeCount(badge.count)}
    </span>
  )
}

export interface NavItemProps {
  item: SidebarItem
  /** A rota atual É este item — recebe `aria-current="page"`. Só um item por vez. */
  active?: boolean
  /** Um descendente deste item está ativo. Realce de trilha, SEM `aria-current`. */
  activeTrail?: boolean
  collapsed?: boolean
  /** 0 = raiz, 1 = sub-item. */
  depth?: 0 | 1
  /** Presente quando o item tem filhos: controla o chevron de expandir. */
  expanded?: boolean
  onToggleExpanded?: () => void
  /** `id` do `<ul>` de sub-items, para `aria-controls`. */
  subMenuId?: string
  className?: string
}

/**
 * Linha de navegação. Renderiza `<a>` quando há `href`, `<button>` quando há só `onClick`, e um
 * `<span>` inerte quando não há nem um nem outro (pai puramente agrupador).
 *
 * Não renderiza o `<li>` nem o `<ul>` aninhado — quem compõe a lista é a `Sidebar` (organism).
 */
export function NavItem({
  item,
  active = false,
  activeTrail = false,
  collapsed = false,
  depth = 0,
  expanded,
  onToggleExpanded,
  subMenuId,
  className,
}: NavItemProps) {
  const hasChildren = (item.children?.length ?? 0) > 0
  const isSub = depth === 1

  const rowClasses = cn(
    'group relative flex items-center rounded-md text-[13px] outline-none transition-colors',
    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
    collapsed ? 'h-9 w-9 justify-center' : 'h-8 w-full gap-2.5 px-2',
    isSub && !collapsed && 'h-7 pl-2 text-[12px]',
    active
      ? 'bg-primary/10 font-medium text-primary'
      : activeTrail
        ? 'font-medium text-foreground hover:bg-muted'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    item.disabled && 'pointer-events-none opacity-50',
    className,
  )

  const content = (
    <>
      {/* Indicador vertical do item ativo (spec §Estados: "indicador à esquerda `primary`"). */}
      {active ? (
        <span
          aria-hidden
          className={cn(
            'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-full bg-primary',
            collapsed && '-left-1',
          )}
        />
      ) : null}
      {item.icon ? (
        <span aria-hidden className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
          {item.icon}
        </span>
      ) : isSub && !collapsed ? (
        <span
          aria-hidden
          className={cn('size-1 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-border')}
        />
      ) : null}
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
      {item.badge ? <NavItemBadge badge={item.badge} collapsed={collapsed} /> : null}
    </>
  )

  const commonProps = {
    'data-slot': 'nav-item',
    'data-active': active || undefined,
    'aria-current': active ? ('page' as const) : undefined,
    'aria-disabled': item.disabled || undefined,
    className: rowClasses,
  }

  let row: React.ReactNode
  if (item.href && !item.disabled) {
    row = (
      <Link href={item.href} onClick={item.onClick} {...commonProps}>
        {content}
      </Link>
    )
  } else if (item.onClick && !item.disabled) {
    row = (
      <button type="button" onClick={item.onClick} {...commonProps}>
        {content}
      </button>
    )
  } else {
    row = <span {...commonProps}>{content}</span>
  }

  // Colapsado: tooltip sempre (é a única forma de ler o label). Expandido: só quando há
  // descrição a acrescentar, com delay longo para não atrapalhar quem já sabe onde está.
  const tooltipBody = collapsed ? (
    <div className="max-w-56 space-y-0.5">
      <p className="font-medium">{item.tooltip?.title ?? item.label}</p>
      {item.tooltip?.description ? (
        <p className="text-xs text-muted-foreground">{item.tooltip.description}</p>
      ) : null}
    </div>
  ) : item.tooltip?.description ? (
    <p className="max-w-56 text-xs">{item.tooltip.description}</p>
  ) : null

  if (tooltipBody) {
    row = (
      <Tooltip delayDuration={collapsed ? 0 : 1000}>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right">{tooltipBody}</TooltipContent>
      </Tooltip>
    )
  }

  if (!hasChildren || collapsed) {
    return row
  }

  // Pai com filhos e sidebar expandida: o chevron é um alvo separado do link, para que clicar no
  // rótulo continue navegando (spec §Sub-items).
  return (
    <div className="flex items-center gap-0.5">
      <div className="min-w-0 flex-1">{row}</div>
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded ?? false}
        aria-controls={subMenuId}
        aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${item.label}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronDown
          aria-hidden
          className={cn('size-3.5 transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>
    </div>
  )
}

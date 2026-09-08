'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { formatNavBadgeCount, type SidebarItem } from '@/components/ui/nav-item'
import { resolveActiveItemId, type SidebarGroup } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

/**
 * `BottomNav` — a `Sidebar` em mobile (`docs/design-system/sidebar.md` §BottomNav).
 *
 * Consome exatamente os mesmos `SidebarItem[]` da sidebar: uma fonte de navegação, dois desenhos.
 * Um segundo modelo de itens seria a garantia de que os dois divergiriam na primeira rota nova.
 *
 * A troca desktop↔mobile é feita por CSS (`hidden md:flex` / `md:hidden` no `AppShell`), não por
 * hook de breakpoint: um hook mede o viewport só depois de montar, e o servidor não mede nada —
 * o resultado seria mismatch de hidratação em toda página.
 */

/** Máximo de alvos na barra antes do "Mais" (spec §BottomNav). */
const MAX_VISIBLE = 5

export interface BottomNavProps {
  items?: SidebarItem[]
  groups?: SidebarGroup[]
  activeItemId?: string
  className?: string
}

function BottomNavLink({
  item,
  active,
  onNavigate,
}: {
  item: SidebarItem
  active: boolean
  onNavigate?: () => void
}) {
  return (
    <Link
      href={item.href ?? '#'}
      onClick={() => {
        item.onClick?.()
        onNavigate?.()
      }}
      aria-current={active ? 'page' : undefined}
      data-slot="bottom-nav-item"
      className={cn(
        'relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active ? 'font-medium text-primary' : 'text-muted-foreground',
      )}
    >
      {active ? (
        <span aria-hidden className="absolute inset-x-2 top-0 h-0.5 rounded-b-full bg-primary" />
      ) : null}
      <span className="relative flex size-5 items-center justify-center [&>svg]:size-5">
        {item.icon}
        {item.badge && item.badge.count > 0 ? (
          <span className="absolute -right-2 -top-1 min-w-3.5 rounded-full bg-danger-subtle px-1 text-[9px] font-semibold leading-3.5 text-danger-foreground tabular-nums">
            {formatNavBadgeCount(item.badge.count)}
          </span>
        ) : null}
      </span>
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  )
}

export function BottomNav({ items, groups, activeItemId, className }: BottomNavProps) {
  const pathname = usePathname()
  const [maisAberto, setMaisAberto] = React.useState(false)

  const resolvedGroups = React.useMemo<SidebarGroup[]>(
    () => groups ?? [{ id: 'default', items: items ?? [] }],
    [groups, items],
  )

  // Achata os grupos e desce um nível: em mobile os sub-items são alvos de primeira classe, não
  // um menu dentro do menu. A ordem preserva pai → filhos.
  const flat = React.useMemo<SidebarItem[]>(() => {
    const out: SidebarItem[] = []
    for (const group of resolvedGroups) {
      for (const item of group.items) {
        if (item.hidden || !item.href) continue
        out.push(item)
        for (const child of item.children ?? []) {
          if (!child.hidden && child.href) out.push(child)
        }
      }
    }
    return out
  }, [resolvedGroups])

  const activeId = activeItemId ?? resolveActiveItemId(resolvedGroups, pathname)

  if (flat.length === 0) return null

  const temOverflow = flat.length > MAX_VISIBLE
  const visiveis = temOverflow ? flat.slice(0, MAX_VISIBLE - 1) : flat
  const restantes = temOverflow ? flat.slice(MAX_VISIBLE - 1) : []
  const ativoEstaNoMais = restantes.some((item) => item.id === activeId)

  return (
    <nav
      role="navigation"
      aria-label="Navegação principal (mobile)"
      data-slot="bottom-nav"
      className={cn(
        'fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]',
        className,
      )}
    >
      {maisAberto && restantes.length > 0 ? (
        <ul
          role="list"
          id="bottom-nav-mais"
          className="max-h-64 overflow-y-auto border-b border-border p-2"
        >
          {restantes.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href ?? '#'}
                onClick={() => setMaisAberto(false)}
                aria-current={item.id === activeId ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-2.5 rounded-md px-2 text-sm',
                  item.id === activeId
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-foreground',
                )}
              >
                <span aria-hidden className="flex size-4 items-center justify-center [&>svg]:size-4">
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex h-16 items-stretch">
        {visiveis.map((item) => (
          <BottomNavLink
            key={item.id}
            item={item}
            active={item.id === activeId}
            onNavigate={() => setMaisAberto(false)}
          />
        ))}
        {temOverflow ? (
          <button
            type="button"
            onClick={() => setMaisAberto((aberto) => !aberto)}
            aria-expanded={maisAberto}
            aria-controls="bottom-nav-mais"
            className={cn(
              'relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              ativoEstaNoMais || maisAberto
                ? 'font-medium text-primary'
                : 'text-muted-foreground',
            )}
          >
            {ativoEstaNoMais ? (
              <span
                aria-hidden
                className="absolute inset-x-2 top-0 h-0.5 rounded-b-full bg-primary"
              />
            ) : null}
            <MoreHorizontal aria-hidden className="size-5" />
            <span>Mais</span>
          </button>
        ) : null}
      </div>
    </nav>
  )
}

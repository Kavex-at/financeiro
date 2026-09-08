'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NavItem, type SidebarItem } from '@/components/ui/nav-item'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type { NavBadge, NavBadgeVariant, SidebarItem } from '@/components/ui/nav-item'

/**
 * `Sidebar` — organism de navegação principal (`docs/design-system/sidebar.md`).
 *
 * Extensão deliberada sobre a spec: `groups`. A spec dá `items` plano à `Sidebar` e reserva
 * `groups` ao `SettingsSidebar`; aqui a navegação tem dois pesos distintos (as **Frentes** do
 * negócio e a **Plataforma** que as opera), e a hierarquia entre eles é o que impede a lista de
 * virar uma fileira uniforme de links. A forma de `SidebarGroup` é a mesma de `SettingsGroup`
 * já definida na spec, então não é API nova — é a mesma ideia aplicada um nível acima.
 *
 * `items` continua funcionando e vira um grupo único e sem rótulo.
 */

export interface SidebarGroup {
  id: string
  label?: string
  items: SidebarItem[]
}

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'ds:sidebar:collapsed:v1'

/* -------------------------------------------------------------------------------------------- */
/* Resolução do item ativo                                                                        */
/* -------------------------------------------------------------------------------------------- */

const matchesPath = (href: string, pathname: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`)

/**
 * O item ativo é o de **maior especificidade** (href mais longo) que casa com a rota. Isso é o que
 * garante um único `aria-current="page"` na árvore: com `/permutas` e `/permutas/borderos` ambos
 * casando em `/permutas/borderos`, só o filho ganha o `aria-current` — o pai fica com o realce de
 * trilha. Dois `aria-current` na mesma navegação diriam ao leitor de tela que o usuário está em
 * duas páginas ao mesmo tempo.
 */
export function resolveActiveItemId(
  groups: SidebarGroup[],
  pathname: string | null,
): string | undefined {
  if (!pathname) return undefined
  let bestId: string | undefined
  let bestLength = -1

  const visit = (items: SidebarItem[]) => {
    for (const item of items) {
      if (item.hidden) continue
      if (item.href && matchesPath(item.href, pathname) && item.href.length > bestLength) {
        bestId = item.id
        bestLength = item.href.length
      }
      if (item.children) visit(item.children)
    }
  }

  for (const group of groups) visit(group.items)
  return bestId
}

const hasDescendant = (item: SidebarItem, id?: string): boolean =>
  id !== undefined && (item.children ?? []).some((child) => child.id === id)

/* -------------------------------------------------------------------------------------------- */
/* Contexto (forma compound)                                                                      */
/* -------------------------------------------------------------------------------------------- */

interface SidebarContextValue {
  collapsed: boolean
  setCollapsed: (value: boolean) => void
  activeItemId?: string
}

const SidebarContext = React.createContext<SidebarContextValue | undefined>(undefined)

function useSidebarContext(component: string): SidebarContextValue {
  const ctx = React.useContext(SidebarContext)
  if (!ctx) throw new Error(`<${component}> precisa estar dentro de <Sidebar.Root>`)
  return ctx
}

/** localStorage falha em modo privado e em iframes com storage bloqueado. Nunca derruba a tela. */
const readStoredCollapsed = (key: string): boolean | undefined => {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    /* storage indisponível — segue com o default */
  }
  return undefined
}

const writeStoredCollapsed = (key: string, value: boolean): void => {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    /* storage indisponível — o estado vale só para esta sessão */
  }
}

/* -------------------------------------------------------------------------------------------- */
/* Subcomponentes                                                                                 */
/* -------------------------------------------------------------------------------------------- */

export interface SidebarRootProps {
  collapsed?: boolean
  onCollapsedChange?: (value: boolean) => void
  defaultCollapsed?: boolean
  persistKey?: string
  activeItemId?: string
  className?: string
  children: React.ReactNode
}

export function SidebarRoot({
  collapsed: collapsedProp,
  onCollapsedChange,
  defaultCollapsed = false,
  persistKey = SIDEBAR_COLLAPSED_STORAGE_KEY,
  activeItemId,
  className,
  children,
}: SidebarRootProps) {
  const isControlled = collapsedProp !== undefined
  const [internal, setInternal] = React.useState(defaultCollapsed)

  // Hidratação da preferência DEPOIS da montagem, de propósito: ler o localStorage no
  // inicializador do useState faria o servidor renderizar expandido e o cliente colapsado, e o
  // React aborta a hidratação nesse desencontro.
  React.useEffect(() => {
    if (isControlled) return
    const stored = readStoredCollapsed(persistKey)
    if (stored !== undefined) setInternal(stored)
  }, [isControlled, persistKey])

  const collapsed = isControlled ? collapsedProp : internal

  const setCollapsed = React.useCallback(
    (value: boolean) => {
      if (!isControlled) setInternal(value)
      writeStoredCollapsed(persistKey, value)
      onCollapsedChange?.(value)
    },
    [isControlled, onCollapsedChange, persistKey],
  )

  const value = React.useMemo<SidebarContextValue>(
    () => ({ collapsed, setCollapsed, activeItemId }),
    [collapsed, setCollapsed, activeItemId],
  )

  return (
    <SidebarContext.Provider value={value}>
      <TooltipProvider>
        <nav
          id="sidebar"
          role="navigation"
          aria-label="Navegação principal"
          data-slot="sidebar"
          data-collapsed={collapsed || undefined}
          className={cn(
            'flex h-full flex-col border-r border-border bg-card',
            'transition-[width] duration-200 ease-in-out',
            collapsed ? 'w-16' : 'w-56',
            className,
          )}
        >
          {children}
        </nav>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

export function SidebarHeader({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div data-slot="sidebar-header" className={cn('border-b border-border p-2', className)}>
      {children}
    </div>
  )
}

export function SidebarNav({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="sidebar-nav"
      className={cn('flex-1 space-y-4 overflow-y-auto px-2 py-3', className)}
    >
      {children}
    </div>
  )
}

export function SidebarFooter({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn('space-y-1 border-t border-border p-2', className)}
    >
      {children}
    </div>
  )
}

/** Rótulo de grupo. Colapsada, o rótulo some e um divisor toma o lugar dele. */
export function SidebarGroupLabel({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebarContext('Sidebar.GroupLabel')
  if (collapsed) return <div aria-hidden className="mx-2 my-2 border-t border-border" />
  return (
    <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

export interface SidebarNavItemProps {
  item: SidebarItem
  depth?: 0 | 1
}

/** `<li>` + `NavItem` + o `<ul>` de nível 2 quando houver. Um nível só, como manda a spec. */
export function SidebarNavItemComponent({ item, depth = 0 }: SidebarNavItemProps) {
  const { collapsed, activeItemId } = useSidebarContext('Sidebar.Item')
  const children = (item.children ?? []).filter((child) => !child.hidden)
  const hasChildren = children.length > 0
  const activeTrail = hasDescendant(item, activeItemId)
  const [manuallyExpanded, setManuallyExpanded] = React.useState<boolean | undefined>(undefined)
  const expanded = manuallyExpanded ?? activeTrail
  const subMenuId = `sidebar-submenu-${item.id}`

  if (item.hidden) return null

  return (
    <li>
      <NavItem
        item={hasChildren ? { ...item, children } : item}
        active={activeItemId === item.id}
        activeTrail={activeTrail}
        collapsed={collapsed}
        depth={depth}
        expanded={expanded}
        onToggleExpanded={() => setManuallyExpanded(!expanded)}
        subMenuId={subMenuId}
      />
      {hasChildren && !collapsed ? (
        <ul
          role="list"
          id={subMenuId}
          hidden={!expanded}
          className="ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2"
        >
          {children.map((child) => (
            <SidebarNavItemComponent key={child.id} item={child} depth={1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function SidebarCollapseToggle({ className }: { className?: string }) {
  const { collapsed, setCollapsed } = useSidebarContext('Sidebar.CollapseToggle')
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <button
      type="button"
      data-slot="sidebar-collapse-toggle"
      onClick={() => setCollapsed(!collapsed)}
      aria-expanded={!collapsed}
      aria-controls="sidebar"
      aria-label={collapsed ? 'Expandir navegação' : 'Colapsar navegação'}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
        collapsed ? 'w-9 justify-center px-0' : 'w-full',
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {collapsed ? null : <span className="truncate">Colapsar</span>}
    </button>
  )
}

/* -------------------------------------------------------------------------------------------- */
/* Forma pré-configurada                                                                          */
/* -------------------------------------------------------------------------------------------- */

export interface SidebarProps {
  /** Lista plana. Ignorada quando `groups` é passado. */
  items?: SidebarItem[]
  groups?: SidebarGroup[]
  /** Se omitido, deriva da URL atual. */
  activeItemId?: string
  collapsed?: boolean
  onCollapsedChange?: (value: boolean) => void
  defaultCollapsed?: boolean
  footer?: React.ReactNode
  logo?: React.ReactNode
  persistKey?: string
  className?: string
}

export function Sidebar({
  items,
  groups,
  activeItemId,
  collapsed,
  onCollapsedChange,
  defaultCollapsed,
  footer,
  logo,
  persistKey,
  className,
}: SidebarProps) {
  const pathname = usePathname()
  const resolvedGroups = React.useMemo<SidebarGroup[]>(
    () => groups ?? [{ id: 'default', items: items ?? [] }],
    [groups, items],
  )
  const derivedActiveId = React.useMemo(
    () => resolveActiveItemId(resolvedGroups, pathname),
    [resolvedGroups, pathname],
  )

  return (
    <SidebarRoot
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      defaultCollapsed={defaultCollapsed}
      persistKey={persistKey}
      activeItemId={activeItemId ?? derivedActiveId}
      className={className}
    >
      {logo ? <SidebarHeader>{logo}</SidebarHeader> : null}
      <SidebarNav>
        {resolvedGroups.map((group) => {
          const visible = group.items.filter((item) => !item.hidden)
          if (visible.length === 0) return null
          return (
            <div key={group.id}>
              {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
              <ul role="list" className="space-y-0.5">
                {visible.map((item) => (
                  <SidebarNavItemComponent key={item.id} item={item} />
                ))}
              </ul>
            </div>
          )
        })}
      </SidebarNav>
      <SidebarFooter>
        <SidebarCollapseToggle />
        {footer}
      </SidebarFooter>
    </SidebarRoot>
  )
}

Sidebar.Root = SidebarRoot
Sidebar.Header = SidebarHeader
Sidebar.Nav = SidebarNav
Sidebar.GroupLabel = SidebarGroupLabel
Sidebar.Item = SidebarNavItemComponent
Sidebar.Footer = SidebarFooter
Sidebar.CollapseToggle = SidebarCollapseToggle

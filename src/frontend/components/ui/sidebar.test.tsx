/**
 * Sidebar — a moldura de navegação global.
 *
 * O que estes testes fixam é o que não dá para ver olhando a tela: que existe UM e só um
 * `aria-current="page"` (dois diriam ao leitor de tela que o usuário está em duas páginas ao mesmo
 * tempo), que permissão ausente ESCONDE em vez de desabilitar, e que a preferência de colapso
 * sobrevive à remontagem. Antes desta feature o `src/frontend/` inteiro tinha zero `<nav>`,
 * zero `role="navigation"` e zero `aria-current`.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  resolveActiveItemId,
  Sidebar,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  type SidebarGroup,
} from '@/components/ui/sidebar'

const pathnameMock = jest.fn<string, []>()
jest.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}))

const groups: SidebarGroup[] = [
  {
    id: 'frentes',
    label: 'Frentes',
    items: [
      {
        id: 'permutas',
        label: 'Permutas',
        href: '/permutas',
        children: [{ id: 'borderos', label: 'Borderôs', href: '/permutas/borderos' }],
      },
      { id: 'sispag', label: 'SISPAG', href: '/sispag', hidden: true },
      {
        id: 'recebimentos',
        label: 'Adiantamentos',
        href: '/recebimentos',
        badge: { count: 140, variant: 'warning' },
      },
    ],
  },
  {
    id: 'plataforma',
    label: 'Plataforma',
    items: [{ id: 'operacao', label: 'Operação', href: '/operacao', badge: { count: 0 } }],
  },
]

const renderSidebar = (pathname: string) => {
  pathnameMock.mockReturnValue(pathname)
  return render(<Sidebar groups={groups} />)
}

describe('Sidebar', () => {
  beforeEach(() => {
    pathnameMock.mockReset()
    window.localStorage.clear()
  })

  it('é uma landmark de navegação rotulada', () => {
    renderSidebar('/permutas')
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument()
  })

  it('marca o item da rota atual com aria-current="page"', () => {
    renderSidebar('/recebimentos')

    // O badge entra no nome acessível ("Adiantamentos 140") — daí a âncora no início.
    const ativo = screen.getByRole('link', { name: /^Adiantamentos/ })
    expect(ativo).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Permutas' })).not.toHaveAttribute('aria-current')
  })

  it('numa sub-rota, só o filho recebe aria-current — o pai fica só com a trilha', () => {
    const { container } = renderSidebar('/permutas/borderos')

    expect(screen.getByRole('link', { name: 'Borderôs' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Permutas' })).not.toHaveAttribute('aria-current')
    // A invariante que importa: um único aria-current na árvore inteira.
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1)
  })

  it('auto-expande o sub-menu quando um filho está ativo', () => {
    renderSidebar('/permutas/borderos')

    expect(screen.getByRole('link', { name: 'Borderôs' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Recolher Permutas' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('mantém o sub-menu recolhido fora da sub-rota e o abre no clique', async () => {
    const user = userEvent.setup()
    renderSidebar('/recebimentos')

    const chevron = screen.getByRole('button', { name: 'Expandir Permutas' })
    expect(chevron).toHaveAttribute('aria-expanded', 'false')
    expect(chevron).toHaveAttribute('aria-controls', 'sidebar-submenu-permutas')
    expect(screen.getByRole('link', { name: 'Borderôs', hidden: true })).not.toBeVisible()

    await user.click(chevron)
    expect(screen.getByRole('link', { name: 'Borderôs' })).toBeVisible()
  })

  it('item marcado hidden não renderiza — permissão esconde, não desabilita', () => {
    renderSidebar('/permutas')

    expect(screen.queryByText('SISPAG')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'SISPAG' })).not.toBeInTheDocument()
    // E não vira um item cinza: nenhum item da sidebar fica aria-disabled.
    expect(
      screen.getByRole('navigation').querySelectorAll('[aria-disabled="true"]'),
    ).toHaveLength(0)
  })

  it('badge: 0 não renderiza e ≥ 100 vira "99+"', () => {
    const { container } = renderSidebar('/permutas')

    const badges = container.querySelectorAll('[data-slot="nav-item-badge"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]).toHaveTextContent('99+')
  })

  it('agrupa com rótulo de grupo visível quando expandida', () => {
    renderSidebar('/permutas')
    expect(screen.getByText('Frentes')).toBeInTheDocument()
    expect(screen.getByText('Plataforma')).toBeInTheDocument()
  })

  it('persiste o colapso em ds:sidebar:collapsed:v1 e relê na montagem seguinte', async () => {
    const user = userEvent.setup()
    const { unmount } = renderSidebar('/permutas')

    const toggle = screen.getByRole('button', { name: 'Colapsar navegação' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true')
    expect(screen.getByRole('button', { name: 'Expandir navegação' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )

    unmount()
    renderSidebar('/permutas')
    expect(screen.getByRole('button', { name: 'Expandir navegação' })).toBeInTheDocument()
  })

  it('colapsada, o label de cada item continua acessível', async () => {
    const user = userEvent.setup()
    renderSidebar('/permutas')
    await user.click(screen.getByRole('button', { name: 'Colapsar navegação' }))

    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(nav).toHaveAttribute('data-collapsed', 'true')
    expect(within(nav).getByRole('link', { name: /^Adiantamentos/ })).toBeInTheDocument()
  })

  it('não quebra quando o localStorage está indisponível', () => {
    const getItem = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('storage bloqueado')
      })

    expect(() => renderSidebar('/permutas')).not.toThrow()
    expect(screen.getByRole('button', { name: 'Colapsar navegação' })).toBeInTheDocument()

    getItem.mockRestore()
  })
})

describe('resolveActiveItemId', () => {
  it('escolhe o href mais específico que casa com a rota', () => {
    expect(resolveActiveItemId(groups, '/permutas/borderos')).toBe('borderos')
    expect(resolveActiveItemId(groups, '/permutas')).toBe('permutas')
    // Sub-rota sem item próprio cai no ancestral mais próximo.
    expect(resolveActiveItemId(groups, '/permutas/borderos/123')).toBe('borderos')
  })

  it('ignora itens escondidos e rotas sem item correspondente', () => {
    expect(resolveActiveItemId(groups, '/sispag')).toBeUndefined()
    expect(resolveActiveItemId(groups, '/')).toBeUndefined()
    expect(resolveActiveItemId(groups, null)).toBeUndefined()
  })

  it('não confunde prefixo de segmento com sub-rota', () => {
    expect(resolveActiveItemId(groups, '/permutas-antigas')).toBeUndefined()
  })
})

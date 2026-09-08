/**
 * BottomNav — a navegação em mobile.
 *
 * O caso que importa é o overflow: o Financeiro tem mais alvos de navegação do que cabem numa barra
 * de 5, então o caminho do "Mais" NÃO é hipotético — é o caminho normal em qualquer telefone.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BottomNav } from '@/components/ui/bottom-nav'
import type { SidebarGroup } from '@/components/ui/sidebar'

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
      { id: 'recebimentos', label: 'Adiantamentos', href: '/recebimentos' },
    ],
  },
  {
    id: 'plataforma',
    label: 'Plataforma',
    items: [
      { id: 'operacao', label: 'Operação', href: '/operacao' },
      { id: 'usuarios', label: 'Usuários', href: '/usuarios' },
      { id: 'extra', label: 'Extra', href: '/extra' },
    ],
  },
]

const renderBottomNav = (pathname: string) => {
  pathnameMock.mockReturnValue(pathname)
  return render(<BottomNav groups={groups} />)
}

describe('BottomNav', () => {
  beforeEach(() => pathnameMock.mockReset())

  it('é uma landmark de navegação distinta da sidebar', () => {
    renderBottomNav('/permutas')
    expect(
      screen.getByRole('navigation', { name: 'Navegação principal (mobile)' }),
    ).toBeInTheDocument()
  })

  it('marca a rota atual com aria-current="page"', () => {
    renderBottomNav('/permutas')
    expect(screen.getByRole('link', { name: 'Permutas' })).toHaveAttribute('aria-current', 'page')
  })

  it('esconde item sem permissão, como a sidebar', () => {
    renderBottomNav('/permutas')
    expect(screen.queryByRole('link', { name: 'SISPAG' })).not.toBeInTheDocument()
  })

  it('acima de 5 alvos, o excedente vai para "Mais" — e o "Mais" abre a lista', async () => {
    const user = userEvent.setup()
    renderBottomNav('/permutas')

    const nav = screen.getByRole('navigation', { name: 'Navegação principal (mobile)' })
    // 4 alvos diretos + o botão "Mais".
    expect(within(nav).getAllByRole('link')).toHaveLength(4)

    const mais = screen.getByRole('button', { name: 'Mais' })
    expect(mais).toHaveAttribute('aria-expanded', 'false')

    await user.click(mais)
    expect(mais).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Usuários' })).toHaveAttribute('href', '/usuarios')
    expect(screen.getByRole('link', { name: 'Extra' })).toBeInTheDocument()
  })

  it('sinaliza o "Mais" quando a rota atual mora dentro dele', async () => {
    const user = userEvent.setup()
    renderBottomNav('/usuarios')

    const mais = screen.getByRole('button', { name: 'Mais' })
    expect(mais).toHaveClass('text-primary')

    await user.click(mais)
    expect(screen.getByRole('link', { name: 'Usuários' })).toHaveAttribute('aria-current', 'page')
  })

  it('achata os sub-items: em mobile eles são alvos de primeira classe', async () => {
    const user = userEvent.setup()
    renderBottomNav('/permutas')

    expect(screen.getByRole('link', { name: 'Borderôs' })).toHaveAttribute(
      'href',
      '/permutas/borderos',
    )
    await user.click(screen.getByRole('button', { name: 'Mais' }))
    expect(screen.getByRole('link', { name: 'Operação' })).toBeInTheDocument()
  })

  it('não renderiza quando não há nenhum item visível', () => {
    pathnameMock.mockReturnValue('/permutas')
    const { container } = render(
      <BottomNav groups={[{ id: 'g', items: [{ id: 'x', label: 'X', href: '/x', hidden: true }] }]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

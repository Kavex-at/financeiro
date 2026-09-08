/**
 * AppShell — a moldura.
 *
 * Três regressões que estes testes travam, todas medidas no código anterior:
 *  - `AppShell.tsx:25` emitia `<h1>Columbia Trading</h1>` e o `PageHeader` emitia outro `<h1>`;
 *    para um leitor de tela, toda tela do sistema se chamava "Columbia Trading";
 *  - a marca era `<h1>` + spans e clicar nela não fazia nada;
 *  - não havia skip link nem `role="main"` em lugar nenhum do `src/frontend/`.
 */
import { render, screen, within } from '@testing-library/react'
import { AppShell } from '@/components/AppShell'

const pathnameMock = jest.fn<string, []>()
jest.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}))

const authenticatedMock = jest.fn<boolean, []>()
jest.mock('@/lib/auth/AuthProvider', () => ({
  useIsAuthenticated: () => ({ authenticated: authenticatedMock(), loading: false }),
  useIsAdmin: () => true,
}))

// Promessa que nunca resolve: o item de Operação tem teste próprio em `components/nav`, e aqui
// uma resolução assíncrona só produziria atualização de estado fora do `act`.
jest.mock('@/lib/operacao', () => ({
  fetchPermissoes: () => new Promise(() => {}),
}))

// Nem o menu de usuário nem o banner do Conexos são o objeto deste teste, e ambos dependem do
// AuthProvider real (contexto + fetch). O RouteGate tem teste próprio.
jest.mock('@/components/auth/UserMenu', () => ({ UserMenu: () => null }))
jest.mock('@/components/auth/ConexosStatusBanner', () => ({ ConexosStatusBanner: () => null }))
jest.mock('@/components/auth/RouteGate', () => ({
  RouteGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const renderShell = (pathname: string, autenticado = true) => {
  pathnameMock.mockReturnValue(pathname)
  authenticatedMock.mockReturnValue(autenticado)
  return render(
    <AppShell version="9.9.9">
      <h1>Título da página</h1>
    </AppShell>,
  )
}

describe('AppShell', () => {
  beforeEach(() => {
    pathnameMock.mockReset()
    authenticatedMock.mockReset()
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
  })

  it('o primeiro elemento focável é o link de pular para o conteúdo', () => {
    const { container } = renderShell('/permutas')

    const skip = screen.getByRole('link', { name: 'Pular para o conteúdo' })
    expect(skip).toHaveAttribute('href', '#main-content')
    expect(skip).toHaveClass('sr-only')
    // É o primeiro focável da página: nenhum outro link/botão vem antes dele no DOM.
    const focaveis = container.querySelectorAll('a[href], button')
    expect(focaveis[0]).toBe(skip)
  })

  it('o alvo do skip link existe e é a landmark principal', () => {
    renderShell('/permutas')

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main-content')
  })

  it('não emite <h1> próprio — o único <h1> da página é o do conteúdo', () => {
    const { container } = renderShell('/permutas')

    const titulos = container.querySelectorAll('h1')
    expect(titulos).toHaveLength(1)
    expect(titulos[0]).toHaveTextContent('Título da página')
  })

  it('a marca é um link para a raiz', () => {
    renderShell('/permutas')

    const marca = screen.getByRole('link', { name: /Columbia Trading/i })
    expect(marca).toHaveAttribute('href', '/')
  })

  it('monta a navegação global em toda rota autenticada — nenhuma tela sem saída', () => {
    renderShell('/sispag')

    // Sidebar (desktop) e BottomNav (mobile) montam juntos — quem some é o CSS, então as buscas
    // por link são escopadas à sidebar para não casarem duas vezes.
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Adiantamentos' })).toHaveAttribute(
      'href',
      '/recebimentos',
    )
    expect(within(nav).getByRole('link', { name: 'Permutas' })).toHaveAttribute('href', '/permutas')
    expect(
      screen.getByRole('navigation', { name: 'Navegação principal (mobile)' }),
    ).toBeInTheDocument()
  })

  it('mantém o selo de versão no header', () => {
    renderShell('/permutas')
    expect(screen.getByTestId('app-version')).toHaveTextContent('v9.9.9')
  })

  it('em /login não renderiza moldura nenhuma', () => {
    renderShell('/login')

    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Pular para o conteúdo' })).not.toBeInTheDocument()
  })

  it('em rota pública sem sessão mostra o conteúdo, mas não a navegação interna', () => {
    renderShell('/docs/arquitetura', false)

    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Navegação principal' })).not.toBeInTheDocument()
  })
})

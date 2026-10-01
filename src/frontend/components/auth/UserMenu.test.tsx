import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserMenu } from '@/components/auth/UserMenu'

const replace = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

let auth: { username: string | null; devBypass: boolean; signOut: jest.Mock }
jest.mock('@/lib/auth/AuthProvider', () => ({ useAuth: () => auth }))

let permissoes: { papel?: { id: number; nome: string }; carregando: boolean; falhou: boolean }
jest.mock('@/lib/auth/PermissoesProvider', () => ({ usePermissoes: () => permissoes }))

beforeEach(() => {
  replace.mockReset()
  auth = { username: 'ana.souza', devBypass: false, signOut: jest.fn() }
  permissoes = { papel: { id: 2, nome: 'Operador' }, carregando: false, falhou: false }
})

describe('UserMenu (menu de avatar)', () => {
  it('sem sessão ou em dev-bypass não renderiza nada', () => {
    auth.username = null
    const { container, rerender } = render(<UserMenu />)
    expect(container).toBeEmptyDOMElement()
    auth = { username: 'ana.souza', devBypass: true, signOut: jest.fn() }
    rerender(<UserMenu />)
    expect(container).toBeEmptyDOMElement()
  })

  it('o gatilho é o avatar com as iniciais, alvo de toque ≥ 40px', () => {
    render(<UserMenu />)
    const gatilho = screen.getByRole('button', { name: /menu da conta/i })
    expect(gatilho).toHaveTextContent('AS')
    expect(gatilho.className).toMatch(/size-10/)
  })

  it('abre por clique: username, nome do papel e os itens', async () => {
    const user = userEvent.setup()
    render(<UserMenu />)
    await user.click(screen.getByRole('button', { name: /menu da conta/i }))
    const menu = screen.getByRole('menu')
    expect(menu).toHaveTextContent('ana.souza')
    expect(menu).toHaveTextContent('Operador')
    expect(screen.getByRole('menuitem', { name: 'Meu perfil' })).toHaveAttribute('href', '/perfil')
    expect(screen.getByRole('menuitem', { name: 'Alterar senha' })).toHaveAttribute(
      'href',
      '/perfil#senha',
    )
    // Um separador sob a identidade e outro antes de "Sair".
    expect(screen.getAllByRole('separator')).toHaveLength(2)
    expect(screen.getByRole('menuitem', { name: 'Sair' })).toBeInTheDocument()
  })

  it.each([['{Enter}'], [' ']])('abre pelo teclado (%s)', async (tecla) => {
    const user = userEvent.setup()
    render(<UserMenu />)
    screen.getByRole('button', { name: /menu da conta/i }).focus()
    await user.keyboard(tecla)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('sem papel (carregando ou falhou) mostra só o username', async () => {
    permissoes = { carregando: false, falhou: true }
    const user = userEvent.setup()
    render(<UserMenu />)
    await user.click(screen.getByRole('button', { name: /menu da conta/i }))
    const menu = screen.getByRole('menu')
    expect(menu).toHaveTextContent('ana.souza')
    expect(menu).not.toHaveTextContent('Operador')
  })

  it('"Sair" usa o logout existente e volta ao /login', async () => {
    const user = userEvent.setup()
    render(<UserMenu />)
    await user.click(screen.getByRole('button', { name: /menu da conta/i }))
    await user.click(screen.getByRole('menuitem', { name: 'Sair' }))
    expect(auth.signOut).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith('/login')
  })
})

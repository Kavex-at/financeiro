/**
 * Tela de login (ADR-0051): o campo aceita "E-mail ou usuário", e o banner de transição para o
 * e-mail da Columbia aparece só quando a chave do backend responde `true`. Falhou, está pendente
 * ou respondeu `false`: nada aparece, e o formulário já funciona.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const replaceMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({ get: () => null }),
}))

const signInMock = jest.fn()
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ signIn: signInMock, token: null, devBypass: false, loading: false }),
}))

const fetchTransicaoEmailMock = jest.fn()
jest.mock('@/lib/auth/transicao', () => ({
  fetchTransicaoEmail: () => fetchTransicaoEmailMock(),
}))

import LoginPage from '@/app/login/page'

const TITULO = 'Estamos migrando o acesso para o seu e-mail da Columbia.'
const CORPO =
  'Durante a transição, você continua entrando com seu usuário atual. Quando seu e-mail da ' +
  'Columbia for cadastrado, ele também passa a valer, com a mesma senha.'

describe('LoginPage', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    signInMock.mockReset()
    fetchTransicaoEmailMock.mockReset()
  })

  it('rotula o campo como "E-mail ou usuário", mantendo autoComplete e data-testid', async () => {
    fetchTransicaoEmailMock.mockResolvedValue(false)
    render(<LoginPage />)

    const campo = screen.getByLabelText('E-mail ou usuário')
    expect(campo).toHaveAttribute('autocomplete', 'username')
    expect(campo).toHaveAttribute('data-testid', 'login-username')
    // Placeholder coerente com o rótulo: sugere um e-mail e o usuário legado.
    expect(campo.getAttribute('placeholder')).toMatch(/@.*usuário/i)
    await waitFor(() => expect(fetchTransicaoEmailMock).toHaveBeenCalled())
  })

  it('chave ligada: mostra o banner com o texto aprovado, literal, como status', async () => {
    fetchTransicaoEmailMock.mockResolvedValue(true)
    render(<LoginPage />)

    const banner = await screen.findByRole('status')
    expect(banner).toHaveTextContent(TITULO)
    expect(banner).toHaveTextContent(CORPO)
    expect(screen.getByText(TITULO)).toBeInTheDocument()
    expect(screen.getByText(CORPO)).toBeInTheDocument()
    // Tokens semânticos de info, sem cor crua.
    expect(banner.className).toMatch(/bg-info-subtle/)
    expect(banner.className).not.toMatch(/#[0-9a-f]{3,6}|bg-blue-/i)
    // Ícone decorativo.
    expect(banner.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('chave desligada: sem banner', async () => {
    fetchTransicaoEmailMock.mockResolvedValue(false)
    render(<LoginPage />)
    await waitFor(() => expect(fetchTransicaoEmailMock).toHaveBeenCalled())
    await act(async () => undefined)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText(TITULO)).not.toBeInTheDocument()
  })

  it('chamada rejeitada: sem banner e sem erro visível', async () => {
    fetchTransicaoEmailMock.mockRejectedValue(new Error('rede'))
    render(<LoginPage />)
    await waitFor(() => expect(fetchTransicaoEmailMock).toHaveBeenCalled())
    await act(async () => undefined)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('chamada pendente: sem banner, sem espaço reservado, e o formulário já envia', async () => {
    fetchTransicaoEmailMock.mockReturnValue(new Promise(() => undefined))
    signInMock.mockResolvedValue(undefined)
    render(<LoginPage />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByTestId('login-transicao-banner')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('login-username'), {
      target: { value: 'ti@columbiabr.com' },
    })
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'segredo12' } })
    fireEvent.click(screen.getByTestId('login-submit'))

    // O fluxo de signIn não muda: o que foi digitado vai como `username`.
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith('ti@columbiabr.com', 'segredo12'))
  })
})

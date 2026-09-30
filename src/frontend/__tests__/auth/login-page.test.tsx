/**
 * Tela de login (ADR-0051/0054): o campo aceita "E-mail ou usuário"; o banner de transição saiu;
 * as recusas mostram 401 genérico, e 429/503 com a mensagem do backend.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const replaceMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => ({ get: () => null }),
}))

const signInMock = jest.fn()
jest.mock('@/lib/auth/AuthProvider', () => ({
  ...jest.requireActual('@/lib/auth/AuthProvider'),
  useAuth: () => ({ signIn: signInMock, token: null, devBypass: false, loading: false }),
}))

import LoginPage from '@/app/login/page'
import { mensagemDeLogin } from '@/lib/auth/AuthProvider'

const enviar = () => {
  fireEvent.change(screen.getByTestId('login-username'), { target: { value: 'beto' } })
  fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'segredo12' } })
  fireEvent.click(screen.getByTestId('login-submit'))
}

describe('LoginPage', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    replaceMock.mockReset()
    signInMock.mockReset()
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('rotula o campo como "E-mail ou usuário", mantendo autoComplete e data-testid', () => {
    render(<LoginPage />)
    const campo = screen.getByLabelText('E-mail ou usuário')
    expect(campo).toHaveAttribute('autocomplete', 'username')
    expect(campo).toHaveAttribute('data-testid', 'login-username')
    expect(campo.getAttribute('placeholder')).toMatch(/@.*usuário/i)
  })

  it('o banner de transição para e-mail e a consulta dele ao backend sumiram', () => {
    render(<LoginPage />)
    expect(screen.queryByText(/migrando o acesso/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('login por username continua: o que foi digitado vai como username', async () => {
    signInMock.mockResolvedValue(undefined)
    render(<LoginPage />)
    enviar()
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith('beto', 'segredo12'))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
  })

  it('recusa: mostra a mensagem que o AuthProvider montou, como alerta', async () => {
    signInMock.mockRejectedValue(new Error('E-mail/usuário ou senha inválidos.'))
    render(<LoginPage />)
    enviar()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'E-mail/usuário ou senha inválidos.',
    )
  })
})

describe('mensagemDeLogin (por status)', () => {
  it('401: texto genérico de credencial, igual para qualquer causa', () => {
    expect(mensagemDeLogin(401, 'Credenciais inválidas')).toBe('E-mail/usuário ou senha inválidos.')
    expect(mensagemDeLogin(401)).toBe('E-mail/usuário ou senha inválidos.')
  })

  it('429: a mensagem do backend', () => {
    const msg = 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
    expect(mensagemDeLogin(429, msg)).toBe(msg)
  })

  it('503: a mensagem do backend', () => {
    const msg = 'Serviço de autenticação indisponível. Tente novamente em instantes.'
    expect(mensagemDeLogin(503, msg)).toBe(msg)
  })

  it('outro status sem corpo: "Falha ao entrar."', () => {
    expect(mensagemDeLogin(500)).toBe('Falha ao entrar.')
  })
})

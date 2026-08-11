/**
 * Tela pública de recuperação de senha.
 *
 * O que estes testes fixam é o **anti-enumeração**: a resposta visível é idêntica exista ou
 * não o e-mail. Um "e-mail não cadastrado" aqui entrega a lista de funcionários da Columbia
 * a qualquer pessoa na internet, um e-mail por vez.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const resetPasswordForEmail = jest.fn()
jest.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({ auth: { resetPasswordForEmail } }),
}))

const toastError = jest.fn()
jest.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }))

import ForgotPasswordPage from '@/app/auth/forgot-password/page'

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    resetPasswordForEmail.mockReset()
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    toastError.mockReset()
  })

  const submit = async (email: string) => {
    render(<ForgotPasswordPage />)
    await userEvent.type(screen.getByTestId('forgot-password-email'), email)
    await userEvent.click(screen.getByTestId('forgot-password-submit'))
  }

  it('confirma o envio com uma mensagem que não revela se o e-mail existe', async () => {
    await submit('existe@kavex.com')
    const aviso = await screen.findByTestId('forgot-password-sent')
    expect(aviso).toHaveTextContent(/se este e-mail estiver cadastrado/i)
    expect(resetPasswordForEmail).toHaveBeenCalledTimes(1)
  })

  it('ANTI-ENUMERAÇÃO: falha do provedor NÃO muda a mensagem visível', async () => {
    // Se o erro aparecesse na tela, o próprio erro viraria o oráculo que esta regra existe
    // para fechar. O diagnóstico vai para o toast, não para a resposta ao formulário.
    resetPasswordForEmail.mockRejectedValue(new Error('user not found'))

    await submit('fantasma@kavex.com')

    const aviso = await screen.findByTestId('forgot-password-sent')
    expect(aviso).toHaveTextContent(/se este e-mail estiver cadastrado/i)
    expect(screen.queryByText(/não cadastrado/i)).not.toBeInTheDocument()
  })

  it('manda o usuário de volta para /auth/reset-password no link do e-mail', async () => {
    await submit('a@kavex.com')
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled())
    const [, options] = resetPasswordForEmail.mock.calls[0]
    expect(options.redirectTo).toContain('/auth/reset-password')
  })

  it('tem link de volta para o login e data-testid em todo elemento interativo', async () => {
    render(<ForgotPasswordPage />)
    expect(screen.getByTestId('forgot-password-back')).toHaveAttribute('href', '/login')
    expect(screen.getByTestId('forgot-password-email')).toBeInTheDocument()
    expect(screen.getByTestId('forgot-password-submit')).toBeInTheDocument()
  })
})

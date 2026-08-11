/**
 * O modal bloqueante de sessão expirada.
 *
 * ## O papel dele MUDOU no cutover (ADR-0030), e o teste reflete isso
 *
 * Antes ele era o fluxo NORMAL: o JWT de 12 h expirava e o modal aparecia (agendado por um
 * `setTimeout` sobre o `exp`). Agora a sessão tem refresh automático, então este modal virou
 * **fallback de um refresh que realmente falhou** — o componente foi PRESERVADO justamente
 * porque esse caso continua existindo, mas deixou de ser o caminho comum.
 *
 * O botão continua fazendo o mesmo: sair, limpar a flag e redirecionar com `returnTo`. A
 * diferença é que `signOut` virou **async** (revoga no provedor), então as asserções de ordem
 * precisam AGUARDAR — antes elas rodavam síncronas depois de um único clique.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const replaceMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/permutas',
}))

const useAuthMock = jest.fn()
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => useAuthMock(),
}))

import { SessionExpiredModal } from '@/components/auth/SessionExpiredModal'

describe('SessionExpiredModal', () => {
  const signOut = jest.fn().mockResolvedValue(undefined)
  const clearSessionExpired = jest.fn()
  // Fixed local instant → formatted as dd/MM HH:mm by date-fns.
  const expiredAt = new Date(2026, 5, 29, 14, 30).getTime()

  beforeEach(() => {
    replaceMock.mockReset()
    signOut.mockReset()
    signOut.mockResolvedValue(undefined)
    clearSessionExpired.mockReset()
    useAuthMock.mockReset()
  })

  it('renders nothing while the session is valid', () => {
    useAuthMock.mockReturnValue({
      sessionExpired: false,
      sessionExpiredAt: null,
      signOut,
      clearSessionExpired,
    })
    render(<SessionExpiredModal />)
    expect(screen.queryByTestId('session-expired-modal')).not.toBeInTheDocument()
  })

  it('shows the expiry time and that nothing after it was saved', () => {
    useAuthMock.mockReturnValue({
      sessionExpired: true,
      sessionExpiredAt: expiredAt,
      signOut,
      clearSessionExpired,
    })
    render(<SessionExpiredModal />)
    const modal = screen.getByTestId('session-expired-modal')
    expect(modal).toHaveTextContent('Sua sessão expirou')
    expect(modal).toHaveTextContent('29/06 14:30')
    expect(modal).toHaveTextContent('Nada feito após esse horário foi salvo')
  })

  it('relogin button signs out, clears the flag and redirects with returnTo', async () => {
    useAuthMock.mockReturnValue({
      sessionExpired: true,
      sessionExpiredAt: expiredAt,
      signOut,
      clearSessionExpired,
    })
    render(<SessionExpiredModal />)
    await userEvent.click(screen.getByTestId('session-expired-relogin'))

    expect(signOut).toHaveBeenCalledTimes(1)
    // `waitFor` porque o redirect agora acontece DEPOIS de a revogação resolver.
    await waitFor(() => expect(clearSessionExpired).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith('/login?returnTo=%2Fpermutas'),
    )
  })

  it('REVOGA no provedor ANTES de redirecionar — um logout que não desloga é pior que nenhum', async () => {
    // Se o redirect acontecesse antes, o refresh token continuaria vivo do lado do provedor:
    // a UI diria "você saiu" e a sessão seguiria renovável.
    const order: string[] = []
    let resolveSignOut: (() => void) | undefined
    signOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          order.push('signOut')
          resolveSignOut = () => resolve()
        }),
    )
    replaceMock.mockImplementation(() => order.push('redirect'))

    useAuthMock.mockReturnValue({
      sessionExpired: true,
      sessionExpiredAt: expiredAt,
      signOut,
      clearSessionExpired,
    })
    render(<SessionExpiredModal />)
    await userEvent.click(screen.getByTestId('session-expired-relogin'))

    expect(order).toEqual(['signOut'])
    resolveSignOut?.()
    await waitFor(() => expect(order).toEqual(['signOut', 'redirect']))
  })
})

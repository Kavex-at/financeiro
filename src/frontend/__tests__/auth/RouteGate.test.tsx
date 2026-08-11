/**
 * Tests that RouteGate leaves the public route (/login) ungated and wraps
 * every other route in the AuthGuard.
 */
import { render, screen } from '@testing-library/react'

const pathnameMock = jest.fn()
jest.mock('next/navigation', () => ({
  usePathname: () => pathnameMock(),
}))

jest.mock('@/components/auth/AuthGuard', () => ({
  AuthGuard: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auth-guard">{children}</div>
  ),
}))

import { RouteGate } from '@/components/auth/RouteGate'

describe('RouteGate', () => {
  beforeEach(() => pathnameMock.mockReset())

  it('does not gate the /login route', () => {
    pathnameMock.mockReturnValue('/login')
    render(
      <RouteGate>
        <div>page</div>
      </RouteGate>,
    )
    expect(screen.queryByTestId('auth-guard')).not.toBeInTheDocument()
    expect(screen.getByText('page')).toBeInTheDocument()
  })

  it('gates a protected route through the AuthGuard', () => {
    pathnameMock.mockReturnValue('/')
    render(
      <RouteGate>
        <div>page</div>
      </RouteGate>,
    )
    expect(screen.getByTestId('auth-guard')).toBeInTheDocument()
    expect(screen.getByText('page')).toBeInTheDocument()
  })

  it('gates the root route', () => {
    pathnameMock.mockReturnValue('/')
    render(
      <RouteGate>
        <div>page</div>
      </RouteGate>,
    )
    expect(screen.getByTestId('auth-guard')).toBeInTheDocument()
  })

  // ── /auth/* (ADR-0030) ──────────────────────────────────────────────────────────────
  it.each(['/auth', '/auth/forgot-password', '/auth/reset-password'])(
    'does not gate %s — a recuperação de senha precisa ser alcançável SEM sessão',
    (pathname) => {
      // Sem esta entrada em PUBLIC_ROUTES as telas novas nascem gateadas, e quem esqueceu a
      // senha entra em loop: /auth/forgot-password → /login → "esqueci minha senha" →
      // /auth/forgot-password. Nenhum erro é produzido — só um ciclo.
      pathnameMock.mockReturnValue(pathname)
      render(
        <RouteGate>
          <div>page</div>
        </RouteGate>,
      )
      expect(screen.queryByTestId('auth-guard')).not.toBeInTheDocument()
      expect(screen.getByText('page')).toBeInTheDocument()
    },
  )

  it('uma rota que apenas COMEÇA com o mesmo texto continua gateada', () => {
    // `/authorized` não é `/auth`. O match é por segmento, não por prefixo de string.
    pathnameMock.mockReturnValue('/authorized')
    render(
      <RouteGate>
        <div>page</div>
      </RouteGate>,
    )
    expect(screen.getByTestId('auth-guard')).toBeInTheDocument()
  })
})

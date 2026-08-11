/**
 * REGRESSÃO NOMEADA (§D3) — a UI de admin não pode sumir para os admins no cutover.
 *
 * ## O bug que este arquivo existe para impedir
 *
 * `useIsAdmin()` lia o claim `role` do JWT (`decodeJwtRole`, sem verificar assinatura). O
 * token do GoTrue traz **`role: 'authenticated'` para todo mundo** — é o role do Postgres,
 * não um papel de negócio. No dia do cutover, portanto, `useIsAdmin()` passaria a retornar
 * `false` para **todos**, e a tela `/usuarios` e o card de admin da home **desapareceriam
 * para os próprios administradores**.
 *
 * O que torna isso perigoso não é o tamanho: é o **silêncio**. Não há erro, não há log, o
 * backend continua autorizando corretamente — só a UI some. É o espelho exato, no frontend,
 * do problema que a ADR-0030 §3(4) resolve no backend, e por isso a solução é a mesma: **o
 * papel vem do banco**, via `GET /me`.
 */
import { render, screen, waitFor } from '@testing-library/react'

const getSession = jest.fn()
const onAuthStateChange = jest.fn(() => ({
  data: { subscription: { unsubscribe: jest.fn() } },
}))

jest.mock('@/lib/supabase/client', () => ({
  getSupabaseBrowserClient: () => ({
    auth: { getSession, onAuthStateChange, signInWithPassword: jest.fn(), signOut: jest.fn() },
  }),
}))

const fetchMe = jest.fn()
const fetchConexosStatus = jest.fn()
jest.mock('@/lib/usuarios', () => ({
  fetchMe: () => fetchMe(),
  fetchConexosStatus: () => fetchConexosStatus(),
}))

import { AuthProvider, useIsAdmin, useRole } from '@/lib/auth/AuthProvider'

function Probe() {
  const role = useRole()
  const isAdmin = useIsAdmin()
  return (
    <div>
      <span data-testid="role">{role ?? 'null'}</span>
      <span data-testid="is-admin">{String(isAdmin)}</span>
    </div>
  )
}

const renderWithProvider = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

describe('useIsAdmin — o papel vem do BANCO, nunca do token', () => {
  beforeEach(() => {
    getSession.mockReset()
    onAuthStateChange.mockClear()
    fetchMe.mockReset()
    fetchConexosStatus.mockReset()
    fetchConexosStatus.mockResolvedValue('ausente')
  })

  it('token com role "authenticated" + GET /me role "admin" ⇒ useIsAdmin() é TRUE', async () => {
    // Se este teste ficar vermelho, a tela /usuarios e o card de admin sumiram — e nada mais
    // no sistema vai avisar.
    getSession.mockResolvedValue({
      data: { session: { access_token: 'jwt-com-role-authenticated' } },
    })
    fetchMe.mockResolvedValue({ username: 'simone@kavex.com', role: 'admin' })

    renderWithProvider()

    await waitFor(() => expect(screen.getByTestId('is-admin')).toHaveTextContent('true'))
    expect(screen.getByTestId('role')).toHaveTextContent('admin')
  })

  it('GET /me devolvendo "operador" ⇒ useIsAdmin() é FALSE', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    fetchMe.mockResolvedValue({ username: 'op@kavex.com', role: 'operador' })

    renderWithProvider()

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('operador'))
    expect(screen.getByTestId('is-admin')).toHaveTextContent('false')
  })

  it('403 em GET /me (sem linha em app_user / inativo) ⇒ papel nulo, sem derrubar a sessão', async () => {
    // 403 não é sessão expirada: o usuário está autenticado e sem autorização. Esconder a UI
    // de admin é o comportamento correto; deslogá-lo não seria.
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    fetchMe.mockRejectedValue(new Error('forbidden'))

    renderWithProvider()

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('null'))
    expect(screen.getByTestId('is-admin')).toHaveTextContent('false')
  })

  it('sem sessão, GET /me nem é chamado', async () => {
    getSession.mockResolvedValue({ data: { session: null } })

    renderWithProvider()

    await waitFor(() => expect(getSession).toHaveBeenCalled())
    expect(fetchMe).not.toHaveBeenCalled()
    expect(screen.getByTestId('is-admin')).toHaveTextContent('false')
  })

  it('assina onAuthStateChange — o setTimeout proativo de expiração morreu', async () => {
    // Com auto-refresh ligado, agendar o modal de "sessão expirada" para o `exp` do token o
    // dispararia em cima de uma sessão perfeitamente válida.
    getSession.mockResolvedValue({ data: { session: { access_token: 'jwt' } } })
    fetchMe.mockResolvedValue({ username: 'a@kavex.com', role: 'operador' })

    renderWithProvider()

    await waitFor(() => expect(onAuthStateChange).toHaveBeenCalledTimes(1))
  })
})

/**
 * `AuthProvider` com a sessão do Supabase Auth (ADR-0056): guarda `refreshToken`/`expiresAt`,
 * renova ~5 min antes do `exp` sem nada visível, só abre o modal quando a sessão não se renova,
 * sincroniza abas pelo evento `storage` e "Sair" chama `/auth/logout` em melhor esforço.
 * Resposta sem `refreshToken` (backend antigo, modo local) = comportamento de antes.
 */
import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'

const refreshSessionMock = jest.fn()
const renovarSessaoMock = jest.fn()
jest.mock('@/lib/auth/session-refresh', () => {
  const real = jest.requireActual('@/lib/auth/session-refresh')
  return {
    ...real,
    refreshSession: (...a: unknown[]) => refreshSessionMock(...a),
    renovarSessao: (...a: unknown[]) => renovarSessaoMock(...a),
  }
})
jest.mock('@/lib/usuarios', () => ({ fetchConexosStatus: jest.fn().mockResolvedValue('ok') }))

import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider'
import {
  EXPIRES_AT_STORAGE_KEY,
  REFRESH_TOKEN_STORAGE_KEY,
  TOKEN_STORAGE_KEY,
  USERNAME_STORAGE_KEY,
} from '@/lib/auth/token'

const b64url = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (exp: number): string => `${b64url({ alg: 'ES256' })}.${b64url({ exp })}.sig`

const probe: { ctx?: ReturnType<typeof useAuth> } = {}
function Probe() {
  const auth = useAuth()
  useEffect(() => {
    probe.ctx = auth
  })
  return (
    <div>
      <span data-testid="token">{auth.token ?? ''}</span>
      <span data-testid="expirada">{String(auth.sessionExpired)}</span>
    </div>
  )
}
const ctx = {
  signIn: (u: string, p: string) => probe.ctx?.signIn(u, p) ?? Promise.resolve(),
  signOut: () => probe.ctx?.signOut(),
}
const montar = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

const AGORA = 1_900_000_000_000 // ms
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

describe('AuthProvider — sessão renovável', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(AGORA)
    localStorage.clear()
    fetchMock.mockReset()
    refreshSessionMock.mockReset()
    renovarSessaoMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('login no modo supabase guarda token, refreshToken, expiresAt e username', async () => {
    const exp = AGORA / 1000 + 3600
    fetchMock.mockResolvedValue(
      ok({ token: jwt(exp), refreshToken: 'rt', expiresAt: exp, username: 'fulano', role: 'admin' }),
    )
    montar()
    await act(async () => ctx.signIn('fulano', 'segredo12'))
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe(jwt(exp))
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('rt')
    expect(localStorage.getItem(EXPIRES_AT_STORAGE_KEY)).toBe(String(exp))
    expect(localStorage.getItem(USERNAME_STORAGE_KEY)).toBe('fulano')
  })

  it('corpo ANTIGO (sem refreshToken): nenhuma renovação, modal no exp, como antes', async () => {
    const exp = AGORA / 1000 + 600
    fetchMock.mockResolvedValue(ok({ token: jwt(exp), username: 'admin', role: 'admin' }))
    montar()
    await act(async () => ctx.signIn('admin', 'segredo12'))
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()

    await act(async () => {
      jest.advanceTimersByTime(600_000)
    })
    expect(refreshSessionMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('expirada')).toHaveTextContent('true')
  })

  it('renova ~5 min antes do exp, sem modal; falha da proativa NÃO abre o modal', async () => {
    const exp = AGORA / 1000 + 3600
    localStorage.setItem(TOKEN_STORAGE_KEY, jwt(exp))
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'rt')
    localStorage.setItem(EXPIRES_AT_STORAGE_KEY, String(exp))
    localStorage.setItem(USERNAME_STORAGE_KEY, 'fulano')
    refreshSessionMock.mockResolvedValue(null)
    montar()

    await act(async () => {
      jest.advanceTimersByTime(3600_000 - 5 * 60_000 - 1)
    })
    expect(refreshSessionMock).not.toHaveBeenCalled()
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('expirada')).toHaveTextContent('false')

    // No exp de fato, tenta de novo; RECUSADA, aí sim o modal.
    renovarSessaoMock.mockResolvedValue({ tipo: 'recusada' })
    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000)
    })
    expect(renovarSessaoMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('expirada')).toHaveTextContent('true')
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBeNull()
  })

  it('no exp com o serviço INDISPONÍVEL: sem modal, tenta de novo em 15 s, 30 s, 60 s; modal só na recusa (availability-1)', async () => {
    const exp = AGORA / 1000 + 600
    localStorage.setItem(TOKEN_STORAGE_KEY, jwt(exp))
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'rt')
    localStorage.setItem(EXPIRES_AT_STORAGE_KEY, String(exp))
    localStorage.setItem(USERNAME_STORAGE_KEY, 'fulano')
    refreshSessionMock.mockResolvedValue(null)
    renovarSessaoMock.mockResolvedValue({ tipo: 'indisponivel' })
    montar()

    await act(async () => {
      jest.advanceTimersByTime(600_000) // o exp
    })
    expect(renovarSessaoMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('expirada')).toHaveTextContent('false')

    await act(async () => {
      jest.advanceTimersByTime(15_000 - 1)
    })
    expect(renovarSessaoMock).toHaveBeenCalledTimes(1)
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(renovarSessaoMock).toHaveBeenCalledTimes(2)
    await act(async () => {
      jest.advanceTimersByTime(30_000)
    })
    expect(renovarSessaoMock).toHaveBeenCalledTimes(3)
    await act(async () => {
      jest.advanceTimersByTime(60_000)
    })
    expect(renovarSessaoMock).toHaveBeenCalledTimes(4)
    await act(async () => {
      jest.advanceTimersByTime(60_000) // teto: continua a cada 60 s
    })
    expect(renovarSessaoMock).toHaveBeenCalledTimes(5)
    expect(screen.getByTestId('expirada')).toHaveTextContent('false')
    expect(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe('rt')

    renovarSessaoMock.mockResolvedValue({ tipo: 'recusada' })
    await act(async () => {
      jest.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('expirada')).toHaveTextContent('true')
  })

  it('evento storage: token renovado por outra aba é adotado; logout em outra aba desloga esta', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'velho')
    montar()
    await act(async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, 'novo-da-outra-aba')
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY }))
    })
    expect(screen.getByTestId('token')).toHaveTextContent('novo-da-outra-aba')

    await act(async () => {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      window.dispatchEvent(new StorageEvent('storage', { key: TOKEN_STORAGE_KEY }))
    })
    expect(screen.getByTestId('token')).toHaveTextContent('')
  })

  it('"Sair": POST /auth/logout com o token (melhor esforço) e limpa os quatro campos; rede fora não impede', async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, 'tok')
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, 'rt')
    localStorage.setItem(EXPIRES_AT_STORAGE_KEY, '1')
    localStorage.setItem(USERNAME_STORAGE_KEY, 'fulano')
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    montar()
    await act(async () => ctx.signOut())

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/auth\/logout$/)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
    for (const k of [
      TOKEN_STORAGE_KEY,
      REFRESH_TOKEN_STORAGE_KEY,
      EXPIRES_AT_STORAGE_KEY,
      USERNAME_STORAGE_KEY,
    ]) {
      expect(localStorage.getItem(k)).toBeNull()
    }
    expect(screen.getByTestId('token')).toHaveTextContent('')
  })
})

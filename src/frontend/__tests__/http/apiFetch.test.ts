/**
 * `apiFetch` centraliza 401 **e 403** para toda a camada de API.
 *
 * A separação é o ponto: 401 significa que falta IDENTIDADE (dispara o barramento de sessão
 * expirada); 403 significa identidade legítima com AUTORIZAÇÃO negada — e depois do cutover
 * (ADR-0030) ele virou um caminho COMUM, não uma exceção rara.
 */
const emitMock = jest.fn()
jest.mock('@/lib/auth/session-events', () => ({
  emitSessionExpired: () => emitMock(),
}))

import {
  apiFetch,
  ForbiddenError,
  isForbiddenError,
  isSessionExpiredError,
  SessionExpiredError,
} from '@/lib/http'

describe('apiFetch', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    emitMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('throws SessionExpiredError and emits on 401', async () => {
    fetchMock.mockResolvedValue({ status: 401 })
    await expect(apiFetch('/x')).rejects.toBeInstanceOf(SessionExpiredError)
    expect(emitMock).toHaveBeenCalledTimes(1)
  })

  it('returns the response unchanged on 200 (no emit)', async () => {
    const res = { status: 200, ok: true }
    fetchMock.mockResolvedValue(res)
    await expect(apiFetch('/x')).resolves.toBe(res)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('returns 409 verbatim so callers can still special-case it (no emit)', async () => {
    const res = { status: 409, ok: false }
    fetchMock.mockResolvedValue(res)
    await expect(apiFetch('/x')).resolves.toBe(res)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('isSessionExpiredError narrows only its own error type', () => {
    expect(isSessionExpiredError(new SessionExpiredError())).toBe(true)
    expect(isSessionExpiredError(new Error('boom'))).toBe(false)
    expect(isSessionExpiredError(null)).toBe(false)
  })

  // ── 403 (ADR-0030) ─────────────────────────────────────────────────────────────────────
  it('403 NÃO emite sessionExpired e NÃO lança SessionExpiredError', async () => {
    // Este é o teste que impede o loop de refresh. A sessão está VIVA e o provedor está
    // respondendo corretamente; tratar 403 como expiração mandaria o app renovar em círculos
    // e esconderia do diagnóstico que o problema é de autorização.
    fetchMock.mockResolvedValue({
      status: 403,
      clone: () => ({ json: async () => ({ error: 'Seu acesso foi desativado.' }) }),
    })

    const err = await apiFetch('/x').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ForbiddenError)
    expect(isSessionExpiredError(err)).toBe(false)
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('403 usa a mensagem PT-BR que o backend mandou', async () => {
    fetchMock.mockResolvedValue({
      status: 403,
      clone: () => ({ json: async () => ({ error: 'Seu acesso foi desativado.' }) }),
    })
    await expect(apiFetch('/x')).rejects.toThrow('Seu acesso foi desativado.')
  })

  it('403 sem corpo JSON cai numa mensagem padrão PT-BR', async () => {
    fetchMock.mockResolvedValue({
      status: 403,
      clone: () => ({
        json: async () => {
          throw new Error('not json')
        },
      }),
    })
    const err = (await apiFetch('/x').catch((e: unknown) => e)) as ForbiddenError
    expect(err.message).toMatch(/autoriza/i)
  })

  it('isForbiddenError narrows only its own error type', () => {
    expect(isForbiddenError(new ForbiddenError())).toBe(true)
    expect(isForbiddenError(new SessionExpiredError())).toBe(false)
    expect(isForbiddenError(null)).toBe(false)
  })
})

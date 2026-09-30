/**
 * `apiFetch` em 401 (ADR-0056): UMA renovação e UM novo envio com o `Authorization` trocado. Se a
 * renovação é RECUSADA ou o reenvio volta 401, cai no comportamento de antes (modal + erro). Se é
 * só INDISPONÍVEL (503/429/rede), erro sem modal (Regis `availability-1`).
 */
const refreshSessionMock = jest.fn()
jest.mock('@/lib/auth/session-refresh', () => ({
  renovarSessao: (...args: unknown[]) => refreshSessionMock(...args),
}))
const emitMock = jest.fn()
jest.mock('@/lib/auth/session-events', () => ({
  emitSessionExpired: () => emitMock(),
}))

import { AuthUnavailableError, apiFetch, SessionExpiredError } from '@/lib/http'

const resposta = (status: number) => ({ status, ok: status < 400 }) as Response

describe('apiFetch — renovação em 401', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    refreshSessionMock.mockReset()
    emitMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('2xx: devolve como está, sem renovar', async () => {
    fetchMock.mockResolvedValue(resposta(200))
    expect((await apiFetch('/x')).status).toBe(200)
    expect(refreshSessionMock).not.toHaveBeenCalled()
  })

  it('401 → renova UMA vez e reenvia UMA vez com o Authorization novo (substituindo o antigo)', async () => {
    fetchMock.mockResolvedValueOnce(resposta(401)).mockResolvedValueOnce(resposta(200))
    refreshSessionMock.mockResolvedValue({ tipo: 'renovada', token: 'token-novo' })

    const res = await apiFetch('/x', {
      method: 'POST',
      headers: { Authorization: 'Bearer token-velho', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    })

    expect(res.status).toBe(200)
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(refreshSessionMock).toHaveBeenCalledWith('token-velho')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [, init] = fetchMock.mock.calls[1]
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer token-novo')
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(init.body).toBe('{"a":1}')
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('renovação RECUSADA: modal + SessionExpiredError (comportamento de hoje)', async () => {
    fetchMock.mockResolvedValue(resposta(401))
    refreshSessionMock.mockResolvedValue({ tipo: 'recusada' })
    await expect(apiFetch('/x', { headers: { Authorization: 'Bearer t' } })).rejects.toBeInstanceOf(
      SessionExpiredError,
    )
    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renovação só INDISPONÍVEL (503/429/rede): AuthUnavailableError, SEM modal e sem reenvio', async () => {
    fetchMock.mockResolvedValue(resposta(401))
    refreshSessionMock.mockResolvedValue({ tipo: 'indisponivel' })
    const erro = await apiFetch('/x', { headers: { Authorization: 'Bearer t' } }).catch((e) => e)
    expect(erro).toBeInstanceOf(AuthUnavailableError)
    expect((erro as Error).message).toMatch(/instável/)
    expect(emitMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('segundo 401 depois de renovar: modal + erro, sem nova renovação', async () => {
    fetchMock.mockResolvedValue(resposta(401))
    refreshSessionMock.mockResolvedValue({ tipo: 'renovada', token: 'token-novo' })
    await expect(apiFetch('/x', { headers: { Authorization: 'Bearer t' } })).rejects.toBeInstanceOf(
      SessionExpiredError,
    )
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(emitMock).toHaveBeenCalledTimes(1)
  })

  it('três requisições simultâneas com 401 compartilham a renovação (single-flight no refreshSession)', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      new Headers(init?.headers).get('Authorization') === 'Bearer novo'
        ? resposta(200)
        : resposta(401),
    )
    let chamadas = 0
    let promessa: Promise<unknown> | null = null
    refreshSessionMock.mockImplementation(() => {
      if (!promessa) {
        chamadas++
        promessa = new Promise((r) => setTimeout(() => r({ tipo: 'renovada', token: 'novo' }), 5))
      }
      return promessa
    })
    const h = { headers: { Authorization: 'Bearer velho' } }
    const res = await Promise.all([apiFetch('/a', h), apiFetch('/b', h), apiFetch('/c', h)])
    expect(res.map((r) => r.status)).toEqual([200, 200, 200])
    expect(chamadas).toBe(1)
  })
})

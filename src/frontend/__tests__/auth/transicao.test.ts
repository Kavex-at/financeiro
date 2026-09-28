/**
 * `fetchTransicaoEmail` — o banner de transição para e-mail na tela de login (ADR-0051).
 *
 * A rota é PÚBLICA: a chamada vai sem token e não pode abrir o modal de sessão expirada. E falha
 * FECHADA: qualquer coisa que não seja `{ ativo: boolean }` em 200 vira `false` — inclusive o 404
 * de um backend antigo durante a janela entre os deploys do front e do back.
 */

const withAuthHeaders = jest.fn()
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders }))

const emitSessionExpired = jest.fn()
jest.mock('@/lib/auth/session-events', () => ({ emitSessionExpired }))

describe('fetchTransicaoEmail', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    withAuthHeaders.mockReset()
    emitSessionExpired.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  const responde = (status: number, json: () => Promise<unknown>) =>
    fetchMock.mockResolvedValue({ ok: status >= 200 && status < 300, status, json })

  it('ativo=true: devolve true, chamando GET /auth/transicao SEM header de auth', async () => {
    responde(200, async () => ({ ativo: true }))
    const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')

    expect(await fetchTransicaoEmail()).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/auth\/transicao$/)
    expect(init?.headers?.Authorization).toBeUndefined()
    expect(withAuthHeaders).not.toHaveBeenCalled()
  })

  it('ativo=false: devolve false', async () => {
    responde(200, async () => ({ ativo: false }))
    const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')
    expect(await fetchTransicaoEmail()).toBe(false)
  })

  it('erro de rede: false', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')
    expect(await fetchTransicaoEmail()).toBe(false)
  })

  it('404 de um backend antigo durante a janela de deploy: false', async () => {
    responde(404, async () => ({ error: 'Not found' }))
    const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')
    expect(await fetchTransicaoEmail()).toBe(false)
  })

  it('500: false', async () => {
    responde(500, async () => ({ error: 'erro' }))
    const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')
    expect(await fetchTransicaoEmail()).toBe(false)
  })

  it('401: false, sem abrir o modal de sessão expirada', async () => {
    responde(401, async () => ({ error: 'Not authenticated' }))
    const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')
    expect(await fetchTransicaoEmail()).toBe(false)
    expect(emitSessionExpired).not.toHaveBeenCalled()
  })

  it('JSON inválido: false', async () => {
    responde(200, async () => {
      throw new SyntaxError('Unexpected token')
    })
    const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')
    expect(await fetchTransicaoEmail()).toBe(false)
  })

  it.each([[{ ativo: 'true' }], [{ ativo: 1 }], [{}], [null], [[true]]])(
    'ativo que não é boolean (%j): false',
    async (corpo) => {
      responde(200, async () => corpo)
      const { fetchTransicaoEmail } = await import('@/lib/auth/transicao')
      expect(await fetchTransicaoEmail()).toBe(false)
    },
  )
})

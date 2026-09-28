/**
 * `lib/usuarios.ts` — e-mail de login (ADR-0051): criar usuário envia `email`, e
 * `definirEmail` faz o PATCH e preserva a mensagem e o status do backend (409 inclusive).
 */

jest.mock('@/lib/auth/token', () => ({
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

describe('lib/usuarios — e-mail de login', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('criarUsuario envia email (e não mais username)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 9 }) })
    const { criarUsuario } = await import('@/lib/usuarios')

    await criarUsuario({ email: 'nova@columbiabr.com', password: 'segredo12', role: 'operador' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/usuarios$/)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ email: 'nova@columbiabr.com' })
    expect(body).not.toHaveProperty('username')
  })

  it('definirEmail faz PATCH /usuarios/:id/email com o e-mail e o token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 7, email: 'maria@columbiabr.com' }),
    })
    const { definirEmail } = await import('@/lib/usuarios')

    await definirEmail(7, 'maria@columbiabr.com')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/usuarios\/7\/email$/)
    expect(init.method).toBe('PATCH')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({ email: 'maria@columbiabr.com' })
  })

  it.each([
    [409, 'Este e-mail já identifica outro usuário.'],
    [400, 'E-mail inválido.'],
    [404, 'Usuário não encontrado.'],
  ])('definirEmail fora de 2xx (%i) lança UsuariosApiError com a mensagem e o status', async (status, error) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error }) })
    const { definirEmail, UsuariosApiError } = await import('@/lib/usuarios')

    const erro = await definirEmail(7, 'x@columbiabr.com').catch((e) => e)

    expect(erro).toBeInstanceOf(UsuariosApiError)
    expect(erro.message).toBe(error)
    expect(erro.status).toBe(status)
  })
})

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

  it('criarUsuario envia email e papelId (e não mais username nem role)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 9 }) })
    const { criarUsuario } = await import('@/lib/usuarios')

    await criarUsuario({ email: 'nova@columbiabr.com', password: 'segredo12', papelId: 2 })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/usuarios$/)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ email: 'nova@columbiabr.com', papelId: 2 })
    expect(body).not.toHaveProperty('username')
    expect(body).not.toHaveProperty('role')
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

describe('lib/usuarios — papel e exceções (ADR-0053)', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('listarPapeis: GET /usuarios/papeis devolve papéis e catálogo', async () => {
    const corpo = {
      papeis: [{ id: 1, nome: 'Administrador', permissoes: ['metricas:ver'] }],
      catalogo: ['metricas:ver'],
    }
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => corpo })
    const { listarPapeis } = await import('@/lib/usuarios')

    expect(await listarPapeis()).toEqual(corpo)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/usuarios\/papeis$/)
  })

  it('atribuirPapel: PATCH /usuarios/:id/papel com { papelId }', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 7, papel: { id: 2, nome: 'Consulta' } }),
    })
    const { atribuirPapel } = await import('@/lib/usuarios')

    const out = await atribuirPapel(7, 2)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/usuarios\/7\/papel$/)
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ papelId: 2 })
    expect(out).toEqual({ id: 7, papel: { id: 2, nome: 'Consulta' } })
  })

  it('definirExcecoes: PUT /usuarios/:id/permissoes com { excecoes }', async () => {
    const excecoes = [{ permissao: 'sispag:executar', efeito: 'revogar' }] as const
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 7, excecoes, permissoesEfetivas: ['sispag:ver'] }),
    })
    const { definirExcecoes } = await import('@/lib/usuarios')

    const out = await definirExcecoes(7, [...excecoes])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/usuarios\/7\/permissoes$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ excecoes })
    expect(out.permissoesEfetivas).toEqual(['sispag:ver'])
  })

  it.each([
    ['atribuirPapel', 409, 'Você não pode remover a sua própria permissão de gerenciar usuários.'],
    ['definirExcecoes', 409, 'Não é possível remover o último usuário com permissão de gerenciar usuários.'],
    ['listarPapeis', 403, 'Você não tem permissão para esta ação.'],
  ])('%s fora de 2xx (%i): UsuariosApiError com a mensagem e o status do backend', async (fn, status, error) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error }) })
    const lib = await import('@/lib/usuarios')
    const chamar =
      fn === 'atribuirPapel'
        ? () => lib.atribuirPapel(7, 2)
        : fn === 'definirExcecoes'
          ? () => lib.definirExcecoes(7, [])
          : () => lib.listarPapeis()

    const erro = await chamar().catch((e) => e)

    expect(erro).toBeInstanceOf(lib.UsuariosApiError)
    expect(erro.message).toBe(error)
    expect(erro.status).toBe(status)
  })
})

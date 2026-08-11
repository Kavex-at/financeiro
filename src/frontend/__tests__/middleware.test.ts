/**
 * @jest-environment node
 */

/**
 * `middleware.ts` — a primeira proteção de rota SERVER-SIDE do app.
 *
 * Roda no ambiente **node**, não no jsdom padrão do pacote: `next/server` avalia
 * `Request`/`Response` da Fetch API já no import, e o jsdom não os expõe. Forçar polyfills no
 * jsdom para testar código que só roda no servidor testaria o polyfill, não o middleware.
 *
 * Antes desta feature não existia `middleware.ts`: toda a proteção era client-side e
 * pós-hidratação, então uma tela autenticada chegava a pintar antes do redirect. Aqui isso
 * é decidido antes de o HTML sair.
 */

const getUser = jest.fn()
const createServerClient = jest.fn(() => ({ auth: { getUser } }))

jest.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) => createServerClient(...(args as [])),
}))

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isAuthScreen, isPublicRoute, PUBLIC_ROUTES } from '@/lib/supabase/routes'

const ORIGINAL_ENV = process.env

/** `NextRequest` mínimo — só o que `updateSession` realmente toca. */
const buildRequest = (pathname: string) => {
  const url = new URL(`https://app.local${pathname}`)
  return {
    cookies: { getAll: () => [], set: jest.fn() },
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
  }
}

describe('lib/supabase/routes — a fonte ÚNICA das rotas públicas', () => {
  it('inclui /auth para que a recuperação de senha seja alcançável sem sessão', () => {
    // Duas listas de rotas públicas divergem em silêncio; por isso `middleware.ts` e
    // `RouteGate` leem a MESMA constante.
    expect(PUBLIC_ROUTES).toContain('/auth')
    expect(PUBLIC_ROUTES).toContain('/login')
  })

  it('isPublicRoute casa a rota e suas subrotas, mas não um prefixo textual', () => {
    expect(isPublicRoute('/auth')).toBe(true)
    expect(isPublicRoute('/auth/forgot-password')).toBe(true)
    expect(isPublicRoute('/login')).toBe(true)
    expect(isPublicRoute('/authorized')).toBe(false)
    expect(isPublicRoute('/permutas')).toBe(false)
  })

  it('as telas de AUTH são um subconjunto PRÓPRIO das públicas — /docs mantém o header', () => {
    // A distinção é deliberada: `/docs` é público, mas não é tela de entrada. Colapsar as
    // duas listas tiraria a navegação da documentação.
    expect(isAuthScreen('/login')).toBe(true)
    expect(isAuthScreen('/auth/reset-password')).toBe(true)
    expect(isAuthScreen('/docs')).toBe(false)
    expect(isPublicRoute('/docs')).toBe(true)
  })
})

describe('updateSession', () => {
  beforeEach(() => {
    jest.resetModules()
    getUser.mockReset()
    createServerClient.mockClear()
    process.env = {
      ...ORIGINAL_ENV,
      NEXT_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
    }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  it('renova a sessão a cada navegação — a chamada É o efeito, não a leitura', async () => {
    // Server Components não escrevem cookies. Sem este passo o refresh token rotaciona no
    // browser e o servidor segue lendo o cookie antigo: a sessão "expira" para o SSR
    // enquanto está viva no cliente.
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { updateSession } = await import('@/lib/supabase/middleware')

    await updateSession(buildRequest('/permutas') as never)

    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('sem sessão em rota protegida → redirect server-side para /login com returnTo', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { updateSession } = await import('@/lib/supabase/middleware')

    const res = await updateSession(buildRequest('/permutas') as never)

    expect(res.status).toBe(307)
    const location = new URL(res.headers.get('location') as string)
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('returnTo')).toBe('/permutas')
  })

  it('sem sessão em /auth/forgot-password NÃO redireciona (senão é loop)', async () => {
    // O sintoma dessa regressão não é um erro: é o usuário deslogado sendo mandado para
    // /login exatamente quando tenta alcançar a tela de recuperar a senha.
    getUser.mockResolvedValue({ data: { user: null } })
    const { updateSession } = await import('@/lib/supabase/middleware')

    const res = await updateSession(buildRequest('/auth/forgot-password') as never)

    expect(res.headers.get('location')).toBeNull()
  })

  it('com sessão em rota protegida, segue adiante', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { updateSession } = await import('@/lib/supabase/middleware')

    const res = await updateSession(buildRequest('/permutas') as never)

    expect(res.headers.get('location')).toBeNull()
  })

  it('usa getUser() (valida no provedor), NUNCA getSession() (confia no cookie)', async () => {
    // Num middleware que decide redirecionar, confiar num cookie que o próprio cliente pode
    // escrever é a diferença entre uma checagem e um teatro.
    const source = readFileSync(
      path.join(__dirname, '..', 'lib', 'supabase', 'middleware.ts'),
      'utf8',
    )
    expect(source).toContain('auth.getUser()')
    expect(source).not.toContain('auth.getSession()')
  })

  it('falha claramente quando as env vars públicas faltam', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = undefined
    const { updateSession } = await import('@/lib/supabase/middleware')
    await expect(updateSession(buildRequest('/permutas') as never)).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    )
  })
})

/**
 * ROLLBACK DA FASE 2 (ADR-0030 §6) — Regis-Review `cutover-rollback-broken`.
 *
 * A flag `NEXT_PUBLIC_AUTH_PROVIDER` tinha **zero leitores**: virá-la no painel da Vercel
 * não produzia erro, apenas nada. Aqui ela passa a decidir se o middleware roda.
 *
 * Não é otimização. A sessão legada é um token em `localStorage` — invisível para o servidor
 * **por construção**. Com a checagem ligada, o middleware redirecionaria **todo mundo** para
 * `/login`, inclusive quem acabou de logar, em loop; e `updateSession` estouraria em
 * `MissingSupabaseEnvError` justo quando o rollback foi acionado porque o Supabase é o
 * problema.
 */
describe('middleware sob NEXT_PUBLIC_AUTH_PROVIDER=legacy', () => {
    beforeEach(() => {
        jest.resetModules()
        getUser.mockReset()
        process.env = { ...ORIGINAL_ENV, NEXT_PUBLIC_AUTH_PROVIDER: 'legacy' }
    })

    afterAll(() => {
        process.env = ORIGINAL_ENV
    })

    it('sai do caminho: NÃO fala com o provedor e NÃO redireciona rota protegida', async () => {
        // Sem as env vars do Supabase no ambiente — é exatamente o cenário do rollback.
        const { middleware } = await import('@/middleware')

        const res = await middleware(buildRequest('/permutas') as never)

        expect(getUser).not.toHaveBeenCalled()
        expect(res.status).not.toBe(307)
        expect(res.headers.get('location')).toBeNull()
    })

    it('no modo padrão o middleware CONTINUA protegendo (a flag não afrouxa nada)', async () => {
        process.env = {
            ...ORIGINAL_ENV,
            NEXT_PUBLIC_SUPABASE_URL: 'https://ref.supabase.co',
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        }
        getUser.mockResolvedValue({ data: { user: null } })
        const { middleware } = await import('@/middleware')

        const res = await middleware(buildRequest('/permutas') as never)

        expect(getUser).toHaveBeenCalledTimes(1)
        expect(res.headers.get('location')).toContain('/login')
    })
})

describe('matcher do middleware', () => {
  it('exclui assets e _next/* — senão cada page load vira dezenas de chamadas ao provedor', async () => {
    const { config } = await import('@/middleware')
    // O Next ancora o matcher no caminho inteiro; reproduzir isso é o que torna o teste
    // fiel (sem as âncoras, o lookahead negativo casa em qualquer sufixo e tudo "passa").
    const pattern = new RegExp(`^${config.matcher[0]}$`)

    expect(pattern.test('/permutas')).toBe(true)
    expect(pattern.test('/_next/static/chunk.js')).toBe(false)
    expect(pattern.test('/favicon.ico')).toBe(false)
    expect(pattern.test('/logo.png')).toBe(false)
  })
})

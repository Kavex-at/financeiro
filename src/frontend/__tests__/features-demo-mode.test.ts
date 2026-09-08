/**
 * `NEXT_PUBLIC_DEMO_MODE` liga o fixture de demonstração no lugar do dado real.
 * Num sistema onde a analista decide baixa de adiantamento, isso é tão perigoso
 * quanto o `DEV_AUTH_BYPASS`: a tela fica plausível e falsa. Por isso o flag
 * segue a MESMA política de `assertAuthEnv()` — só vale em `NEXT_PUBLIC_ENV=local`,
 * e um build deployado com ele ligado ESTOURA em vez de subir.
 */

describe('lib/features — modo demonstração', () => {
  const envOriginal = process.env

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...envOriginal }
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    delete process.env.NEXT_PUBLIC_ENV
  })

  afterAll(() => {
    process.env = envOriginal
  })

  it('desligado por padrão, inclusive em local', async () => {
    process.env.NEXT_PUBLIC_ENV = 'local'
    const { isDemoMode } = await import('@/lib/features')

    expect(isDemoMode()).toBe(false)
  })

  it('só liga com a string exata "true"', async () => {
    process.env.NEXT_PUBLIC_ENV = 'local'
    process.env.NEXT_PUBLIC_DEMO_MODE = '1'
    const { isDemoMode } = await import('@/lib/features')

    expect(isDemoMode()).toBe(false)
  })

  it('liga em local quando explicitamente pedido', async () => {
    process.env.NEXT_PUBLIC_ENV = 'local'
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    const { isDemoMode } = await import('@/lib/features')

    expect(isDemoMode()).toBe(true)
  })

  it('assertDemoEnv estoura num build deployado', async () => {
    process.env.NEXT_PUBLIC_ENV = 'prd'
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    const { assertDemoEnv } = await import('@/lib/features')

    expect(() => assertDemoEnv()).toThrow(/NEXT_PUBLIC_DEMO_MODE.*"prd"/)
  })

  it('assertDemoEnv estoura com NEXT_PUBLIC_ENV ausente (fail-safe)', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    const { assertDemoEnv } = await import('@/lib/features')

    expect(() => assertDemoEnv()).toThrow(/must not be enabled/)
  })

  it('assertDemoEnv passa em local, e passa com o flag desligado', async () => {
    process.env.NEXT_PUBLIC_ENV = 'local'
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    const { assertDemoEnv } = await import('@/lib/features')
    expect(() => assertDemoEnv()).not.toThrow()

    jest.resetModules()
    process.env.NEXT_PUBLIC_ENV = 'prd'
    delete process.env.NEXT_PUBLIC_DEMO_MODE
    const mod = await import('@/lib/features')
    expect(() => mod.assertDemoEnv()).not.toThrow()
  })
})

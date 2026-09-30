/**
 * Verifies that `lib/api.ts` attaches the `Authorization: Bearer` header to
 * every backend request. Supabase is mocked via the token helper.
 */

jest.mock('@/lib/auth/token', () => ({
  ...jest.requireActual('@/lib/auth/token'),
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

describe('api.ts — Authorization header', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('fetchFiliais sends the bearer token', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ filiais: [], filCodDefault: null }),
    })
    const { fetchFiliais } = await import('@/lib/api')
    await fetchFiliais()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })
})

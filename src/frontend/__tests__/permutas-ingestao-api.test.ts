/**
 * Cobre as funções de ingestão manual de `lib/api.ts` (ADR-0006):
 * `fetchPermutaRuns` (trilha de auditoria) e `runIngestaoManual` (trigger +
 * mapeamento do 409 para `IngestaoEmAndamentoError`). O token é mockado.
 */

jest.mock('@/lib/auth/token', () => ({
  ...jest.requireActual('@/lib/auth/token'),
  withAuthHeaders: jest.fn(async (base: Record<string, string> = {}) => ({
    Authorization: 'Bearer test-token',
    ...base,
  })),
}))

describe('lib/api — ingestão manual', () => {
  const fetchMock = jest.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  it('fetchPermutaRuns returns the runs array and passes the limit', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [{ runId: 'r1', triggeredBy: 'cron', status: 'success' }] }),
    })
    const { fetchPermutaRuns } = await import('@/lib/api')

    const runs = await fetchPermutaRuns(5)

    expect(runs).toHaveLength(1)
    expect(runs[0].triggeredBy).toBe('cron')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/permutas/runs?limit=5')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' })
  })

  it('runIngestaoManual POSTs and returns the result on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'r2', status: 'success', totalAdiantamentos: 509 }),
    })
    const { runIngestaoManual } = await import('@/lib/api')

    const result = await runIngestaoManual()

    expect(result.runId).toBe('r2')
    expect(result.totalAdiantamentos).toBe(509)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/permutas/ingestao')
    expect(init.method).toBe('POST')
  })

  it('runIngestaoManual throws IngestaoEmAndamentoError on HTTP 409', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'INGESTION_IN_PROGRESS', message: 'já rodando' }),
    })
    const { runIngestaoManual, IngestaoEmAndamentoError } = await import('@/lib/api')

    await expect(runIngestaoManual()).rejects.toBeInstanceOf(IngestaoEmAndamentoError)
  })

  it('runIngestaoManual throws a generic Error on other HTTP failures', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal server error' }),
    })
    const { runIngestaoManual, IngestaoEmAndamentoError } = await import('@/lib/api')

    const error = await runIngestaoManual().catch((e) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(IngestaoEmAndamentoError)
  })
})

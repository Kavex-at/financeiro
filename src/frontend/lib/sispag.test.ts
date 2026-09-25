import {
  baixarRemessa,
  fetchBoletosDda,
  DebitDateFrozenError,
  DebitDateOutsideWindowError,
  fetchJanelaDataDebito,
  formatCivilDate,
  gerarRemessa,
  retirarDoLote,
} from '@/lib/sispag'

// `apiFetch` é o boundary HTTP — mockado para controlar os bytes que "chegam do backend".
jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))

import { apiFetch } from '@/lib/http'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const lerBytes = (blob: Blob): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })

describe('baixarRemessa', () => {
  it('entrega os bytes latin1 do .REM intactos (sem decodificar como UTF-8)', async () => {
    // "JOÃO ÇA" em latin1: Ã = 0xC3, Ç = 0xC7 — um byte cada. Decodificado como UTF-8,
    // cada um vira U+FFFD (3 bytes) e desloca as colunas fixas do CNAB 240.
    const bytes = new Uint8Array([0x4a, 0x4f, 0xc3, 0x4f, 0x20, 0xc7, 0x41, 0x0d, 0x0a])
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="PG220901.REM"' }),
      blob: async () => new Blob([bytes], { type: 'text/plain; charset=latin1' }),
      // O que `res.text()` devolve para esses bytes: decodificação UTF-8 com perdas.
      text: async () => 'JO\uFFFDO \uFFFDA\r\n',
    } as unknown as Response)

    const { nome, arquivo } = await baixarRemessa('lote-1')

    expect(nome).toBe('PG220901.REM')
    expect(arquivo.size).toBe(bytes.length)
    expect(Array.from(await lerBytes(arquivo))).toEqual(Array.from(bytes))
  })

  it('recusa a remessa truncada no caminho em vez de entregar meio arquivo', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="PG220901.REM"',
        'Content-Length': '2400',
      }),
      blob: async () => new Blob([new Uint8Array(240)]),
    } as unknown as Response)

    await expect(baixarRemessa('lote-1')).rejects.toThrow(
      'Download incompleto de PG220901.REM: recebidos 240 de 2400 bytes',
    )
  })

  it('falha com o status quando o backend recusa', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response)
    await expect(baixarRemessa('lote-1')).rejects.toThrow('Falha ao baixar a remessa (404)')
  })
})

const respostaJson = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as Response

const ultimaChamada = (): RequestInit => mockApiFetch.mock.calls.at(-1)?.[1] as RequestInit

const corpoEnviado = (): Record<string, unknown> =>
  JSON.parse(String(ultimaChamada().body)) as Record<string, unknown>

describe('gerarRemessa — data de débito (ADR-0049)', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('manda dataDebito junto com confirmarNovoLote e mantém a Idempotency-Key do lote', async () => {
    mockApiFetch.mockResolvedValueOnce(
      respostaJson(200, { status: 'gerada', dataDebito: '2026-09-23' }),
    )
    const res = await gerarRemessa('L1', { dataDebito: '2026-09-23', confirmarNovoLote: true })
    expect(corpoEnviado()).toEqual({
      dryRun: false,
      confirmarNovoLote: true,
      dataDebito: '2026-09-23',
    })
    const headers = ultimaChamada().headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe('remessa:L1')
    expect(res.dataDebito).toBe('2026-09-23')
  })

  it('sem dataDebito o corpo não leva a chave', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaJson(200, { status: 'gerada' }))
    await gerarRemessa('L1')
    expect(corpoEnviado()).not.toHaveProperty('dataDebito')
  })

  it('DATA_DEBITO_FORA_DA_JANELA vira DebitDateOutsideWindowError com details', async () => {
    mockApiFetch.mockResolvedValueOnce(
      respostaJson(422, {
        error: 'Data 30/09 depois do vencimento',
        code: 'DATA_DEBITO_FORA_DA_JANELA',
        details: { motivo: 'depois_do_vencimento', max: '2026-09-29' },
      }),
    )
    const erro = await gerarRemessa('L1', { dataDebito: '2026-09-30' }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(DebitDateOutsideWindowError)
    expect((erro as DebitDateOutsideWindowError).message).toBe('Data 30/09 depois do vencimento')
    expect((erro as DebitDateOutsideWindowError).details).toMatchObject({ max: '2026-09-29' })
  })

  it('DATA_DEBITO_CONGELADA vira DebitDateFrozenError com details', async () => {
    mockApiFetch.mockResolvedValueOnce(
      respostaJson(409, {
        error: 'congelada',
        code: 'DATA_DEBITO_CONGELADA',
        details: { motivo: 'diferente', dataCongelada: '2026-09-23', nativeFlpCod: 41 },
      }),
    )
    const erro = await gerarRemessa('L1', { dataDebito: '2026-09-24' }).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(DebitDateFrozenError)
    expect((erro as DebitDateFrozenError).details).toMatchObject({ nativeFlpCod: 41 })
  })
})

describe('fetchJanelaDataDebito', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('lê a janela do backend', async () => {
    const janela = { hoje: '2026-09-22', min: '2026-09-22', max: '2026-09-25', naoUteis: [] }
    mockApiFetch.mockResolvedValueOnce(respostaJson(200, janela))
    await expect(fetchJanelaDataDebito('L1')).resolves.toEqual(janela)
    expect(String(mockApiFetch.mock.calls.at(-1)?.[0])).toContain(
      '/sispag/lotes/L1/remessa/janela',
    )
  })
})

describe('formatCivilDate', () => {
  it('formata dd/mm por split, sem fuso', () => {
    expect(formatCivilDate('2026-09-22')).toBe('22/09')
    expect(formatCivilDate('2026-01-01')).toBe('01/01')
  })
})

// ─── Retirar do lote (ADR-0050) ──────────────────────────────────────────────

const respostaOk = (corpo: unknown) =>
  ({ ok: true, status: 200, json: async () => corpo }) as unknown as Response

const ultimaChamadaComUrl = () => mockApiFetch.mock.calls.at(-1) as [string, RequestInit]

describe('retirarDoLote', () => {
  it('faz POST na rota do título, com a chave codificada', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaOk({ lote: { id: 'L1' } }))

    const lote = await retirarDoLote({ filCod: 2, docCod: '81/3', titCod: '1' })

    expect(lote).toEqual({ id: 'L1' })
    const [url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/sispag\/titulos\/2\/81%2F3\/1\/retirar-do-lote$/)
    expect(init.method).toBe('POST')
  })

  it('resposta não-ok lança a mensagem do backend', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Este título não está mais em nenhum lote em rascunho.' }),
    } as unknown as Response)

    await expect(retirarDoLote({ filCod: 2, docCod: '813', titCod: '1' })).rejects.toThrow(
      'Este título não está mais em nenhum lote em rascunho.',
    )
  })
})

describe('fetchBoletosDda — filtros e página vão na query', () => {
  beforeEach(() => mockApiFetch.mockReset())

  const urlChamada = (): URL => new URL(String(mockApiFetch.mock.calls.at(-1)?.[0]))

  it('manda só os filtros presentes, com a busca aparada', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaJson(200, { boletos: [] }))
    await fetchBoletosDda({
      escopo: 'todos',
      pagina: 3,
      tamanho: 20,
      situacao: 'AMBIGUO',
      busca: '  pedroni ',
      filCod: 2,
    })
    const url = urlChamada()
    expect(url.pathname).toBe('/sispag/boletos-dda')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      escopo: 'todos',
      pagina: '3',
      tamanho: '20',
      situacao: 'AMBIGUO',
      busca: 'pedroni',
      filCod: '2',
    })
  })

  it('busca vazia e filtros ausentes não vão na query', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaJson(200, { boletos: [] }))
    await fetchBoletosDda({ escopo: 'a-vencer', pagina: 1, busca: '   ' })
    expect(Object.fromEntries(urlChamada().searchParams)).toEqual({
      escopo: 'a-vencer',
      pagina: '1',
    })
  })

  it('erro do backend vira Error com a mensagem dele', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaJson(400, { error: 'invalid query' }))
    await expect(fetchBoletosDda({ escopo: 'todos', pagina: 1 })).rejects.toThrow('invalid query')
  })
})

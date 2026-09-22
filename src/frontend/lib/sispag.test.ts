import { baixarRemessa } from '@/lib/sispag'

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

  it('falha com o status quando o backend recusa', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response)
    await expect(baixarRemessa('lote-1')).rejects.toThrow('Falha ao baixar a remessa (404)')
  })
})

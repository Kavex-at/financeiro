import { baixarBlob, lerArquivoDaResposta, parseContentDispositionFilename } from '@/lib/download'

const resposta = (bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string>): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers(headers),
    blob: async () => new Blob([bytes]),
  }) as unknown as Response

const bytes = (n: number): Uint8Array<ArrayBuffer> => new Uint8Array(n).fill(0x41)

describe('parseContentDispositionFilename', () => {
  it('lê o nome com e sem aspas, e devolve undefined sem header', () => {
    expect(parseContentDispositionFilename('attachment; filename="PG220901.REM"')).toBe(
      'PG220901.REM',
    )
    expect(parseContentDispositionFilename('attachment; filename=relatorio.xlsx')).toBe(
      'relatorio.xlsx',
    )
    expect(parseContentDispositionFilename(null)).toBeUndefined()
  })
})

describe('lerArquivoDaResposta', () => {
  it('usa o nome do backend e devolve os bytes', async () => {
    const res = resposta(bytes(9), {
      'Content-Disposition': 'attachment; filename="PG220901.REM"',
      'Content-Length': '9',
    })
    const { nome, arquivo } = await lerArquivoDaResposta(res, 'fallback.REM')
    expect(nome).toBe('PG220901.REM')
    expect(arquivo.size).toBe(9)
  })

  it('cai no nome padrão quando o backend não anuncia um', async () => {
    const { nome } = await lerArquivoDaResposta(resposta(bytes(4), {}), 'lote-7.REM')
    expect(nome).toBe('lote-7.REM')
  })

  it('recusa um corpo truncado: menos bytes do que o Content-Length anuncia', async () => {
    const res = resposta(bytes(120), {
      'Content-Disposition': 'attachment; filename="PG220901.REM"',
      'Content-Length': '2400',
    })
    await expect(lerArquivoDaResposta(res, 'fallback.REM')).rejects.toThrow(
      'Download incompleto de PG220901.REM: recebidos 120 de 2400 bytes',
    )
  })

  it('aceita blob MAIOR que o Content-Length — é resposta comprimida, não truncada', async () => {
    // Com `Content-Encoding: gzip` o header traz o tamanho comprimido. Uma checagem de
    // igualdade reprovaria todo download legítimo atrás de um proxy que comprime.
    const res = resposta(bytes(2400), { 'Content-Length': '310' })
    await expect(lerArquivoDaResposta(res, 'lote-7.REM')).resolves.toMatchObject({ nome: 'lote-7.REM' })
  })

  it('não inventa falha quando não há Content-Length (chunked / header não exposto)', async () => {
    const res = resposta(bytes(2400), {})
    await expect(lerArquivoDaResposta(res, 'lote-7.REM')).resolves.toMatchObject({ nome: 'lote-7.REM' })
  })
})

describe('baixarBlob', () => {
  const criarUrl = jest.fn(() => 'blob:fake')
  const revogarUrl = jest.fn()

  beforeEach(() => {
    jest.clearAllMocks()
    // jsdom não implementa nenhum dos dois.
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = criarUrl
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revogarUrl
  })

  it('dispara o download com o nome pedido e libera a URL', () => {
    const cliques: string[] = []
    jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        cliques.push(this.download)
      })

    baixarBlob(new Blob([bytes(9)]), 'PG220901.REM')

    expect(cliques).toEqual(['PG220901.REM'])
    expect(revogarUrl).toHaveBeenCalledWith('blob:fake')
    expect(document.querySelector('a')).toBeNull()
  })

  it('libera a URL mesmo se o clique lançar — senão o arquivo fica preso em memória', () => {
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('bloqueado pelo navegador')
    })

    expect(() => baixarBlob(new Blob([bytes(9)]), 'PG220901.REM')).toThrow(
      'bloqueado pelo navegador',
    )
    expect(revogarUrl).toHaveBeenCalledWith('blob:fake')
  })
})

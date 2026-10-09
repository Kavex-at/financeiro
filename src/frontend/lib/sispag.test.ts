import {
  baixarRemessa,
  exportarTitulosAPagar,
  exportarTitulosRemessas,
  temRemessa,
  BoletoSemCodigoBarrasError,
  type BoletoDda,
  classificarBoletosDoTitulo,
  diasEntre,
  tituloDeItem,
  fetchBoletosDda,
  DebitDateFrozenError,
  DebitDateOutsideWindowError,
  fetchJanelaDataDebito,
  fetchLinhasDigitaveis,
  formatCivilDate,
  formatErpDay,
  rotuloFormaConexos,
  gerarRemessa,
  retirarDoLote,
  __limparCacheRecursos,
  AutorizacaoApiError,
  aprovarAutorizacao,
  eventosAutorizacao,
  finalizarLote,
  getRecursos,
  listarCandidatosAutorizacao,
  listarFavorecidosAutorizados,
  PayeeNotAuthorizedAtRemittanceError,
  pedirAutorizacao,
  reconferirAutorizacao,
  rejeitarAutorizacao,
  revelarDestino,
  revogarAutorizacao,
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

  it('mostra o motivo do backend (arquivo sumido do Conexos) em vez do status cru', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error: 'O arquivo de remessa PG061001.REM não foi encontrado no Conexos (filial 7).',
        code: 'REMESSA_ARQUIVO_INDISPONIVEL',
      }),
    } as unknown as Response)
    await expect(baixarRemessa('lote-1')).rejects.toThrow(
      'O arquivo de remessa PG061001.REM não foi encontrado no Conexos (filial 7).',
    )
  })
})

describe('exportarTitulosAPagar', () => {
  it('manda as chaves no corpo, na ordem, e devolve o xlsx com o nome anunciado', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="sispag-titulos-a-pagar-2026-10-08.xlsx"',
      }),
      blob: async () => new Blob([new Uint8Array([0x50, 0x4b])]),
    } as unknown as Response)

    const { nome } = await exportarTitulosAPagar(['7:802:1', '2:801:1'])

    const [url, init] = mockApiFetch.mock.calls.at(-1) ?? []
    expect(String(url)).toContain('/sispag/titulos/exportar')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      chaves: ['7:802:1', '2:801:1'],
    })
    expect(nome).toBe('sispag-titulos-a-pagar-2026-10-08.xlsx')
  })
})

describe('exportarTitulosRemessas', () => {
  it('manda os ids no corpo e devolve o xlsx com o nome anunciado', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({
        'Content-Disposition': 'attachment; filename="sispag-titulos-remessas-2026-10-06.xlsx"',
      }),
      blob: async () => new Blob([new Uint8Array([0x50, 0x4b])]),
    } as unknown as Response)

    const { nome, arquivo } = await exportarTitulosRemessas(['L1', 'L2'])

    const [url, init] = mockApiFetch.mock.calls.at(-1) ?? []
    expect(String(url)).toContain('/sispag/remessas/titulos/exportar')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ loteIds: ['L1', 'L2'] })
    expect(nome).toBe('sispag-titulos-remessas-2026-10-06.xlsx')
    expect(arquivo.size).toBe(2)
  })

  it('propaga a mensagem do backend na recusa', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Não foi possível exportar: 1 lote(s) ainda sem remessa gerada.' }),
    } as unknown as Response)
    await expect(exportarTitulosRemessas(['L1'])).rejects.toThrow('ainda sem remessa gerada')
  })
})

describe('temRemessa', () => {
  it.each([
    ['REMESSA_GERADA', true],
    ['RETORNADO', true],
    ['BAIXADO', true],
    ['FINALIZADO', false],
    ['RASCUNHO', false],
    ['CANCELADO', false],
  ] as const)('%s → %s', (status, esperado) => {
    expect(temRemessa({ status })).toBe(esperado)
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

  it('BOLETO_SEM_CODIGO_BARRAS vira BoletoSemCodigoBarrasError com o título', async () => {
    mockApiFetch.mockResolvedValueOnce(
      respostaJson(409, {
        error: 'O título 5046/1 está marcado como BOLETO, mas…',
        code: 'BOLETO_SEM_CODIGO_BARRAS',
        details: {
          docCod: '5046',
          titCod: '1',
          filCod: 1,
          credor: 'ADP BRASIL LTDA',
          valor: 4815.33,
          vencimento: '2026-09-24',
        },
      }),
    )
    const erro = await gerarRemessa('L1').catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(BoletoSemCodigoBarrasError)
    expect((erro as BoletoSemCodigoBarrasError).titulo).toEqual({
      docCod: '5046',
      titCod: '1',
      filCod: 1,
      credor: 'ADP BRASIL LTDA',
      valor: 4815.33,
      vencimento: '2026-09-24',
    })
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

describe('formatErpDay', () => {
  // A suíte roda em America/Sao_Paulo (jest.globalSetup.js).
  it('exibe o dia UTC do vencimento do ERP, mesmo com o navegador em Brasília', () => {
    // Título 5046/1: vencimento 24/09 gravado pelo ERP como 2026-09-24T00:00Z (= 23/09 21h BRT).
    expect(new Date(1790208000000).getDate()).toBe(23) // sanidade: o fuso local é BRT
    expect(formatErpDay(1790208000000)).toBe('24/09/2026')
  })

  it('aceita o carimbo das 15:00Z que o ERP também usa', () => {
    expect(formatErpDay(Date.UTC(2026, 8, 24, 15))).toBe('24/09/2026')
  })

  it('devolve "—" sem vencimento', () => {
    expect(formatErpDay(undefined)).toBe('—')
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

const okJson = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response

describe('fetchLinhasDigitaveis', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('repassa itens, total e dropped', async () => {
    const itens = [{ docCod: '10400', titCod: '1', linhaDigitavel: '1'.repeat(47) }]
    mockApiFetch.mockResolvedValue(okJson({ itens, total: 3, dropped: 2 }))

    await expect(fetchLinhasDigitaveis('lote-1')).resolves.toEqual({ itens, total: 3, dropped: 2 })
  })

  it('resposta antiga (só `itens`) não inventa recusa', async () => {
    // Um backend que ainda não manda a contagem não pode fazer a tela acusar boleto
    // inválido: `dropped` cai para 0 e `total` para o que de fato veio.
    const itens = [{ docCod: '1', titCod: '1', linhaDigitavel: '1'.repeat(47) }]
    mockApiFetch.mockResolvedValue(okJson({ itens }))

    await expect(fetchLinhasDigitaveis('lote-1')).resolves.toEqual({ itens, total: 1, dropped: 0 })
  })

  it('corpo vazio vira resultado vazio, não exceção', async () => {
    mockApiFetch.mockResolvedValue(okJson({}))

    await expect(fetchLinhasDigitaveis('lote-1')).resolves.toEqual({
      itens: [],
      total: 0,
      dropped: 0,
    })
  })

  it('HTTP não-ok lança — lista vazia afirmaria "nenhum boleto"', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500 } as unknown as Response)

    await expect(fetchLinhasDigitaveis('lote-1')).rejects.toThrow('API 500')
  })
})

// ─────────────────────────────────────────────── ADR-0054 — destino de TED/PIX

describe('getRecursos', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    __limparCacheRecursos()
  })

  it('lê as flags como booleanos', async () => {
    mockApiFetch.mockResolvedValueOnce(
      respostaOk({ tedEnabled: true, favorecidoAutorizadoEnabled: 'sim', pixEnabled: false }),
    )
    expect(await getRecursos()).toEqual({
      tedEnabled: true,
      pixEnabled: false,
      favorecidoAutorizadoEnabled: false,
    })
    expect(String(mockApiFetch.mock.calls[0]?.[0])).toMatch(/\/sispag\/recursos$/)
  })

  it('falha de leitura = tudo desligado (a tela fica igual à de antes)', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('rede'))
    expect(await getRecursos()).toEqual({
      tedEnabled: false,
      pixEnabled: false,
      favorecidoAutorizadoEnabled: false,
    })
  })
})

describe('favorecido autorizado (ADR-0065)', () => {
  beforeEach(() => mockApiFetch.mockReset())
  const ID = '3f1c2b9e-4d8a-4c1e-9f7a-2b6d8e0a1c55'
  const AUT = {
    id: ID,
    pesCod: '7001',
    credor: 'ACME',
    modalidade: 'TED',
    estado: 'PENDENTE',
    avisos: [],
    origemSolicitacao: 'ITEM',
    filCodLeitura: 4,
    solicitadoPor: 'ana',
    versao: 1,
  }

  it('listarFavorecidosAutorizados: GET com filtros, valida a resposta com Zod', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaOk({ autorizacoes: [{ ...AUT, credor: null }] }))
    const r = await listarFavorecidosAutorizados({ estado: 'PENDENTE', pesCod: '7001' })
    expect(ultimaChamadaComUrl()[0]).toMatch(
      /\/sispag\/favorecidos-autorizados\?estado=PENDENTE&pesCod=7001$/,
    )
    expect(r[0]).toMatchObject({ id: ID, estado: 'PENDENTE' })
    expect(r[0]?.credor).toBeUndefined()
  })

  it('resposta fora do contrato é recusada (Zod)', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaOk({ autorizacoes: [{ ...AUT, estado: 'XYZ' }] }))
    await expect(listarFavorecidosAutorizados()).rejects.toThrow()
  })

  it('pedir, aprovar com a impressão, rejeitar e revogar: rotas e corpos', async () => {
    mockApiFetch.mockResolvedValue(respostaOk({ autorizacao: AUT }))
    await pedirAutorizacao({ pesCod: '7001', modalidade: 'TED', origem: 'ITEM', filCod: 4 })
    let [url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/sispag\/favorecidos-autorizados$/)
    expect(JSON.parse(String(init.body))).toEqual({
      pesCod: '7001',
      modalidade: 'TED',
      origem: 'ITEM',
      filCod: 4,
    })
    await aprovarAutorizacao(ID, { versao: 1, fingerprintMostrado: 'f'.repeat(64) })
    ;[url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(new RegExp(`/favorecidos-autorizados/${ID}/aprovar$`))
    expect(JSON.parse(String(init.body))).toEqual({ versao: 1, fingerprintMostrado: 'f'.repeat(64) })
    await rejeitarAutorizacao(ID, { versao: 1, motivo: 'conta de terceiro' })
    expect(ultimaChamadaComUrl()[0]).toMatch(/\/rejeitar$/)
    await revogarAutorizacao(ID, { versao: 2, motivo: 'encerrado' })
    ;[url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/revogar$/)
    expect(JSON.parse(String(init.body))).toEqual({ versao: 2, motivo: 'encerrado' })
  })

  it('erro do backend vira AutorizacaoApiError com status e código', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'O destino deste favorecido mudou.', code: 'AUTORIZACAO_DESTINO_MUDOU' }),
    } as unknown as Response)
    const err = await aprovarAutorizacao(ID, { versao: 1, fingerprintMostrado: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(AutorizacaoApiError)
    expect(err).toMatchObject({ status: 409, code: 'AUTORIZACAO_DESTINO_MUDOU', message: 'O destino deste favorecido mudou.' })
  })

  it('reconferir devolve o destino atual; revelar é POST sem cache; eventos e candidatos', async () => {
    mockApiFetch.mockResolvedValueOnce(
      respostaOk({ autorizacao: AUT, atual: { resultado: 'OK', destinoMascarado: 'banco 237', fingerprint: 'f', avisos: [] } }),
    )
    const rc = await reconferirAutorizacao(ID)
    expect(rc.atual.fingerprint).toBe('f')
    mockApiFetch.mockResolvedValueOnce(
      respostaOk({ destinoMascarado: 'banco 237', destino: { tipo: 'TED', banco: '237', conta: '1' } }),
    )
    await revelarDestino(ID)
    const [url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/revelar$/)
    expect(init.method).toBe('POST')
    expect(init.cache).toBe('no-store')
    mockApiFetch.mockResolvedValueOnce(respostaOk({ eventos: [] }))
    await eventosAutorizacao(ID)
    expect(ultimaChamadaComUrl()[0]).toMatch(/\/eventos$/)
    mockApiFetch.mockResolvedValueOnce(
      respostaOk({ candidatos: [], total: 0, pagina: 2, limite: 25, retiradosSemDado: [] }),
    )
    await listarCandidatosAutorizacao({ pagina: 2, limite: 25 })
    expect(ultimaChamadaComUrl()[0]).toMatch(/\/candidatos\?pagina=2&limite=25$/)
  })

  it('finalizarLote devolve o lote e os itens retirados', async () => {
    mockApiFetch.mockResolvedValueOnce(
      respostaOk({ lote: { id: 'L1' }, retirados: [{ docCod: '1', titCod: '1', motivo: 'SEM_DADO_PAGAMENTO' }] }),
    )
    const r = await finalizarLote('L1', 3)
    expect(r.lote.id).toBe('L1')
    expect(r.retirados).toHaveLength(1)
  })

  it('remessa barrada pela guarda vira PayeeNotAuthorizedAtRemittanceError com os itens', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'A remessa não foi gerada',
        code: 'FAVORECIDO_NAO_AUTORIZADO_NA_REMESSA',
        details: { loteId: 'L1', itens: [{ item: '801/1', motivo: 'DESTINO_ALTERADO' }] },
      }),
    } as unknown as Response)
    const err = await gerarRemessa('L1').catch((e) => e)
    expect(err).toBeInstanceOf(PayeeNotAuthorizedAtRemittanceError)
    expect(err.itens).toEqual([{ item: '801/1', motivo: 'DESTINO_ALTERADO' }])
  })
})

describe('boletos DDA de um título', () => {
  const titulo = {
    filCod: 1,
    docCod: '5046',
    titCod: '1',
    credor: 'ADP BRASIL LTDA',
    valor: 4815.33,
    vencimento: '2026-09-24',
  }
  const boleto = (over: Partial<BoletoDda> & { ditCod: number }): BoletoDda => ({
    ddcCod: 152,
    valor: 4815.33,
    vencimento: '2026-09-24',
    vencido: false,
    situacao: 'SEM_TITULO',
    candidatos: [],
    ...over,
  })

  it('diasEntre conta dias civis, sem fuso (inclusive na virada de mês e ano)', () => {
    expect(diasEntre('2026-09-24', '2026-09-24')).toBe(0)
    expect(diasEntre('2026-09-24', '2026-09-27')).toBe(3)
    expect(diasEntre('2026-09-24', '2026-09-21')).toBe(-3)
    expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3)
  })

  it('separa os candidatos do título dos boletos só de mesmo valor, e mede a diferença de data', () => {
    const candidato = boleto({
      ditCod: 1,
      situacao: 'CANDIDATO',
      candidatos: [{ filCod: 1, docCod: '5046', titCod: '1', diferencaDias: 0 }],
    })
    const dataDiferente = boleto({ ditCod: 2, vencimento: '2026-09-27' })
    const outroValor = boleto({ ditCod: 3, valor: 100 })
    const deOutroTitulo = boleto({
      ditCod: 4,
      situacao: 'VINCULADO',
      vinculo: { filCod: 1, docCod: '9', titCod: '1' },
      candidatos: [],
    })
    const r = classificarBoletosDoTitulo(titulo, [
      candidato,
      dataDiferente,
      outroValor,
      deOutroTitulo,
      candidato, // duplicado vindo das duas buscas
    ])
    expect(r.doTitulo.map((x) => x.boleto.ditCod)).toEqual([1])
    expect(r.doTitulo[0]?.diferencaDias).toBe(0)
    // Mesmo valor sem ligação a ESTE título: é onde mora "a data difere por alguns dias" (3 dias
    // no 2) e também o boleto já ligado a outro título (4). O de outro valor sai. Mais próximo 1º.
    expect(r.mesmoValor.map((x) => [x.boleto.ditCod, x.diferencaDias])).toEqual([
      [4, 0],
      [2, 3],
    ])
  })

  it('ordena do vencimento mais próximo ao mais distante', () => {
    const r = classificarBoletosDoTitulo(titulo, [
      boleto({ ditCod: 1, vencimento: '2026-10-05' }),
      boleto({ ditCod: 2, vencimento: '2026-09-25' }),
      boleto({ ditCod: 3, vencimento: '2026-09-20' }),
    ])
    expect(r.mesmoValor.map((x) => x.boleto.ditCod)).toEqual([2, 3, 1])
  })

  it('não confunde o mesmo docCod/titCod de OUTRA filial', () => {
    const outraFilial = boleto({
      ditCod: 1,
      situacao: 'CANDIDATO',
      candidatos: [{ filCod: 2, docCod: '5046', titCod: '1', diferencaDias: 0 }],
    })
    const r = classificarBoletosDoTitulo(titulo, [outraFilial])
    expect(r.doTitulo).toHaveLength(0)
    expect(r.mesmoValor).toHaveLength(1)
  })

  it('tituloDeItem converte o vencimento (epoch) em data civil', () => {
    expect(
      tituloDeItem({
        loteId: 'L1',
        filCod: 1,
        docCod: '5046',
        titCod: '1',
        credor: 'ADP',
        valor: 10,
        vencimento: Date.UTC(2026, 8, 24),
        incluidoPor: 'u',
      }),
    ).toEqual({
      filCod: 1,
      docCod: '5046',
      titCod: '1',
      credor: 'ADP',
      valor: 10,
      vencimento: '2026-09-24',
    })
  })
})

describe('rotuloFormaConexos', () => {
  it('rotula os códigos documentados de titVldPagopor', () => {
    expect(rotuloFormaConexos(6)).toBe('BOLETO')
    expect(rotuloFormaConexos(2)).toBe('TEF')
    expect(rotuloFormaConexos(10)).toBe('TRANSAÇÃO AUTOMÁTICA')
  })

  it('nunca lido ou fora do domínio → "—" (não inventa rótulo)', () => {
    expect(rotuloFormaConexos(undefined)).toBe('—')
    expect(rotuloFormaConexos(0)).toBe('—')
    expect(rotuloFormaConexos(11)).toBe('—')
  })
})

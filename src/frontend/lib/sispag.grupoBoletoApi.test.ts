/**
 * Cliente do boleto agrupado (ADR-0077, Task 20): URLs, métodos, corpo (nunca um ator), parse do
 * contrato de `routes/sispag.ts` e o erro com a mensagem em português e o código do envelope.
 */
import {
  AutorizacaoApiError,
  anularGrupoBoleto,
  CODIGOS_ERRO_GRUPO_BOLETO,
  confirmarGrupoBoleto,
  fetchGruposBoleto,
  fetchSugestoesGrupoBoleto,
  incluirGrupoNoLote,
  retirarGrupoDoLote,
} from './sispag'

jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))
import { apiFetch } from '@/lib/http'

const mock = apiFetch as jest.MockedFunction<typeof apiFetch>
const resp = (status: number, corpo: unknown) =>
  ({ ok: status < 400, status, json: async () => corpo }) as unknown as Response

const GRUPO_ID = '00000000-0000-0000-0000-0000000000a1'
const LOTE_ID = '00000000-0000-0000-0000-0000000000b1'
const TITULOS = ['38883', '38884', '38885'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' }))

const sugestao = {
  filCod: 2,
  pesCod: '9001',
  credor: 'PEDRONI',
  ddcCod: 900,
  ditCod: 332841,
  numeroBoleto: '332841',
  codbarMascarado: '34191…7500',
  valorBoletoCentavos: 157500,
  vencimentoBoleto: '2026-10-21',
  somaTitulosCentavos: 157500,
  titulos: TITULOS.map((t) => ({
    ...t,
    motivos: [],
    valorCentavos: 52500,
    vencimento: '2026-10-21',
    valorLiquidoCentavos: 52500,
    deltaDias: 0,
  })),
  intercambiavel: false,
  parVigente: true,
  confirmavel: true,
  motivos: [],
}

const grupo = {
  id: GRUPO_ID,
  filCod: 2,
  pesCod: '9001',
  credor: 'PEDRONI',
  ddcCod: 900,
  ditCod: 332841,
  codbarMascarado: '34191…7500',
  valorBoletoCentavos: 157500,
  vencimentoBoleto: '2026-10-21',
  titulos: TITULOS.map((t) => ({ ...t, valorLiquidoCentavos: 52500, vencimento: '2026-10-21' })),
  somaTitulosCentavos: 157500,
  origem: 'SUGERIDO',
  intercambiavel: false,
  estado: 'CONFIRMADO',
  confirmadoPor: 'bia',
  versao: 1,
}

beforeEach(() => mock.mockReset())

const corpoDe = (n: number): unknown => JSON.parse((mock.mock.calls[n]?.[1] as RequestInit).body as string)
const metodoDe = (n: number): string | undefined => (mock.mock.calls[n]?.[1] as RequestInit).method

describe('cliente do boleto agrupado', () => {
  it('sugestões: GET com o filCod na query; devolve a lista', async () => {
    mock.mockResolvedValue(resp(200, { sugestoes: [sugestao] }))
    const r = await fetchSugestoesGrupoBoleto(2)
    const url = new URL(String(mock.mock.calls[0]?.[0]), 'http://x')
    expect(url.pathname).toContain('/sispag/grupos-boleto/sugestoes')
    expect(url.searchParams.get('filCod')).toBe('2')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ credor: 'PEDRONI', confirmavel: true, valorBoletoCentavos: 157500 })
  })

  it('sem filtro de filial a query não leva filCod', async () => {
    mock.mockResolvedValue(resp(200, { sugestoes: [] }))
    await fetchSugestoesGrupoBoleto()
    expect(String(mock.mock.calls[0]?.[0])).not.toContain('filCod')
  })

  it('grupos: GET /sispag/grupos-boleto com a situação derivada e o órfão', async () => {
    mock.mockResolvedValue(
      resp(200, { grupos: [{ ...grupo, situacao: 'REJEITADO', orfao: { orfao: false } }] }),
    )
    const r = await fetchGruposBoleto(2)
    const url = new URL(String(mock.mock.calls[0]?.[0]), 'http://x')
    expect(url.pathname).toMatch(/\/sispag\/grupos-boleto$/)
    expect(url.searchParams.get('filCod')).toBe('2')
    expect(r[0]).toMatchObject({ id: GRUPO_ID, situacao: 'REJEITADO', orfao: { orfao: false } })
  })

  it('confirmar manda POST com o boleto e os títulos, nunca um ator; avisos só quando reconhecidos', async () => {
    mock.mockResolvedValue(resp(201, { criado: true, grupo }))
    const base = { origem: 'SUGERIDO' as const, ddcCod: 900, ditCod: 332841, titulos: TITULOS }
    await confirmarGrupoBoleto(base)
    await confirmarGrupoBoleto({
      ...base,
      origem: 'MANUAL',
      reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
    })
    expect(String(mock.mock.calls[0]?.[0])).toContain('/sispag/grupos-boleto/confirmar')
    expect(metodoDe(0)).toBe('POST')
    expect(corpoDe(0)).toEqual(base)
    expect(corpoDe(1)).toEqual({
      ...base,
      origem: 'MANUAL',
      reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
    })
    expect(JSON.stringify(corpoDe(0))).not.toContain('ator')
  })

  it('confirmar devolve se o grupo é novo (201) ou já existia (200)', async () => {
    mock.mockResolvedValueOnce(resp(201, { criado: true, grupo }))
    mock.mockResolvedValueOnce(resp(200, { criado: false, grupo }))
    const chamada = { origem: 'SUGERIDO' as const, ddcCod: 900, ditCod: 1, titulos: TITULOS }
    expect((await confirmarGrupoBoleto(chamada)).criado).toBe(true)
    expect((await confirmarGrupoBoleto(chamada)).criado).toBe(false)
  })

  it('anular: POST /grupos-boleto/:id/anular só com o motivo; devolve o lote de onde saiu e o aviso', async () => {
    mock.mockResolvedValue(
      resp(200, {
        anulado: true,
        grupo: { ...grupo, estado: 'ANULADO' },
        retiradoDoLoteId: LOTE_ID,
        avisoLoteComprometido: {
          loteId: LOTE_ID,
          status: 'FINALIZADO',
          mensagem: 'A próxima remessa retira o grupo.',
        },
      }),
    )
    const r = await anularGrupoBoleto(GRUPO_ID, 'boleto pago por fora do sistema')
    expect(String(mock.mock.calls[0]?.[0])).toContain(`/sispag/grupos-boleto/${GRUPO_ID}/anular`)
    expect(metodoDe(0)).toBe('POST')
    expect(corpoDe(0)).toEqual({ motivo: 'boleto pago por fora do sistema' })
    expect(r).toMatchObject({
      anulado: true,
      retiradoDoLoteId: LOTE_ID,
      avisoLoteComprometido: { mensagem: 'A próxima remessa retira o grupo.' },
    })
  })

  it('incluir no lote: POST /lotes/:id/grupos com o grupo, mover e a versão; devolve o lote e os avisos', async () => {
    mock.mockResolvedValue(
      resp(200, {
        lote: { id: LOTE_ID, filCod: 2, status: 'RASCUNHO', versao: 5, itens: [] },
        avisos: [{ tipo: 'BORDERO_ANTERIOR_A_RESOLVER', mensagem: 'resolva o borderô antigo' }],
      }),
    )
    const r = await incluirGrupoNoLote(LOTE_ID, { grupoId: GRUPO_ID, mover: true, versaoEsperada: 4 })
    expect(String(mock.mock.calls[0]?.[0])).toContain(`/sispag/lotes/${LOTE_ID}/grupos`)
    expect(metodoDe(0)).toBe('POST')
    expect(corpoDe(0)).toEqual({ grupoId: GRUPO_ID, mover: true, versaoEsperada: 4 })
    expect(r.lote.versao).toBe(5)
    expect(r.avisos[0]).toMatchObject({ tipo: 'BORDERO_ANTERIOR_A_RESOLVER' })
  })

  it('incluir sem mover nem versão: o corpo é só o grupo', async () => {
    mock.mockResolvedValue(resp(200, { lote: { id: LOTE_ID, itens: [] }, avisos: [] }))
    await incluirGrupoNoLote(LOTE_ID, { grupoId: GRUPO_ID })
    expect(corpoDe(0)).toEqual({ grupoId: GRUPO_ID })
  })

  it('retirar do lote: DELETE /lotes/:id/grupos/:grupoId com a versão na query; devolve o lote', async () => {
    mock.mockResolvedValue(resp(200, { lote: { id: LOTE_ID, versao: 6, itens: [] } }))
    const lote = await retirarGrupoDoLote(LOTE_ID, GRUPO_ID, 5)
    const url = new URL(String(mock.mock.calls[0]?.[0]), 'http://x')
    expect(url.pathname).toContain(`/sispag/lotes/${LOTE_ID}/grupos/${GRUPO_ID}`)
    expect(url.searchParams.get('versaoEsperada')).toBe('5')
    expect(metodoDe(0)).toBe('DELETE')
    expect(lote.versao).toBe(6)
  })

  it('erro do servidor: AutorizacaoApiError com a mensagem, o status e o código do envelope', async () => {
    mock.mockResolvedValue(
      resp(409, {
        error: 'Retire o boleto agrupado inteiro: ele não pode ser dividido.',
        code: 'GRUPO_BOLETO_INDIVISIVEL',
      }),
    )
    const erro = await retirarGrupoDoLote(LOTE_ID, GRUPO_ID).catch((e: unknown) => e)
    expect(erro).toBeInstanceOf(AutorizacaoApiError)
    expect(erro).toMatchObject({
      message: 'Retire o boleto agrupado inteiro: ele não pode ser dividido.',
      status: 409,
      code: CODIGOS_ERRO_GRUPO_BOLETO.INDIVISIVEL,
    })
  })

  it('os códigos estáveis de erro espelham as classes do backend', () => {
    expect(CODIGOS_ERRO_GRUPO_BOLETO).toMatchObject({
      SOMA_DIVERGENTE: 'GRUPO_BOLETO_SOMA_DIVERGENTE',
      TITULO_INELEGIVEL: 'GRUPO_BOLETO_TITULO_INELEGIVEL',
      CRUZA_FILIAL: 'GRUPO_BOLETO_CRUZA_FILIAL',
      FORA_DA_JANELA: 'GRUPO_BOLETO_FORA_DA_JANELA',
      INDIVISIVEL: 'GRUPO_BOLETO_INDIVISIVEL',
      NAO_ENCONTRADO: expect.any(String),
    })
  })
})

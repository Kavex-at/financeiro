/**
 * Cliente da sugestão de boleto (ADR-0068): URLs, métodos, corpo, parse do contrato e o erro com
 * a mensagem em português e o código do envelope.
 */
import {
  confirmarSugestaoBoleto,
  copiarLinhaSugestao,
  fetchConfirmacoesEmissor,
  fetchSugestoesBoleto,
  fetchTodasSugestoesBoleto,
  rejeitarSugestaoBoleto,
  revogarConfirmacaoEmissor,
} from './sispag'

jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))
import { apiFetch } from '@/lib/http'

const mock = apiFetch as jest.MockedFunction<typeof apiFetch>
const resp = (status: number, corpo: unknown) =>
  ({ ok: status < 400, status, json: async () => corpo }) as unknown as Response

const CHAVE = { filCod: 1, docCod: '9', titCod: '1', ddcCod: 5, ditCod: 6 }
const item = (n: number) => ({
  filCod: 1,
  docCod: String(n),
  titCod: '1',
  valorTitulo: 10,
  vencimentoTitulo: '2026-10-20',
  dataDebito: '2026-10-20',
  ddcCod: 5,
  ditCod: n,
  valorBoleto: 10,
  vencimentoBoleto: '2026-10-20',
  avaliacao: {
    resultado: 'FORTE',
    deltaValor: 0,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: ['VALOR_IGUAL'],
    confirmavel: true,
  },
  estado: 'SUGERIDA',
  confirmavel: true,
})
const lista = (sugestoes: unknown[], total: number, extra = {}) => ({
  sugestoes,
  total,
  pagina: 1,
  tamanho: 100,
  contagem: {},
  ...extra,
})

const decisao = {
  id: 'd1',
  filCod: 1,
  docCod: '9',
  titCod: '1',
  pesCod: '7',
  ddcCod: 5,
  ditCod: 6,
  codbarMascarado: '237/2656/***2740',
  valorTitulo: 10,
  vencimentoTitulo: '2026-10-20',
  valorBoleto: 10,
  vencimentoBoleto: '2026-10-20',
  deltaValor: 0,
  deltaPercentual: 0,
  deltaDias: 0,
  sinais: [],
  decisao: 'CONFIRMADA',
  decididoPor: 'bia',
  decididoEm: '2026-10-14T00:00:00Z',
}

const par = {
  id: 'p1',
  pesCod: '7',
  layoutEmissor: 'ITAU_341',
  bancoEmissor: '341',
  emissorMascarado: '341 / 1 / ***9',
  estado: 'VIGENTE',
  confirmadoPor: 'bia',
  confirmadoEm: '2026-10-14T00:00:00Z',
  versao: 1,
  elegivelAutomatico: true,
}

beforeEach(() => mock.mockReset())

describe('cliente da sugestão de boleto', () => {
  it('lista com filtros na query', async () => {
    mock.mockResolvedValue(resp(200, lista([item(1)], 1)))
    const r = await fetchSugestoesBoleto({ filCod: 2, tier: 'FORTE', pagina: 3, tamanho: 50 })
    const url = new URL(String(mock.mock.calls[0]?.[0]), 'http://x')
    expect(url.pathname).toContain('/sispag/sugestoes-boleto')
    expect(url.searchParams.get('filCod')).toBe('2')
    expect(url.searchParams.get('tier')).toBe('FORTE')
    expect(url.searchParams.get('pagina')).toBe('3')
    expect(r.sugestoes).toHaveLength(1)
  })

  it('fetchTodas junta as páginas e guarda o frescor da primeira', async () => {
    mock
      .mockResolvedValueOnce(resp(200, lista([item(1), item(2)], 3, { ddaDefasadoHoras: 20 })))
      .mockResolvedValueOnce(resp(200, lista([item(3)], 3)))
    const r = await fetchTodasSugestoesBoleto()
    expect(r.sugestoes).toHaveLength(3)
    expect(r.ddaDefasadoHoras).toBe(20)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('confirmar e rejeitar mandam POST com a chave (e o motivo), nunca um ator', async () => {
    mock.mockResolvedValue(resp(201, { criada: true, decisao }))
    await confirmarSugestaoBoleto(CHAVE)
    await rejeitarSugestaoBoleto(CHAVE, 'outro credor')
    const [c1, c2] = mock.mock.calls
    expect((c1?.[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse((c1?.[1] as RequestInit).body as string)).toEqual(CHAVE)
    expect(String(c2?.[0])).toContain('/sugestoes-boleto/rejeitar')
    expect(JSON.parse((c2?.[1] as RequestInit).body as string)).toEqual({
      ...CHAVE,
      motivo: 'outro credor',
    })
  })

  it('copiar-linha devolve só a string', async () => {
    mock.mockResolvedValue(resp(200, { linhaDigitavel: 'TESTE' }))
    expect(await copiarLinhaSugestao(CHAVE)).toBe('TESTE')
  })

  it('erro do envelope vira AutorizacaoApiError com status, código e mensagem', async () => {
    mock.mockResolvedValue(
      resp(503, { error: 'Não foi possível registrar a cópia.', code: 'COPIA_LINHA_SEM_TRILHA' }),
    )
    await expect(copiarLinhaSugestao(CHAVE)).rejects.toMatchObject({
      name: 'AutorizacaoApiError',
      status: 503,
      code: 'COPIA_LINHA_SEM_TRILHA',
      message: 'Não foi possível registrar a cópia.',
    })
  })

  it('confirmações de emissor: lista e revoga', async () => {
    mock.mockResolvedValueOnce(resp(200, { confirmacoes: [par] }))
    expect(await fetchConfirmacoesEmissor({ estado: 'VIGENTE' })).toHaveLength(1)
    mock.mockResolvedValueOnce(resp(200, { confirmacao: { ...par, estado: 'REVOGADA' } }))
    const r = await revogarConfirmacaoEmissor('p1', 'conta trocada')
    expect(r.estado).toBe('REVOGADA')
    expect(String(mock.mock.calls[1]?.[0])).toContain('/confirmacoes-emissor/p1/revogar')
  })
})

/**
 * Cliente da confirmação em conjunto (I15t, ADR-0080): URL, método, corpo só com as chaves e o
 * parse do resultado por linha.
 */
import { confirmarEmConjunto, fetchIrmaosConjunto, type IrmaoConjunto } from './sispag'

jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))
import { apiFetch } from '@/lib/http'

const mock = apiFetch as jest.MockedFunction<typeof apiFetch>
const resp = (status: number, corpo: unknown) =>
  ({ ok: status < 400, status, json: async () => corpo }) as unknown as Response

const ORIGEM = { filCod: 2, docCod: '40100', titCod: '1' }
const IRMAO: IrmaoConjunto = {
  ...ORIGEM,
  ddcCod: 900,
  ditCod: 7,
  origem: true,
  numeroDocumento: '25037',
  numeroBoleto: '25037',
  valorTitulo: 647.56,
  vencimentoTitulo: '2026-10-27',
  valorBoleto: 647.57,
  vencimentoBoleto: '2026-10-27',
  deltaValor: 0.01,
  deltaDias: 0,
  tier: 'FORTE',
  avisos: ['ESCOLHIDO_SO_PELO_NUMERO'],
  ajusteAutomatico: true,
}

describe('cliente da confirmação em conjunto', () => {
  beforeEach(() => mock.mockReset())

  it('fetchIrmaosConjunto: GET /titulo/irmaos com a chave, no-store', async () => {
    mock.mockResolvedValue(resp(200, { origem: ORIGEM, irmaos: [IRMAO], maximo: 30 }))
    const r = await fetchIrmaosConjunto(ORIGEM)
    expect(r.irmaos[0]?.avisos).toEqual(['ESCOLHIDO_SO_PELO_NUMERO'])
    const [url, init] = mock.mock.calls[0] ?? []
    expect(String(url)).toContain('/sispag/sugestoes-boleto/titulo/irmaos?filCod=2&docCod=40100&titCod=1')
    expect(init?.cache).toBe('no-store')
  })

  it('confirmarEmConjunto: POST com origem e só as chaves das linhas', async () => {
    mock.mockResolvedValue(
      resp(200, {
        conjuntoId: 'c-1',
        resultados: [{ chave: { ...ORIGEM, ddcCod: 900, ditCod: 7 }, status: 'CONFIRMADA' }],
        confirmadas: 1,
        recusadas: 0,
      }),
    )
    const r = await confirmarEmConjunto(ORIGEM, [IRMAO])
    expect(r.confirmadas).toBe(1)
    const [url, init] = mock.mock.calls[0] ?? []
    expect(String(url)).toContain('/sispag/sugestoes-boleto/confirmar-em-conjunto')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      origem: ORIGEM,
      itens: [{ ...ORIGEM, ddcCod: 900, ditCod: 7 }],
    })
  })

  it('erro 422 chega com a mensagem do envelope', async () => {
    mock.mockResolvedValue(
      resp(422, {
        error: 'Confirme no máximo 30 títulos de uma vez (31 marcados). Nada foi confirmado.',
        code: 'CONFIRMACAO_CONJUNTO_ACIMA_DO_LIMITE',
        retryable: false,
      }),
    )
    await expect(confirmarEmConjunto(ORIGEM, [IRMAO])).rejects.toThrow(/no máximo 30/)
  })
})

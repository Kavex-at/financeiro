import {
  conferirLote,
  desfazerBloqueioDuplicidade,
  devolverLote,
  fetchPendenciasCadastro,
  resolverAlertaDuplicidade,
} from '@/lib/sispag'

// `apiFetch` é o boundary HTTP — mockado para controlar o que "chega do backend".
jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))

import { apiFetch } from '@/lib/http'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>
const respostaOk = (corpo: unknown) =>
  ({ ok: true, status: 200, json: async () => corpo }) as unknown as Response
const ultimaChamadaComUrl = () => mockApiFetch.mock.calls.at(-1) as [string, RequestInit]

describe('verificação TED/PIX e conferência (ADR-0063)', () => {
  beforeEach(() => mockApiFetch.mockReset())
  const ALERTA = '00000000-0000-0000-0000-0000000000a1'

  it('resolverAlertaDuplicidade: POST na rota da alerta do item, com a ação e o texto', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaOk({ lote: { id: 'L1' } }))
    await resolverAlertaDuplicidade('L1', { filCod: 4, docCod: '61/73', titCod: '1' }, ALERTA, {
      acao: 'JUSTIFICAR',
      justificativa: 'NF de serviço',
    })
    const [url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(
      new RegExp(`/sispag/lotes/L1/itens/4/61%2F73/1/alertas/${ALERTA}/resolucao$`),
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      acao: 'JUSTIFICAR',
      justificativa: 'NF de serviço',
    })
  })

  it('conferir e devolver: versão sempre; motivo só na devolução', async () => {
    mockApiFetch.mockResolvedValue(respostaOk({ lote: { id: 'L1' } }))
    await conferirLote('L1', 4)
    let [url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/sispag\/lotes\/L1\/conferir$/)
    expect(JSON.parse(String(init.body))).toEqual({ versao: 4 })
    await devolverLote('L1', 4, 'conta diverge')
    ;[url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/sispag\/lotes\/L1\/devolver$/)
    expect(JSON.parse(String(init.body))).toEqual({ versao: 4, motivo: 'conta diverge' })
  })

  it('a mensagem do backend (403/409, em português) chega como erro', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'A conferência precisa ser feita por outra pessoa.' }),
    } as unknown as Response)
    await expect(conferirLote('L1', 4)).rejects.toThrow(
      'A conferência precisa ser feita por outra pessoa.',
    )
  })

  it('fetchPendenciasCadastro: GET da fila e devolve a lista', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaOk({ pendencias: [{ id: 'P1' }] }))
    expect(await fetchPendenciasCadastro()).toEqual([{ id: 'P1' }])
    expect(ultimaChamadaComUrl()[0]).toMatch(/\/sispag\/pendencias-cadastro$/)
  })

  it('desfazerBloqueioDuplicidade: POST com o motivo', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaOk({ bloqueio: { id: 'B1' } }))
    await desfazerBloqueioDuplicidade({ filCod: 4, docCod: '6702', titCod: '1' }, 'cancelado')
    const [url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/sispag\/titulos\/4\/6702\/1\/bloqueio-duplicidade\/desfazer$/)
    expect(JSON.parse(String(init.body))).toEqual({ motivo: 'cancelado' })
  })
})

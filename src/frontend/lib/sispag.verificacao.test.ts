import { desfazerBloqueioDuplicidade, resolverAlertaDuplicidade } from '@/lib/sispag'

// `apiFetch` é o boundary HTTP — mockado para controlar o que "chega do backend".
jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))

import { apiFetch } from '@/lib/http'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>
const respostaOk = (corpo: unknown) =>
  ({ ok: true, status: 200, json: async () => corpo }) as unknown as Response
const ultimaChamadaComUrl = () => mockApiFetch.mock.calls.at(-1) as [string, RequestInit]

describe('verificação TED/PIX e duplicidade (ADR-0063)', () => {
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

  it('a mensagem do backend (409, em português) chega como erro', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'A alerta já foi tratada.' }),
    } as unknown as Response)
    await expect(
      resolverAlertaDuplicidade('L1', { filCod: 4, docCod: '1', titCod: '1' }, ALERTA, {
        acao: 'RETIRAR',
      }),
    ).rejects.toThrow('A alerta já foi tratada.')
  })

  it('desfazerBloqueioDuplicidade: POST com o motivo', async () => {
    mockApiFetch.mockResolvedValueOnce(respostaOk({ bloqueio: { id: 'B1' } }))
    await desfazerBloqueioDuplicidade({ filCod: 4, docCod: '6702', titCod: '1' }, 'cancelado')
    const [url, init] = ultimaChamadaComUrl()
    expect(url).toMatch(/\/sispag\/titulos\/4\/6702\/1\/bloqueio-duplicidade\/desfazer$/)
    expect(JSON.parse(String(init.body))).toEqual({ motivo: 'cancelado' })
  })
})

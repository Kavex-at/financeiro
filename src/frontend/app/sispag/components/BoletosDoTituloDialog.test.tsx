/**
 * Diálogo dos boletos DDA de um título sem associação: busca por `doc/tit` e por valor, separa o
 * que o Conexos lista como candidato dos boletos de mesmo valor e destaca a diferença de data.
 */

import { render, screen, waitFor } from '@testing-library/react'
import type { BoletoDda, BoletosDdaResposta } from '@/lib/sispag'
import { BoletosDoTituloDialog } from './BoletosDoTituloDialog'

// Boundary HTTP mockado: `fetchBoletosDdaDoTitulo` chama `fetchBoletosDda` no MESMO módulo, então
// mockar o export não pegaria — o que se controla é a resposta do backend.
jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))
import { apiFetch } from '@/lib/http'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>

const ok = (corpo: BoletosDdaResposta) =>
  ({ ok: true, status: 200, json: async () => corpo }) as unknown as Response

/** `busca` de cada requisição feita ao backend. */
const buscasFeitas = () =>
  mockApiFetch.mock.calls.map((c) => new URL(String(c[0]), 'http://x').searchParams.get('busca'))

const resposta = (boletos: BoletoDda[]): BoletosDdaResposta => ({
  boletos,
  total: boletos.length,
  pagina: 1,
  tamanho: 50,
  contagem: { todas: boletos.length, VINCULADO: 0, CANDIDATO: 0, AMBIGUO: 0, SEM_TITULO: 0 },
  filiais: [1],
  janelaDias: 45,
})

const titulo = {
  filCod: 1,
  docCod: '5046',
  titCod: '1',
  credor: 'ADP BRASIL LTDA',
  valor: 4815.33,
  vencimento: '2026-09-24',
}

const boleto = (over: Partial<BoletoDda>): BoletoDda => ({
  ddcCod: 152,
  ditCod: 7,
  numero: '001532761',
  valor: 4815.33,
  vencimento: '2026-09-27',
  vencido: false,
  situacao: 'SEM_TITULO',
  candidatos: [],
  ...over,
})

describe('BoletosDoTituloDialog', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('mostra o boleto de mesmo valor com a diferença de data do título', async () => {
    mockApiFetch.mockResolvedValue(ok(resposta([boleto({})])))
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)

    expect(await screen.findByText('Outros boletos com o mesmo valor')).toBeInTheDocument()
    expect(screen.getByText('001532761')).toBeInTheDocument()
    // vencimento do boleto 27/09 − do título 24/09 = +3 dias
    expect(screen.getByText('+3 dias')).toBeInTheDocument()
    // duas buscas: por doc/tit e por valor
    expect(buscasFeitas()).toEqual(expect.arrayContaining(['5046/1', '4815.33']))
    expect(
      mockApiFetch.mock.calls.every(
        (c) => new URL(String(c[0]), 'http://x').searchParams.get('filCod') === '1',
      ),
    ).toBe(true)
  })

  it('lista como candidato o boleto que o Conexos já relaciona ao título', async () => {
    mockApiFetch.mockResolvedValue(
      ok(
        resposta([
          boleto({
            vencimento: '2026-09-24',
            situacao: 'CANDIDATO',
            candidatos: [{ filCod: 1, docCod: '5046', titCod: '1', diferencaDias: 0 }],
          }),
        ]),
      ),
    )
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    expect(await screen.findByText('Candidatos deste título')).toBeInTheDocument()
    expect(screen.getByText('mesmo dia')).toBeInTheDocument()
    expect(screen.queryByText('Outros boletos com o mesmo valor')).not.toBeInTheDocument()
  })

  it('sem nenhum boleto de mesmo valor explica o que conferir', async () => {
    mockApiFetch.mockResolvedValue(ok(resposta([])))
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    expect(await screen.findByText('Nenhum boleto DDA com este valor')).toBeInTheDocument()
  })

  it('erro da consulta aparece no diálogo, não some', async () => {
    mockApiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
    render(<BoletosDoTituloDialog titulo={titulo} onClose={jest.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('Não foi possível consultar os boletos DDA')).toBeInTheDocument(),
    )
    expect(screen.getByText('API 500')).toBeInTheDocument()
  })

  it('fechado (sem título) não consulta nada', () => {
    render(<BoletosDoTituloDialog titulo={null} onClose={jest.fn()} />)
    expect(mockApiFetch).not.toHaveBeenCalled()
  })
})

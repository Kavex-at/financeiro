/**
 * Aba "Boletos DDA": a consolidação mora no backend — estes testes fixam que a tela mostra a
 * situação e a diferença de vencimento recebidas, filtra por situação/busca e troca o período.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { BoletoDda, BoletosDdaResposta } from '@/lib/sispag'
import { BoletosDdaTab } from './BoletosDdaTab'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, fetchBoletosDda: jest.fn(), sincronizarBoletosDda: jest.fn() }
})

import { fetchBoletosDda, sincronizarBoletosDda } from '@/lib/sispag'

const mockFetch = fetchBoletosDda as jest.MockedFunction<typeof fetchBoletosDda>
const mockSync = sincronizarBoletosDda as jest.MockedFunction<typeof sincronizarBoletosDda>

const ADP: BoletoDda = {
  ddcCod: 152,
  ditCod: 7,
  numero: '001532761',
  valor: 4815.33,
  vencimento: '2026-09-25',
  vencido: false,
  bancoEmissor: '341',
  linhaDigitavel: '34191090110134337000242865890009315800000481533',
  situacao: 'CANDIDATO',
  candidatos: [
    {
      filCod: 1,
      docCod: '5046',
      titCod: '1',
      credor: 'ADP BRASIL LTDA',
      vencimento: '2026-09-24',
      diferencaDias: 1,
      lote: { loteId: 'L1', status: 'FINALIZADO' },
    },
  ],
}
const LIVRE: BoletoDda = {
  ddcCod: 161,
  ditCod: 3,
  numero: '7386000',
  valor: 4838.32,
  vencimento: '2026-10-07',
  vencido: false,
  situacao: 'SEM_TITULO',
  candidatos: [],
}

const resposta = (boletos: BoletoDda[]): BoletosDdaResposta => ({
  boletos,
  sincronizadoEm: Date.parse('2026-09-24T12:00:00Z'),
  janelaDias: 3,
})

beforeEach(() => {
  mockFetch.mockReset()
  mockSync.mockReset()
})

describe('BoletosDdaTab', () => {
  it('carrega "a vencer" e mostra candidato com credor, diferença e lote', async () => {
    mockFetch.mockResolvedValue(resposta([ADP, LIVRE]))
    render(<BoletosDdaTab />)

    expect(await screen.findByText('ADP BRASIL LTDA')).toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith('a-vencer')
    expect(screen.getByText('+1 dia')).toBeInTheDocument()
    expect(screen.getByText('lote finalizado')).toBeInTheDocument()
    expect(screen.getByText('25/09/2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Candidatos (1)' })).toBeInTheDocument()
  })

  it('filtra por situação e por busca de valor', async () => {
    mockFetch.mockResolvedValue(resposta([ADP, LIVRE]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    fireEvent.click(screen.getByRole('button', { name: 'Sem título (1)' }))
    expect(screen.queryByText('001532761')).not.toBeInTheDocument()
    expect(screen.getByText('7386000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Todas (2)' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '4815' } })
    expect(screen.getByText('001532761')).toBeInTheDocument()
    expect(screen.queryByText('7386000')).not.toBeInTheDocument()
  })

  it('troca para "Todos" e recarrega depois de sincronizar', async () => {
    mockFetch.mockResolvedValue(resposta([ADP]))
    mockSync.mockResolvedValue({ arquivosNovos: 1, arquivosRelidos: 30, boletos: 3000, falhas: 0 })
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    fireEvent.click(screen.getByRole('button', { name: 'Todos (inclui vencidos)' }))
    await waitFor(() => expect(mockFetch).toHaveBeenLastCalledWith('todos'))

    fireEvent.click(screen.getByRole('button', { name: /Atualizar DDA/ }))
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
  })

  it('ambíguo: a linha mostra só o candidato mais próximo; o resto abre no modal', async () => {
    const pedroni = (docCod: string, vencimento: string, diferencaDias: number) => ({
      filCod: 2,
      docCod,
      titCod: '1',
      credor: 'PEDRONI LOGISTICA LTDA',
      vencimento,
      diferencaDias,
    })
    const AMBIGUO: BoletoDda = {
      ddcCod: 162,
      ditCod: 9,
      numero: '329691',
      valor: 1412,
      vencimento: '2026-09-24',
      vencido: false,
      situacao: 'AMBIGUO',
      candidatos: [
        pedroni('34685', '2026-09-24', 0),
        pedroni('34872', '2026-09-25', -1),
        pedroni('36171', '2026-09-26', -2),
      ],
    }
    mockFetch.mockResolvedValue(resposta([AMBIGUO]))
    render(<BoletosDdaTab />)

    expect(await screen.findByText(/34685\/1/)).toBeInTheDocument()
    expect(screen.queryByText(/34872\/1/)).not.toBeInTheDocument()
    const resumo = screen.getByRole('button', { name: /Ver os 3 títulos candidatos/ })
    expect(resumo).toHaveTextContent('+2 títulos · 1 credor · 0 a -2 dias')

    fireEvent.click(resumo)
    expect(await screen.findByRole('dialog')).toHaveTextContent('3 títulos candidatos')
    expect(screen.getByText('34872/1')).toBeInTheDocument()
    expect(screen.getByText('36171/1')).toBeInTheDocument()
  })

  it('sem sincronização ainda, orienta a clicar em "Atualizar DDA"', async () => {
    mockFetch.mockResolvedValue({ boletos: [], janelaDias: 3 })
    render(<BoletosDdaTab />)
    expect(
      await screen.findByText('Clique em "Atualizar DDA" para trazer os boletos do fin124.'),
    ).toBeInTheDocument()
  })
})

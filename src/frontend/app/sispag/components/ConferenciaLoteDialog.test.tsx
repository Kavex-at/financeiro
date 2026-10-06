/** Visão do conferente (ADR-0063, I13l): TED/PIX com destino mascarado, origem e alertas. */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LotePagamento } from '@/lib/sispag'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, conferirLote: jest.fn(), devolverLote: jest.fn() }
})

import { conferirLote, devolverLote } from '@/lib/sispag'
import { ConferenciaLoteDialog } from './ConferenciaLoteDialog'

const lote: LotePagamento = {
  id: 'L1',
  filCod: 4,
  status: 'FINALIZADO',
  criadoPor: 'cron',
  finalizadoPor: 'ana',
  versao: 5,
  exigeConferencia: true,
  itens: [
    {
      loteId: 'L1',
      filCod: 4,
      docCod: '6173',
      titCod: '1',
      credor: 'FORNECEDOR A',
      valor: 1000,
      modalidade: 'TED',
      incluidoPor: 'cron',
      destinoOrigem: 'EXCECAO',
      destinoMascarado: 'banco 001 · ag. 4321 · cc ****7766-5',
      alertas: [
        {
          id: 'A1',
          loteId: 'L1',
          filCod: 4,
          docCod: '6173',
          titCod: '1',
          tipo: 'DUPLICIDADE_FORTE',
          contraparteDocCod: '6702',
          evidencia: {},
          estado: 'RESOLVIDA',
          resolucao: 'JUSTIFICADA',
          justificativa: 'NF de serviço',
          resolvidoPor: 'ana',
          criadoEm: '2026-10-05T10:00:00.000Z',
          verificadoEm: '2026-10-05T10:00:00.000Z',
        },
        {
          id: 'C1',
          loteId: 'L1',
          filCod: 4,
          docCod: '6173',
          titCod: '1',
          tipo: 'CANAL_HABITUAL',
          evidencia: { grupoDominante: 'BOLETO' },
          estado: 'ABERTA',
          criadoEm: '2026-10-05T10:00:00.000Z',
          verificadoEm: '2026-10-05T10:00:00.000Z',
        },
      ],
    },
    {
      loteId: 'L1',
      filCod: 4,
      docCod: '7000',
      titCod: '1',
      credor: 'BOLETEIRO',
      valor: 50,
      modalidade: 'BOLETO',
      incluidoPor: 'cron',
    },
  ],
}

beforeEach(() => jest.clearAllMocks())

const renderDialog = () => {
  const onConcluida = jest.fn()
  render(<ConferenciaLoteDialog lote={lote} onOpenChange={jest.fn()} onConcluida={onConcluida} />)
  return onConcluida
}

describe('ConferenciaLoteDialog', () => {
  it('mostra só os TED/PIX, com destino mascarado, origem, justificativa e canal', () => {
    renderDialog()
    const linhas = within(screen.getByRole('table')).getAllByRole('row')
    expect(linhas).toHaveLength(2) // cabeçalho + 1 TED; o boleto só é contado
    expect(screen.getByText('banco 001 · ag. 4321 · cc ****7766-5')).toBeInTheDocument()
    expect(screen.getByText('exceção')).toBeInTheDocument()
    expect(screen.getByText(/“NF de serviço”/)).toBeInTheDocument()
    expect(screen.getByText(/canal habitual: boleto/)).toBeInTheDocument()
    expect(screen.getByText(/1 boleto\(s\) do lote não passam/)).toBeInTheDocument()
  })

  it('confirmar conferência chama a API com a versão', async () => {
    ;(conferirLote as jest.Mock).mockResolvedValue({ ...lote, conferidoPor: 'bia' })
    const onConcluida = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar conferência' }))
    await waitFor(() => expect(onConcluida).toHaveBeenCalledWith(expect.anything(), 'conferido'))
    expect(conferirLote).toHaveBeenCalledWith('L1', 5)
  })

  it('devolver exige motivo', async () => {
    ;(devolverLote as jest.Mock).mockResolvedValue({ ...lote, status: 'RASCUNHO' })
    const onConcluida = renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Devolver…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Devolver à analista' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Informe o motivo/)
    expect(devolverLote).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Motivo da devolução'), 'conta diverge da NF')
    await userEvent.click(screen.getByRole('button', { name: 'Devolver à analista' }))
    await waitFor(() => expect(onConcluida).toHaveBeenCalledWith(expect.anything(), 'devolvido'))
    expect(devolverLote).toHaveBeenCalledWith('L1', 5, 'conta diverge da NF')
  })

  it('403 do backend (mesma pessoa) aparece em português', async () => {
    ;(conferirLote as jest.Mock).mockRejectedValue(
      new Error('A conferência precisa ser feita por outra pessoa: você finalizou este lote.'),
    )
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar conferência' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/outra pessoa/)
  })
})

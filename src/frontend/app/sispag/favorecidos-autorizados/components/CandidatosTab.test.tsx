/**
 * Relatório de candidatos (ADR-0065, listarCandidatosAutorizacao): read-only, a ação de linha pede
 * (nunca aprova), a linha passa a PENDENTE, seção dos retirados por falta de dado, nenhum destino.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RelatorioCandidatos } from '@/lib/sispag'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, listarCandidatosAutorizacao: jest.fn(), pedirAutorizacao: jest.fn() }
})

import { listarCandidatosAutorizacao, pedirAutorizacao } from '@/lib/sispag'
import { CandidatosTab } from './CandidatosTab'

const relatorio = (over: Partial<RelatorioCandidatos> = {}): RelatorioCandidatos => ({
  candidatos: [
    {
      pesCod: '7001',
      credor: 'ACME',
      grupoDominante: 'TED_PIX',
      participacao: 0.9,
      pagamentos: 10,
      pagamentosTedPix: 9,
      meses: 6,
      confianca: 'ALTA',
      cadastro: { TED: 'SIM', PIX: 'NAO' },
      autorizacao: { TED: { estado: 'NENHUMA' }, PIX: { estado: 'NENHUMA' } },
    },
  ],
  total: 1,
  pagina: 1,
  limite: 20,
  retiradosSemDado: [
    { docCod: '6173', titCod: '1', pesCod: '7003', credor: 'GAMA', ocorridoEm: '2026-10-08T10:00:00.000Z' },
  ],
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(listarCandidatosAutorizacao as jest.Mock).mockResolvedValue(relatorio())
})

describe('CandidatosTab', () => {
  it('mostra perfil, cadastro e estado por modalidade, e os retirados por falta de dado', async () => {
    render(<CandidatosTab podePedir />)
    const t = within(await screen.findByRole('table', { name: /candidatos à autorização/i }))
    expect(t.getByText('ACME')).toBeInTheDocument()
    expect(t.getByText('90%')).toBeInTheDocument()
    expect(t.getByText('9 de 10')).toBeInTheDocument()
    const ret = within(screen.getByRole('table', { name: /retirados por falta de dado/i }))
    expect(ret.getByText('6173/1')).toBeInTheDocument()
    expect(ret.getByText(/GAMA/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /aprovar/i })).not.toBeInTheDocument()
  })

  it('"Pedir autorização" cria PENDENTE com origem RELATORIO e a linha passa a mostrar Pendente', async () => {
    ;(pedirAutorizacao as jest.Mock).mockResolvedValue({ id: 'A9', estado: 'PENDENTE' })
    render(<CandidatosTab podePedir />)
    await userEvent.click(await screen.findByRole('button', { name: /pedir autorização TED para ACME/i }))
    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(within(dialogo).getByRole('button', { name: /^pedir autorização$/i }))
    await waitFor(() =>
      expect(pedirAutorizacao).toHaveBeenCalledWith({
        pesCod: '7001',
        credor: 'ACME',
        modalidade: 'TED',
        origem: 'RELATORIO',
        filCod: 1,
      }),
    )
    const t = within(screen.getByRole('table', { name: /candidatos à autorização/i }))
    expect(await t.findByText('TED: Pendente')).toBeInTheDocument()
    expect(t.queryByRole('button', { name: /pedir autorização TED para ACME/i })).not.toBeInTheDocument()
  })

  it('sem sispag:executar não há ação de linha', async () => {
    render(<CandidatosTab podePedir={false} />)
    await screen.findByRole('table', { name: /candidatos à autorização/i })
    expect(screen.queryByRole('button', { name: /pedir autorização/i })).not.toBeInTheDocument()
  })

  it('paginação pede a próxima página', async () => {
    ;(listarCandidatosAutorizacao as jest.Mock).mockResolvedValue(relatorio({ total: 120 }))
    render(<CandidatosTab podePedir />)
    await userEvent.click(await screen.findByRole('button', { name: /próxima página/i }))
    await waitFor(() =>
      expect(listarCandidatosAutorizacao).toHaveBeenLastCalledWith({ pagina: 2, limite: 20 }),
    )
  })
})

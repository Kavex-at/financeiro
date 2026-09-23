import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SispagPage from '@/app/sispag/page'
import { fetchLotes, type LotePagamento, type SispagPainel } from '@/lib/sispag'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))

const painel: SispagPainel = {
  geradoEm: '2026-09-23T14:00:00.000Z',
  modo: { somenteLeitura: true, conexosWriteEnabled: false, conexosDryRun: true },
  ingestao: {},
  kpis: {
    titulosAVencer7d: 0,
    titulosAVencer30d: 0,
    titulosVencidos: 0,
    valorAVencer30d: 0,
    lotesAbertos: 0,
    lotesEnviados: 0,
  },
  titulos: [],
  lotes: [],
}

const loteRascunho: LotePagamento = {
  id: 'lote-1',
  filCod: 1,
  banco: '341',
  conta: '12345',
  status: 'RASCUNHO',
  criadoPor: 'analista',
  versao: 1,
  criadoEm: '2026-09-23T13:00:00.000Z',
  automatico: true,
  itens: [],
} as unknown as LotePagamento

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchSispagPainel: jest.fn(),
    fetchLotes: jest.fn(),
  }
})

/**
 * Incidente 2026-09-23: `GET /sispag/lotes` quebrou (coluna da migração 0061 ainda ausente em
 * produção) e a tela mostrou "Lotes candidatos (0)" / "Nenhum lote candidato" — o erro era
 * engolido por um `.catch(() => [])`. Falha do endpoint tem de parecer falha, não lista vazia.
 */
describe('SispagPage — falha ao carregar os lotes', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue(painel)
    // `mockReset` e não `clearAllMocks`: um `mockResolvedValueOnce` não consumido vazaria.
    lib.fetchLotes.mockReset()
  })

  const renderPainel = async () => {
    await act(async () => {
      render(<SispagPage />)
    })
  }

  it('mostra erro nas abas de lotes em vez de "Nenhum lote candidato"', async () => {
    ;(fetchLotes as jest.Mock).mockRejectedValue(new Error('column "data_debito" does not exist'))
    const user = userEvent.setup()
    await renderPainel()

    // O painel (títulos) continua de pé: a falha é só dos lotes.
    expect(screen.getByRole('tab', { name: 'Títulos a pagar' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lotes candidatos (—)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Finalizados (—)' })).toBeInTheDocument()
    expect(screen.getByText('não foi possível carregar')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (—)' }))
    const alerta = screen.getByRole('alert')
    expect(within(alerta).getByText('Não foi possível carregar os lotes')).toBeInTheDocument()
    expect(within(alerta).getByText(/data_debito/)).toBeInTheDocument()
    expect(screen.queryByText('Nenhum lote candidato')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Finalizados (—)' }))
    expect(within(screen.getByRole('alert')).getByText(/data_debito/)).toBeInTheDocument()
    expect(screen.queryByText('Nenhum lote finalizado')).not.toBeInTheDocument()
  })

  it('"Tentar de novo" recarrega e, se o endpoint voltou, mostra os lotes', async () => {
    ;(fetchLotes as jest.Mock)
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce([loteRascunho])
    const user = userEvent.setup()
    await renderPainel()

    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (—)' }))
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lotes candidatos (1)' })).toBeInTheDocument()
  })

  it('lista vazia de verdade continua sendo "Nenhum lote candidato"', async () => {
    ;(fetchLotes as jest.Mock).mockResolvedValue([])
    const user = userEvent.setup()
    await renderPainel()

    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (0)' }))
    expect(screen.getByText('Nenhum lote candidato')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

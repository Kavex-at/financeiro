import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SispagPage from '@/app/sispag/page'
import {
  type ArquivoRetorno,
  conciliarRetorno,
  fetchLotes,
  fetchRetornos,
  type LotePagamento,
  type SispagPainel,
} from '@/lib/sispag'

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
    fetchRetornos: jest.fn(),
    conciliarRetorno: jest.fn(),
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

/**
 * "Processar e conciliar" manda o Conexos parsear o .RET e GRAVAR AS BAIXAS no fin010. Disparava
 * no primeiro clique; agora pede confirmação nomeando o arquivo, o banco e a filial.
 */
describe('SispagPage — Processar e conciliar pede confirmação', () => {
  const retorno: ArquivoRetorno = {
    filCod: 7,
    bncCod: 341,
    gtbCodSeq: 2,
    garCodSeq: 55,
    arquivo: 'PG280901.RET',
    banco: 'Itaú',
    configNome: 'SISPAG',
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue(painel)
    lib.fetchLotes.mockReset()
    lib.fetchLotes.mockResolvedValue([])
    ;(fetchRetornos as jest.Mock).mockReset()
    ;(fetchRetornos as jest.Mock).mockResolvedValue([retorno])
    ;(conciliarRetorno as jest.Mock).mockReset()
    ;(conciliarRetorno as jest.Mock).mockResolvedValue({
      dryRun: false,
      totalLinhas: 1,
      pagos: 1,
      rejeitados: 0,
      naoReconhecidos: 0,
    })
  })

  const abrirRetornos = async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<SispagPage />)
    })
    await user.click(screen.getByRole('tab', { name: 'Retorno Lote (RET) - Conexos' }))
    await user.click(screen.getByRole('button', { name: 'Carregar retornos' }))
    await user.click(await screen.findByRole('button', { name: 'Processar e conciliar' }))
    return user
  }

  it('o clique abre a confirmação com o arquivo e NÃO chama o ERP', async () => {
    await abrirRetornos()

    const dialog = screen.getByRole('dialog', { name: 'Processar o retorno PG280901.RET' })
    expect(within(dialog).getByText('Itaú · SISPAG · filial 7')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('gravar as baixas')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('fin010')
    expect(conciliarRetorno).not.toHaveBeenCalled()
  })

  it('"Voltar" fecha sem processar', async () => {
    const user = await abrirRetornos()

    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(conciliarRetorno).not.toHaveBeenCalled()
  })

  it('confirmar processa exatamente o arquivo escolhido, com processar=true', async () => {
    const user = await abrirRetornos()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Processar e conciliar' }))

    expect(conciliarRetorno).toHaveBeenCalledTimes(1)
    expect(conciliarRetorno).toHaveBeenCalledWith({
      filCod: 7,
      bncCod: 341,
      gtbCodSeq: 2,
      garCodSeq: 55,
      processar: true,
    })
  })

  it('"Conciliar" (só leitura) segue sem confirmação', async () => {
    const user = await abrirRetornos()
    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    await user.click(screen.getByRole('button', { name: 'Conciliar' }))

    expect(conciliarRetorno).toHaveBeenCalledWith(expect.objectContaining({ processar: false }))
  })
})

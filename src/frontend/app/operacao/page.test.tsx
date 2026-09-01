import { act, render, screen } from '@testing-library/react'
import OperacaoPage from '@/app/operacao/page'
import { type OperacaoPainel, fetchOperacao } from '@/lib/operacao'

const painelFake: OperacaoPainel = {
  geradoEm: '2026-09-01T12:00:00.000Z',
  pipelines: [
    {
      pipeline: 'recebimentos-extratos',
      rotulo: 'Recebimentos — ingestão de extratos',
      cadencia: '20 * * * *',
      limiteStalenessMs: 10_800_000,
      idadeDesdeUltimoSucessoMs: 3_600_000,
      ultimoSucessoEm: '2026-09-01T11:00:00.000Z',
      situacao: 'ok',
      distinguePartial: true,
      runsRecentes: [],
      ultimaRun: {
        runId: 'r1',
        pipeline: 'recebimentos-extratos',
        status: 'success',
        triggeredBy: 'cron',
        startedAt: '2026-09-01T11:20:00.000Z',
        finishedAt: '2026-09-01T11:20:30.000Z',
        duracaoMs: 30_000,
        metricas: { lidas: 100, inseridas: 8 },
      },
    },
    {
      pipeline: 'sispag-pagamentos',
      rotulo: 'SISPAG — ingestão de pagamentos',
      cadencia: '0 10 * * *',
      limiteStalenessMs: 108_000_000,
      situacao: 'parado',
      idadeDesdeUltimoSucessoMs: 200_000_000,
      distinguePartial: false,
      runsRecentes: [],
    },
    {
      pipeline: 'sispag-reaper',
      rotulo: 'SISPAG — reaper de reconciliação',
      cadencia: '10,25,40,55 * * * *',
      situacao: 'sem-trilha',
      distinguePartial: false,
      runsRecentes: [],
    },
  ],
  alertas: [
    {
      id: 1,
      tipo: 'job-parado',
      alvo: 'sispag-pagamentos',
      severidade: 'erro',
      detalhe: { erro: 'sem sucesso em 55h' },
      criadoEm: '2026-09-01T11:45:00.000Z',
    },
  ],
  configuracao: {
    geradoEm: '2026-09-01T12:00:00.000Z',
    vars: [
      {
        nome: 'RECEBIMENTO_TITULARES_INTERNOS',
        frente: 'recebimentos',
        criticidade: 'degrada-silenciosamente',
        estado: 'ausente',
        consequenciaSeAusente: 'A detecção de transferência interna nunca dispara.',
        segredo: false,
      },
      {
        nome: 'CONEXOS_PASSWORD',
        frente: 'núcleo',
        criticidade: 'obrigatoria',
        estado: 'configurado',
        consequenciaSeAusente: 'Nenhuma leitura nem escrita no ERP.',
        segredo: true,
      },
    ],
    totalAusentesObrigatorias: 0,
    totalAusentesSilenciosas: 1,
  },
}

jest.mock('@/lib/operacao', () => {
  const real = jest.requireActual('@/lib/operacao')
  return { ...real, fetchOperacao: jest.fn(), reconhecerAlerta: jest.fn() }
})

const renderPainel = async () => {
  await act(async () => {
    render(<OperacaoPage />)
  })
}

describe('OperacaoPage', () => {
  beforeEach(() => {
    ;(fetchOperacao as jest.Mock).mockResolvedValue(painelFake)
  })

  it('mostra o título e o subtítulo que declara a independência do ERP', async () => {
    await renderPainel()
    expect(screen.getByText('Operação')).toBeInTheDocument()
    expect(screen.getByText(/não depende do erp/i)).toBeInTheDocument()
  })

  it('LISTA o pipeline sem trilha em vez de omiti-lo', async () => {
    await renderPainel()
    expect(screen.getByText('SISPAG — reaper de reconciliação')).toBeInTheDocument()
    expect(screen.getByText('Sem trilha')).toBeInTheDocument()
    expect(screen.getByText('não registra execução')).toBeInTheDocument()
  })

  it('marca a fonte que não distingue execução parcial', async () => {
    await renderPainel()
    // O SISPAG fecha `success` mesmo com filial falhada — a tela precisa dizer isso,
    // senão a ausência de `partial` é lida como ausência de problema.
    expect(screen.getByText('(não distingue parcial)')).toBeInTheDocument()
  })

  it('conta pipelines parados e sem visibilidade nos KPIs', async () => {
    await renderPainel()
    expect(screen.getByText('Pipelines parados')).toBeInTheDocument()
    expect(screen.getByText('Sem visibilidade')).toBeInTheDocument()
  })

  it('quando a leitura falha, diz que falhou — não finge saúde', async () => {
    ;(fetchOperacao as jest.Mock).mockRejectedValue(new Error('backend fora'))
    await renderPainel()

    expect(screen.getByText('Não foi possível carregar')).toBeInTheDocument()
    expect(screen.getByText('backend fora')).toBeInTheDocument()
    // O ponto: nenhum KPI verde aparece para encobrir a falha.
    expect(screen.queryByText('Pipelines parados')).not.toBeInTheDocument()
  })
})

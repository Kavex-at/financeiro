import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    modoAutenticacao: 'supabase',
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

  it('a aba Configuração diz o modo de autenticação em vigor (AUTH_PROVIDER), sem segredo', async () => {
    await renderPainel()
    await userEvent.click(screen.getByRole('tab', { name: /Configuração/ }))
    const modo = await screen.findByTestId('modo-autenticacao')
    expect(modo).toHaveTextContent('Supabase Auth')
    expect(modo).toHaveTextContent('AUTH_PROVIDER')
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

/**
 * Desde a v0.42.5 o `GET /operacao` usa `allSettled`: a fonte que falha volta VAZIA (HTTP 200) e é
 * nomeada em `erros[]`. Sem ler `erros`, a tela de incidente mostrava "0 alertas" com a leitura
 * dos alertas quebrada.
 */
describe('OperacaoPage — fonte que falhou não vira zero', () => {
  const comFalha = (over: Partial<OperacaoPainel>): OperacaoPainel => ({ ...painelFake, ...over })

  it('alertas ilegíveis: "—" no KPI e na aba, e a aba diz que falhou', async () => {
    ;(fetchOperacao as jest.Mock).mockResolvedValue(
      comFalha({
        alertas: [],
        erros: [{ fonte: 'alertas', mensagem: 'Não foi possível ler os alertas abertos.' }],
      }),
    )
    await renderPainel()

    const banner = screen.getAllByRole('alert')[0]
    expect(within(banner).getByText(/não significam zero/)).toBeInTheDocument()
    expect(within(banner).getByText('Não foi possível ler os alertas abertos.')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Alertas \(—\)/ })).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /Alertas/ }))
    expect(screen.getByText('Não foi possível ler esta parte do painel')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum alerta aberto')).not.toBeInTheDocument()
    // As outras fontes seguem de pé.
    expect(screen.getByRole('tab', { name: /Pipelines \(3\)/ })).toBeInTheDocument()
  })

  it('pipelines ilegíveis: os KPIs derivados deles não aparecem como 0 verde', async () => {
    ;(fetchOperacao as jest.Mock).mockResolvedValue(
      comFalha({
        pipelines: [],
        erros: [{ fonte: 'pipelines', mensagem: 'Não foi possível ler a saúde dos pipelines.' }],
      }),
    )
    await renderPainel()

    expect(screen.getByRole('tab', { name: /Pipelines \(—\)/ })).toBeInTheDocument()
    expect(screen.getAllByText('não foi possível ler')).toHaveLength(2)
    expect(screen.queryByText('sem sucesso dentro do limite')).not.toBeInTheDocument()
    expect(screen.getByText('Não foi possível ler esta parte do painel')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: 'Saúde dos pipelines' })).not.toBeInTheDocument()
  })

  it('sem `erros` (ou vazio) nada muda: nenhum banner', async () => {
    ;(fetchOperacao as jest.Mock).mockResolvedValue(comFalha({ erros: [] }))
    await renderPainel()

    expect(screen.queryByText(/não significam zero/)).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Alertas \(1\)/ })).toBeInTheDocument()
  })
})

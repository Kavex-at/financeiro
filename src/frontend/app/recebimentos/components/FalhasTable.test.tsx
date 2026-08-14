import { act, render, screen } from '@testing-library/react'
import { FalhasTable } from '@/app/recebimentos/components/FalhasTable'
import { fetchPainelRecebimentos, type TransacaoBancaria } from '@/lib/recebimentos'

jest.mock('@/lib/recebimentos', () => {
  const real = jest.requireActual('@/lib/recebimentos')
  return { ...real, fetchPainelRecebimentos: jest.fn() }
})

const mockPainel = (transacoes: Partial<TransacaoBancaria>[]) => {
  ;(fetchPainelRecebimentos as jest.Mock).mockResolvedValue({
    fonte: 'banco',
    geradoEm: '2026-08-13T00:00:00.000Z',
    kpis: {
      importadas: 0,
      conciliadas: 0,
      parciais: 0,
      filaManual: 0,
      erro: transacoes.length,
      processadas: 0,
      valorNaoAlocado: 0,
      ndePendentes: 0,
    },
    transacoes,
    recebimentos: [],
    ndes: [],
  })
}

const falhaRegistrada: Partial<TransacaoBancaria> = {
  id: 'txn-a',
  correlationId: 'corr-a',
  filCod: 4,
  dataMovimento: '2026-08-01T00:00:00.000Z',
  tipo: 'CREDITO',
  valor: 21750,
  moeda: 'BRL',
  contraparte: 'GRUPO MERIDIAN',
  naturalKey: 'nk-a',
  status: 'erro',
  importadoEm: '2026-08-01T00:00:00.000Z',
  ultimaFalha: {
    priCod: 90004,
    valor: 21750,
    etapa: 'fin014',
    mensagem: 'Título já baixado no Conexos.',
    ocorridaEm: '2026-08-01T10:00:00.000Z',
    executadoPor: 'yuri',
    interrompida: false,
  },
}

const falhaInterrompida: Partial<TransacaoBancaria> = {
  ...falhaRegistrada,
  id: 'txn-b',
  correlationId: 'corr-b',
  contraparte: 'ATUAL T P L',
  naturalKey: 'nk-b',
  ultimaFalha: {
    priCod: 90006,
    etapa: 'sn',
    docCod: 18390,
    ocorridaEm: '2026-08-01T11:00:00.000Z',
    interrompida: true,
  },
}

const renderTabela = async (props: Parameters<typeof FalhasTable>[0] = {}) => {
  await act(async () => {
    render(<FalhasTable {...props} />)
  })
}

describe('FalhasTable (ADR-0034)', () => {
  afterEach(() => jest.clearAllMocks())

  it('busca só as execuções com erro, no servidor', async () => {
    mockPainel([falhaRegistrada])
    await renderTabela()

    // Busca própria e não filtro da lista já carregada: o painel corta em 500 linhas por data
    // decrescente, então uma falha antiga ficaria fora justamente da aba feita para mostrá-la.
    expect(fetchPainelRecebimentos).toHaveBeenCalledWith({ status: 'erro' })
  })

  it('mostra etapa, mensagem amigável e quem executou', async () => {
    mockPainel([falhaRegistrada])
    await renderTabela()

    expect(screen.getByText('fin014')).toBeInTheDocument()
    expect(screen.getByText('Título já baixado no Conexos.')).toBeInTheDocument()
    expect(screen.getByText('yuri')).toBeInTheDocument()
  })

  it('rotula execução interrompida à parte e avisa do documento órfão', async () => {
    mockPainel([falhaInterrompida])
    await renderTabela()

    expect(screen.getByText('interrompida')).toBeInTheDocument()
    expect(screen.getByText(/documento 18390 pode ter ficado órfão/)).toBeInTheDocument()
    // O aviso de topo é o que faz o analista conferir o ERP antes de reprocessar às cegas.
    expect(screen.getByText(/execução\(ões\) interrompida\(s\) no meio/)).toBeInTheDocument()
  })

  it('sem interrompidas, não mostra o aviso de documento órfão', async () => {
    mockPainel([falhaRegistrada])
    await renderTabela()
    expect(screen.queryByText(/interrompida\(s\) no meio/)).not.toBeInTheDocument()
  })

  it('estado vazio quando nada falhou', async () => {
    mockPainel([])
    await renderTabela()
    expect(screen.getByText('Nenhuma falha')).toBeInTheDocument()
  })

  it('erro de carregamento oferece tentar de novo, sem inventar lista vazia', async () => {
    ;(fetchPainelRecebimentos as jest.Mock).mockRejectedValue(new Error('API 500'))
    await renderTabela()

    expect(screen.getByText('Não foi possível carregar as falhas')).toBeInTheDocument()
    expect(screen.getByText('API 500')).toBeInTheDocument()
    expect(screen.queryByText('Nenhuma falha')).not.toBeInTheDocument()
  })

  it('oferece "Tentar de novo" por linha quando há handler', async () => {
    mockPainel([falhaRegistrada])
    await renderTabela({ onAlocar: jest.fn() })
    expect(screen.getByRole('button', { name: /Tentar de novo a alocação/ })).toBeInTheDocument()
  })
})

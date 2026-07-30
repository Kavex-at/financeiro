import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AlocarProcessosDialog,
  sugerirCliente,
} from '@/app/recebimentos/components/AlocarProcessosDialog'
import type { Processo, SolicitacaoNumerarioDryRun, TransacaoBancaria } from '@/lib/recebimentos'

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

import { toast } from 'sonner'

jest.mock('@/lib/recebimentos', () => {
  const actual = jest.requireActual('@/lib/recebimentos')
  return {
    ...actual,
    fetchClientesDaFilial: jest.fn(),
    fetchProcessosParaTransacao: jest.fn(),
    processarSolicitacaoNumerario: jest.fn(),
  }
})

import {
  fetchClientesDaFilial,
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
} from '@/lib/recebimentos'

const mockClientes = fetchClientesDaFilial as jest.MockedFunction<typeof fetchClientesDaFilial>
const mockFetch = fetchProcessosParaTransacao as jest.MockedFunction<
  typeof fetchProcessosParaTransacao
>
const mockProcessar = processarSolicitacaoNumerario as jest.MockedFunction<
  typeof processarSolicitacaoNumerario
>

const transacao: TransacaoBancaria = {
  id: 'txn-0001',
  correlationId: 'corr-0001',
  filCod: 4,
  dataMovimento: '2026-07-20T15:00:00.000Z',
  tipo: 'CREDITO',
  valor: 15000,
  moeda: 'BRL',
  contraparte: 'CLIENTE EXEMPLO LTDA',
  naturalKey: 'k',
  status: 'importada',
  importadoEm: '2026-07-20T15:05:00.000Z',
}

const processo: Processo = {
  priCod: 90001,
  priEspRefcliente: 'REF-CLI-0001',
  filCod: 4,
  pesCod: 555,
  dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
  moeCod: 790,
  valor: 15000,
  contraparte: 'CLIENTE EXEMPLO LTDA',
}

const dryRunResult: SolicitacaoNumerarioDryRun = {
  dryRun: true,
  docConfig: { gcdCod: 0, gcdDesNome: 'Solicitação de Numerário - Encomenda' },
  payload: {
    filCod: 4,
    docTip: 'SN',
    docVldTipo: 'SN',
    priCod: 90001,
    priEspRefcliente: 'REF-CLI-0001',
    pesCod: 555,
    dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
    gcdCod: 0,
    gcdDesNome: 'Solicitação de Numerário - Encomenda',
    docDtaEmissao: '2026-07-28T12:00:00.000Z',
    dtaVencimento: '2026-07-28T12:00:00.000Z',
    valor: 15000,
    moeCod: 790,
    items: [
      {
        prjCod: 0,
        ctpCod: 0,
        tmpMnyValor: 15000,
        ctpDesNome: 'Solicitação de Numerário - Encomenda',
        tpcCod: 0,
        cfoEspCod: 0,
        total: 15000,
      },
    ],
  },
}

const clientes = [
  { pesCod: 555, dpeNomPessoa: 'CLIENTE EXEMPLO LTDA', processosAbertos: 2 },
  { pesCod: 676, dpeNomPessoa: 'BELLIZ INDUSTRIA, COMERCIO, IMPORTA', processosAbertos: 24 },
]

describe('AlocarProcessosDialog', () => {
  beforeEach(() => {
    mockClientes.mockResolvedValue(clientes)
    mockFetch.mockResolvedValue([processo])
  })
  afterEach(() => jest.clearAllMocks())

  it('pré-seleciona o cliente pelo histórico do extrato e já lista os processos dele', async () => {
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    // "CLIENTE EXEMPLO LTDA" bate por prefixo com o histórico da transação.
    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith('txn-0001', 4, 555),
    )
    expect(await screen.findByText('90001')).toBeInTheDocument()
  })

  it('sem cliente escolhido NÃO busca processos e explica o porquê', async () => {
    // Histórico que não casa com nenhum cliente → nenhuma pré-seleção.
    mockClientes.mockResolvedValue([
      { pesCod: 999, dpeNomPessoa: 'OUTRA EMPRESA SA', processosAbertos: 1 },
    ])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    expect(await screen.findByText('Escolha o cliente')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('exibe o histórico do banco como dica, avisando do truncamento', async () => {
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    expect(await screen.findByText(/o banco trunca o texto/i)).toBeInTheDocument()
  })

  it('trocar o cliente refaz a busca de processos', async () => {
    const user = userEvent.setup()
    mockClientes.mockResolvedValue([
      { pesCod: 999, dpeNomPessoa: 'OUTRA EMPRESA SA', processosAbertos: 1 },
      { pesCod: 676, dpeNomPessoa: 'BELLIZ INDUSTRIA', processosAbertos: 24 },
    ])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByLabelText('Cliente do recebimento'))
    await user.click(await screen.findByText('BELLIZ INDUSTRIA'))

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('txn-0001', 4, 676))
  })

  it('Processar gera a simulação dry-run e marca a linha', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue(dryRunResult)
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))

    expect(mockProcessar).toHaveBeenCalledWith('txn-0001', processo, 15000)
    expect(await screen.findByText('processado (simulação)')).toBeInTheDocument()
    // Resumo legível, não JSON: o analista não lê `gcdDesNome`.
    expect(await screen.findByText('Solicitação de Numerário - Encomenda')).toBeInTheDocument()
  })

  it('avisa que o documento ainda não é válido e lista os placeholders', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue(dryRunResult)
    // `gcdCod: 0` no dryRunResult é o placeholder não confirmado no ERP.
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))

    expect(await screen.findByText(/ainda não é um documento válido/i)).toBeInTheDocument()
    expect(screen.getByText(/gcdCod\) ainda não confirmado/i)).toBeInTheDocument()
    expect(screen.getByText(/percentual da encomenda não está definido/i)).toBeInTheDocument()
  })

  it('o JSON técnico nasce FECHADO e abre sob demanda', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue(dryRunResult)
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))
    expect(screen.queryByText(/"priCod": 90001/)).not.toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: /ver payload técnico/i }))
    expect(await screen.findByText(/"priCod": 90001/)).toBeInTheDocument()
  })

  it('falha do backend vira toast de erro — NUNCA payload inventado localmente', async () => {
    const user = userEvent.setup()
    mockProcessar.mockRejectedValue(new Error('API 500'))
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByText('processado (simulação)')).not.toBeInTheDocument()
  })

  it('cliente sem processo aberto mostra estado próprio', async () => {
    mockFetch.mockResolvedValue([])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    expect(await screen.findByText('Nenhum processo aberto')).toBeInTheDocument()
  })
})

describe('sugerirCliente', () => {
  it('casa por prefixo apesar do truncamento do banco', () => {
    const lista = [
      { pesCod: 676, dpeNomPessoa: 'BELLIZ INDUSTRIA, COMERCIO, IMPORTA', processosAbertos: 24 },
      { pesCod: 5, dpeNomPessoa: 'COLUMBIA TRADING S/A', processosAbertos: 21 },
    ]
    expect(sugerirCliente(lista, 'BELLIZ INDUSTRIA')).toBe(676)
    expect(sugerirCliente(lista, 'BROWN-FORMA')).toBeNull()
  })

  it('não sugere nada com histórico curto ou ausente — palpite ruim é pior que nenhum', () => {
    const lista = [{ pesCod: 1, dpeNomPessoa: 'ACME LTDA', processosAbertos: 1 }]
    expect(sugerirCliente(lista, 'TED')).toBeNull()
    expect(sugerirCliente(lista, undefined)).toBeNull()
  })
})

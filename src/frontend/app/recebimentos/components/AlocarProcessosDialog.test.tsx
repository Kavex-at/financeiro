import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AlocarProcessosDialog,
  sugerirCliente,
} from '@/app/recebimentos/components/AlocarProcessosDialog'
import type { AlocacaoResultado, Processo, TransacaoBancaria } from '@/lib/recebimentos'

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

import { toast } from 'sonner'

jest.mock('@/lib/recebimentos', () => {
  const actual = jest.requireActual('@/lib/recebimentos')
  return {
    ...actual,
    fetchClientes: jest.fn(),
    fetchProcessosParaTransacao: jest.fn(),
    processarSolicitacaoNumerario: jest.fn(),
  }
})

import {
  fetchClientes,
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
} from '@/lib/recebimentos'

const mockClientes = fetchClientes as jest.MockedFunction<typeof fetchClientes>
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
  gerNum: 88,
  importadoEm: '2026-07-20T15:05:00.000Z',
}

const processo: Processo = {
  priCod: 90001,
  priEspRefcliente: 'REF-CLI-0001',
  // Filial DO PROCESSO diferente da do pagamento (transação é filial 4) — prova que o
  // "Processar" manda a filial do processo, não a da transação.
  filCod: 7,
  pesCod: 555,
  dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
  moeCod: 790,
  valor: 15000,
  contraparte: 'CLIENTE EXEMPLO LTDA',
}

const settledResult: AlocacaoResultado = {
  status: 'settled',
  snDocCod: 18202,
  borCod: 771,
  ndDocCod: 18337,
  ndeAutorizado: true,
  dryRun: false,
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
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('txn-0001', 555))
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

  it('avisa que é uma ação real (não simulação)', async () => {
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    expect(await screen.findByText(/não é simulação/i)).toBeInTheDocument()
    expect(screen.getByText(/gera SN, baixa/i)).toBeInTheDocument()
  })

  it('mostra a conta financeira (gerNum) no cabeçalho', async () => {
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    expect(await screen.findByText(/conta financeira/i)).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
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

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('txn-0001', 676))
  })

  it('o valor da linha é editável e nasce mascarado (default = valor do processo)', async () => {
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    const input = (await screen.findByLabelText(
      /valor a alocar no processo 90001/i,
    )) as HTMLInputElement
    expect(input.value).toBe('15.000,00')

    const user = userEvent.setup()
    await user.clear(input)
    await user.type(input, '500000')
    expect(input.value).toBe('5.000,00')
  })

  it('"Máx" preenche o saldo restante', async () => {
    const user = userEvent.setup()
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    const input = (await screen.findByLabelText(
      /valor a alocar no processo 90001/i,
    )) as HTMLInputElement
    await user.clear(input)
    await user.type(input, '100')

    await user.click(screen.getByRole('button', { name: /máx/i }))
    expect(input.value).toBe('15.000,00')
  })

  it('Processar fica desabilitado quando o valor excede o saldo', async () => {
    const user = userEvent.setup()
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    const input = await screen.findByLabelText(/valor a alocar no processo 90001/i)
    await user.clear(input)
    await user.type(input, '2000000') // 20.000,00 > 15.000,00 saldo
    expect(screen.getByRole('button', { name: /processar/i })).toBeDisabled()
  })

  it('Processar fica desabilitado quando o valor é zero', async () => {
    const user = userEvent.setup()
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    const input = await screen.findByLabelText(/valor a alocar no processo 90001/i)
    await user.clear(input)
    await user.type(input, '0')
    expect(screen.getByRole('button', { name: /processar/i })).toBeDisabled()
  })

  it('sem gerNum: bloqueia Processar e avisa', async () => {
    const semConta = { ...transacao, gerNum: undefined }
    render(<AlocarProcessosDialog transacao={semConta} open onOpenChange={() => {}} />)
    expect(await screen.findByText(/sem conta financeira/i)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /processar/i })).toBeDisabled()
  })

  it('Processar roda a alocação REAL e, ao quitar, mostra "Quitado" + docCods e decrementa o saldo', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue(settledResult)
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    // Aloca 5.000 (split) para deixar saldo restante conferível.
    const input = await screen.findByLabelText(/valor a alocar no processo 90001/i)
    await user.clear(input)
    await user.type(input, '500000') // 5.000,00
    await user.click(screen.getByRole('button', { name: /processar/i }))

    expect(mockProcessar).toHaveBeenCalledWith('txn-0001', {
      priCod: 90001,
      valor: 5000,
      // Filial DO PROCESSO (7), não a da transação (4).
      filCod: 7,
      priEspRefcliente: 'REF-CLI-0001',
      pesCod: 555,
      dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
      moeCod: 790,
    })

    expect(await screen.findByText('Quitado')).toBeInTheDocument()
    expect(screen.getByText('18202')).toBeInTheDocument() // SN docCod
    expect(screen.getByText('771')).toBeInTheDocument() // borderô
    expect(screen.getByText('18337')).toBeInTheDocument() // NDe docCod
    // saldo: 15.000 − 5.000 = 10.000
    expect(await screen.findByText(/Saldo a alocar/i)).toHaveTextContent('10.000,00')
  })

  it('status error renderiza badge de perigo nomeando a etapa', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue({
      status: 'error',
      etapa: 'fin014',
      erro: 'baixa recusada pelo Conexos',
      dryRun: false,
    })
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))

    expect(await screen.findByText(/Falhou em fin014/i)).toBeInTheDocument()
    expect(screen.getByText(/baixa recusada pelo Conexos/i)).toBeInTheDocument()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })

  it('revisaoHumana renderiza "revisão pendente"', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue({ ...settledResult, revisaoHumana: true })
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))
    expect(await screen.findByText(/revisão pendente/i)).toBeInTheDocument()
  })

  it('vldAutorizado===0 renderiza "Aguardando autorização SEFAZ" (não é falha)', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue({ ...settledResult, ndeAutorizado: false, vldAutorizado: 0 })
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))
    expect(await screen.findByText('Quitado')).toBeInTheDocument()
    expect(screen.getByText(/Aguardando autorização SEFAZ/i)).toBeInTheDocument()
  })

  it('rejeição do backend vira toast de erro — NUNCA sucesso inventado', async () => {
    const user = userEvent.setup()
    mockProcessar.mockRejectedValue(new Error('API 500'))
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await user.click(await screen.findByRole('button', { name: /processar/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByText('Quitado')).not.toBeInTheDocument()
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

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AlocarProcessosDialog,
  sugerirCliente,
} from '@/app/recebimentos/components/AlocarProcessosDialog'
import type {
  AlocacaoResultado,
  Processo,
  SolicitacaoNumerarioListItem,
  TransacaoBancaria,
} from '@/lib/recebimentos'

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
    fetchSNsDoProcesso: jest.fn(),
    processarSolicitacaoNumerario: jest.fn(),
  }
})

import {
  fetchClientes,
  fetchProcessosParaTransacao,
  fetchSNsDoProcesso,
  processarSolicitacaoNumerario,
} from '@/lib/recebimentos'

const mockClientes = fetchClientes as jest.MockedFunction<typeof fetchClientes>
const mockFetch = fetchProcessosParaTransacao as jest.MockedFunction<
  typeof fetchProcessosParaTransacao
>
const mockFetchSNs = fetchSNsDoProcesso as jest.MockedFunction<typeof fetchSNsDoProcesso>
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

const snExistente: SolicitacaoNumerarioListItem = {
  docCod: 18202,
  numero: '731',
  data: '2026-08-03T00:00:00.000Z',
  descricao: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA',
  status: 3,
  statusLabel: 'Finalizada',
  solicitado: 15000,
  valor: 15000,
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

/** Seleciona o processo à esquerda (radio) e espera o painel de SN carregar. */
const selecionarProcesso = async (user: ReturnType<typeof userEvent.setup>) => {
  const radio = await screen.findByLabelText(/Processo 90001/i)
  await user.click(radio)
}

describe('AlocarProcessosDialog', () => {
  beforeEach(() => {
    mockClientes.mockResolvedValue(clientes)
    mockFetch.mockResolvedValue([processo])
    mockFetchSNs.mockResolvedValue([])
  })
  afterEach(() => jest.clearAllMocks())

  it('pré-seleciona o cliente pelo histórico do extrato e já lista os processos dele', async () => {
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    // "CLIENTE EXEMPLO LTDA" bate por prefixo com o histórico da transação.
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('txn-0001', 555))
    expect(await screen.findByText('90001')).toBeInTheDocument()
  })

  it('sem cliente escolhido NÃO busca processos e explica o porquê', async () => {
    mockClientes.mockResolvedValue([
      { pesCod: 999, dpeNomPessoa: 'OUTRA EMPRESA SA', processosAbertos: 1 },
    ])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    expect(await screen.findByText('Escolha o cliente')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
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

  it('antes de escolher um processo, o painel direito pede a seleção', async () => {
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    expect(await screen.findByText('Selecione um processo')).toBeInTheDocument()
  })

  it('selecionar um processo busca e lista as SN dele + a opção "Criar novo SN"', async () => {
    const user = userEvent.setup()
    mockFetchSNs.mockResolvedValue([snExistente])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)

    // Busca as SN pela filial DO PROCESSO (7), não a da transação (4).
    await waitFor(() => expect(mockFetchSNs).toHaveBeenCalledWith(90001, 7))
    expect(await screen.findByLabelText('Criar novo SN')).toBeInTheDocument()
    expect(await screen.findByLabelText(/SN 731/i)).toBeInTheDocument()
    expect(screen.getByText('Finalizada')).toBeInTheDocument()
  })

  it('Processar fica desabilitado até um processo E uma opção de SN estarem escolhidos', async () => {
    const user = userEvent.setup()
    mockFetchSNs.mockResolvedValue([snExistente])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    // Sem processo: não há botão Processar (o painel direito pede a seleção).
    expect(screen.queryByRole('button', { name: /processar/i })).not.toBeInTheDocument()

    await selecionarProcesso(user)
    // Com o processo escolhido, "Criar novo SN" já é o default → Processar habilita.
    const botao = await screen.findByRole('button', { name: /processar/i })
    expect(botao).toBeEnabled()
  })

  it('escolher uma SN existente envia snDocCod no processar', async () => {
    const user = userEvent.setup()
    mockFetchSNs.mockResolvedValue([snExistente])
    mockProcessar.mockResolvedValue(settledResult)
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    await user.click(await screen.findByLabelText(/SN 731/i))
    await user.click(await screen.findByRole('button', { name: /processar/i }))

    expect(mockProcessar).toHaveBeenCalledWith('txn-0001', {
      priCod: 90001,
      valor: 15000,
      filCod: 7,
      priEspRefcliente: 'REF-CLI-0001',
      pesCod: 555,
      dpeNomPessoa: 'CLIENTE EXEMPLO LTDA',
      moeCod: 790,
      // A SN existente escolhida vai no corpo.
      snDocCod: 18202,
    })
  })

  it('"Criar novo SN" OMITE snDocCod no processar', async () => {
    const user = userEvent.setup()
    mockFetchSNs.mockResolvedValue([snExistente])
    mockProcessar.mockResolvedValue(settledResult)
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    // "Criar novo SN" é o default — processa sem escolher SN existente.
    await user.click(await screen.findByRole('button', { name: /processar/i }))

    const arg = mockProcessar.mock.calls[0][1]
    expect('snDocCod' in arg).toBe(false)
    expect(arg).toMatchObject({ priCod: 90001, filCod: 7 })
  })

  it('trocar de processo reseta a escolha para "Criar novo SN"', async () => {
    const user = userEvent.setup()
    const outro: Processo = { ...processo, priCod: 90002 }
    mockFetch.mockResolvedValue([processo, outro])
    mockFetchSNs.mockResolvedValue([snExistente])
    mockProcessar.mockResolvedValue(settledResult)
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    await user.click(await screen.findByLabelText(/SN 731/i))
    // Troca para o outro processo.
    await user.click(await screen.findByLabelText(/Processo 90002/i))

    // O radio "Criar novo SN" volta a ser o marcado (default) no novo processo.
    const novo = (await screen.findByLabelText('Criar novo SN')) as HTMLInputElement
    expect(novo.checked).toBe(true)
  })

  it('o valor nasce mascarado (default = valor do processo) e é editável', async () => {
    const user = userEvent.setup()
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    const input = (await screen.findByLabelText(
      /valor a alocar no processo 90001/i,
    )) as HTMLInputElement
    expect(input.value).toBe('15.000,00')

    await user.clear(input)
    await user.type(input, '500000')
    expect(input.value).toBe('5.000,00')
  })

  it('Processar fica desabilitado quando o valor excede o saldo', async () => {
    const user = userEvent.setup()
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    const input = await screen.findByLabelText(/valor a alocar no processo 90001/i)
    await user.clear(input)
    await user.type(input, '2000000') // 20.000,00 > 15.000,00 saldo
    expect(screen.getByRole('button', { name: /processar/i })).toBeDisabled()
  })

  it('Processar fica desabilitado quando o valor é zero', async () => {
    const user = userEvent.setup()
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    const input = await screen.findByLabelText(/valor a alocar no processo 90001/i)
    await user.clear(input)
    await user.type(input, '0')
    expect(screen.getByRole('button', { name: /processar/i })).toBeDisabled()
  })

  it('sem gerNum: bloqueia Processar e avisa', async () => {
    const user = userEvent.setup()
    const semConta = { ...transacao, gerNum: undefined }
    render(<AlocarProcessosDialog transacao={semConta} open onOpenChange={() => {}} />)
    expect(await screen.findByText(/sem conta financeira/i)).toBeInTheDocument()
    await selecionarProcesso(user)
    expect(await screen.findByRole('button', { name: /processar/i })).toBeDisabled()
  })

  it('Processar roda a alocação REAL e, ao quitar, mostra "Quitado" + docCods e decrementa o saldo', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue(settledResult)
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    // Aloca 5.000 (split) para deixar saldo restante conferível.
    const input = await screen.findByLabelText(/valor a alocar no processo 90001/i)
    await user.clear(input)
    await user.type(input, '500000') // 5.000,00
    await user.click(screen.getByRole('button', { name: /processar/i }))

    expect(mockProcessar).toHaveBeenCalledWith(
      'txn-0001',
      expect.objectContaining({
        priCod: 90001,
        valor: 5000,
        filCod: 7,
        pesCod: 555,
      }),
    )

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

    await selecionarProcesso(user)
    await user.click(await screen.findByRole('button', { name: /processar/i }))

    expect(await screen.findByText(/Falhou em fin014/i)).toBeInTheDocument()
    expect(screen.getByText(/baixa recusada pelo Conexos/i)).toBeInTheDocument()
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
  })

  it('revisaoHumana renderiza "revisão pendente"', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue({ ...settledResult, revisaoHumana: true })
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    await user.click(await screen.findByRole('button', { name: /processar/i }))
    expect(await screen.findByText(/revisão pendente/i)).toBeInTheDocument()
  })

  it('vldAutorizado===0 renderiza "Aguardando autorização SEFAZ" (não é falha)', async () => {
    const user = userEvent.setup()
    mockProcessar.mockResolvedValue({ ...settledResult, ndeAutorizado: false, vldAutorizado: 0 })
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    await user.click(await screen.findByRole('button', { name: /processar/i }))
    expect(await screen.findByText('Quitado')).toBeInTheDocument()
    expect(screen.getByText(/Aguardando autorização SEFAZ/i)).toBeInTheDocument()
  })

  it('rejeição do backend vira toast de erro — NUNCA sucesso inventado', async () => {
    const user = userEvent.setup()
    mockProcessar.mockRejectedValue(new Error('API 500'))
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
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

  it('processo sem SN existente mostra o aviso e só oferece "Criar novo SN"', async () => {
    const user = userEvent.setup()
    mockFetchSNs.mockResolvedValue([])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await selecionarProcesso(user)
    expect(await screen.findByText(/ainda não tem Solicitação de Numerário/i)).toBeInTheDocument()
    expect(await screen.findByLabelText('Criar novo SN')).toBeInTheDocument()
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

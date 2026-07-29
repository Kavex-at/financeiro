import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlocarProcessosDialog } from '@/app/recebimentos/components/AlocarProcessosDialog'
import type { Processo, SolicitacaoNumerarioDryRun, TransacaoBancaria } from '@/lib/recebimentos'

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

jest.mock('@/lib/recebimentos', () => {
  const actual = jest.requireActual('@/lib/recebimentos')
  return {
    ...actual,
    fetchProcessosParaTransacao: jest.fn(),
    processarSolicitacaoNumerario: jest.fn(),
  }
})

import {
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
} from '@/lib/recebimentos'

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

describe('AlocarProcessosDialog', () => {
  afterEach(() => jest.clearAllMocks())

  it('lists candidate processos when opened', async () => {
    mockFetch.mockResolvedValue([processo])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)

    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('txn-0001', 4, 'CLIENTE EXEMPLO LTDA'))
    expect(await screen.findByText('90001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Processar' })).toBeInTheDocument()
  })

  it('shows the payload preview + does not throw on Processar (dry-run)', async () => {
    const user = userEvent.setup()
    mockFetch.mockResolvedValue([processo])
    mockProcessar.mockResolvedValue(dryRunResult)

    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    const botao = await screen.findByRole('button', { name: 'Processar' })
    await user.click(botao)

    await waitFor(() =>
      expect(mockProcessar).toHaveBeenCalledWith('txn-0001', processo, 15000),
    )
    // Row is marked processed (simulação) + payload preview renders.
    expect(await screen.findByText('processado (simulação)')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/"priCod": 90001/)).toBeInTheDocument())
  })

  it('shows an empty state when there are no candidate processos', async () => {
    mockFetch.mockResolvedValue([])
    render(<AlocarProcessosDialog transacao={transacao} open onOpenChange={() => {}} />)
    expect(await screen.findByText('Nenhum processo candidato')).toBeInTheDocument()
  })
})

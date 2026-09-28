/**
 * Transições do lote passam por uma confirmação que nomeia o lote (filial, títulos, total) antes
 * de chamar a API — antes disparavam no primeiro clique. E o "Marcar retorno recebido", que é
 * simulação, só aparece em dev local.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { LotePagamento } from '@/lib/sispag'
import type { Acao } from './GerarRemessaDialog'
import { LoteCard } from './LoteCard'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchContasPagadoras: jest.fn().mockResolvedValue([]),
    fetchModalidadesDisponiveis: jest.fn().mockResolvedValue([]),
    fetchLinhasDigitaveis: jest.fn().mockResolvedValue({ itens: [], total: 0, dropped: 0 }),
    finalizarLote: jest.fn(),
    cancelarLote: jest.fn(),
    reabrirLote: jest.fn(),
    marcarRetorno: jest.fn(),
  }
})

import { cancelarLote, finalizarLote, marcarRetorno, reabrirLote } from '@/lib/sispag'

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
  id: 'L1',
  filCod: 7,
  status: 'RASCUNHO',
  criadoPor: 'u1',
  versao: 3,
  itens: [
    {
      loteId: 'L1',
      filCod: 7,
      docCod: '801',
      titCod: '1',
      valor: 100,
      modalidade: 'PIX',
      incluidoPor: 'u1',
    } as LotePagamento['itens'][number],
  ],
  ...over,
})

/** `acao` que executa a chamada, como o `acaoLote` do page.tsx. */
const acaoQueExecuta = (): jest.MockedFunction<Acao> =>
  jest.fn<void, Parameters<Acao>>((fn) => {
    void fn()
  })

const renderCard = (l: LotePagamento, acao: Acao = acaoQueExecuta()) => {
  render(<LoteCard lote={l} busy={false} acao={acao} />)
  return acao
}

describe('LoteCard — confirmação das transições', () => {
  const envOriginal = process.env.NEXT_PUBLIC_ENV
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => {
    process.env.NEXT_PUBLIC_ENV = envOriginal
  })

  it('Finalizar abre a confirmação com o lote e só chama a API ao confirmar', async () => {
    const user = userEvent.setup()
    const acao = renderCard(lote())

    await user.click(screen.getByRole('button', { name: /^finalizar$/i }))

    expect(acao).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Finalizar lote' })
    expect(within(dialog).getByText(/Filial 7 · 1 título\(s\)/)).toBeInTheDocument()
    expect(within(dialog).getByText('Lote L1')).toBeInTheDocument()
    expect(within(dialog).getByText(/Nada é enviado ao Conexos/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Finalizar lote' }))

    expect(finalizarLote).toHaveBeenCalledWith('L1', 3)
    expect(acao).toHaveBeenCalledWith(expect.any(Function), 'Lote finalizado')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Voltar" fecha sem cancelar o lote', async () => {
    const user = userEvent.setup()
    const acao = renderCard(lote())

    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar lote' })
    expect(within(dialog).getByText(/não pode ser reaberto/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Voltar' }))

    expect(acao).not.toHaveBeenCalled()
    expect(cancelarLote).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Reabrir com lote nativo avisa que o flp do fin015 não é alterado', async () => {
    const user = userEvent.setup()
    renderCard(lote({ status: 'FINALIZADO', nativeFlpCod: 4321 }))

    await user.click(screen.getByRole('button', { name: /^reabrir$/i }))
    const dialog = screen.getByRole('dialog', { name: 'Reabrir lote' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'O lote nativo flp 4321 já existe no Conexos (fin015)',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Reabrir lote' }))

    expect(reabrirLote).toHaveBeenCalledWith('L1', 3)
  })

  it('"Marcar retorno recebido" (simulação) não aparece fora de dev local', () => {
    process.env.NEXT_PUBLIC_ENV = 'prd'
    renderCard(lote({ status: 'FINALIZADO' }))

    expect(screen.getByRole('button', { name: /reabrir/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /marcar retorno/i })).not.toBeInTheDocument()
  })

  it('em dev local, "Marcar retorno recebido" aparece e confirma que é simulação', async () => {
    process.env.NEXT_PUBLIC_ENV = 'local'
    const user = userEvent.setup()
    renderCard(lote({ status: 'FINALIZADO' }))

    await user.click(screen.getByRole('button', { name: /marcar retorno recebido/i }))
    const dialog = screen.getByRole('dialog', { name: 'Simular retorno do Nexxera' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/simulação/)
    expect(marcarRetorno).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Marcar retorno recebido' }))
    expect(marcarRetorno).toHaveBeenCalledWith('L1', 3)
  })
})

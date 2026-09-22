/**
 * Diálogo "Gerar remessa" (ADR-0049): a data de débito deixa de ser sempre hoje. O
 * calendário mora no backend — estes testes fixam que a tela só EXIBE a janela recebida,
 * bloqueia o que ela manda bloquear e envia a data escolhida (inclusive no retry do lote
 * anterior cancelado).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { JanelaDataDebito, LotePagamento } from '@/lib/sispag'
import { type Acao, GerarRemessaDialog } from './GerarRemessaDialog'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, fetchJanelaDataDebito: jest.fn(), gerarRemessa: jest.fn() }
})

import { fetchJanelaDataDebito, gerarRemessa } from '@/lib/sispag'

const mockJanela = fetchJanelaDataDebito as jest.MockedFunction<typeof fetchJanelaDataDebito>
const mockGerar = gerarRemessa as jest.MockedFunction<typeof gerarRemessa>

const lote: LotePagamento = {
  id: 'L1',
  filCod: 2,
  conta: '55795-4',
  status: 'FINALIZADO',
  criadoPor: 'u1',
  versao: 3,
  itens: [
    { loteId: 'L1', filCod: 2, docCod: '801', titCod: '1', valor: 100, incluidoPor: 'u1' },
    { loteId: 'L1', filCod: 2, docCod: '802', titCod: '1', valor: 50.5, incluidoPor: 'u1' },
  ],
}

const janela = (over: Partial<JanelaDataDebito> = {}): JanelaDataDebito => ({
  hoje: '2026-09-22',
  min: '2026-09-22',
  max: '2026-09-29',
  sugerida: '2026-09-22',
  amanha: '2026-09-23',
  naoUteis: ['2026-09-26', '2026-09-27'],
  limitante: {
    itemId: '2:802:1',
    documento: '802/1',
    credor: 'FORNECEDOR X',
    vencimento: '2026-09-29',
  },
  ...over,
})

const abrir = async (w: JanelaDataDebito, acao: Acao = jest.fn()) => {
  mockJanela.mockResolvedValueOnce(w)
  render(<GerarRemessaDialog lote={lote} open onOpenChange={() => {}} busy={false} acao={acao} />)
  await waitFor(() => expect(mockJanela).toHaveBeenCalledWith('L1'))
  return acao
}

const campoData = () => screen.getByLabelText(/data de débito/i) as HTMLInputElement
const botaoGerar = () => screen.getByRole('button', { name: /^gerar remessa/i })

beforeEach(() => {
  mockJanela.mockReset()
  mockGerar.mockReset()
})

describe('GerarRemessaDialog', () => {
  it('mostra o resumo, a janela e o título limitante', async () => {
    await abrir(janela())
    expect(await screen.findByText(/Permitido: 22\/09 a 29\/09/)).toBeInTheDocument()
    expect(
      screen.getByText(/limitado pelo título 802\/1 — FORNECEDOR X, vence 29\/09/),
    ).toBeInTheDocument()
    expect(screen.getByText(/2 título\(s\)/)).toBeInTheDocument()
    expect(screen.getByText(/150,50/)).toBeInTheDocument()
    expect(screen.getByText(/55795-4/)).toBeInTheDocument()
    // Default = sugerida; o input carrega os limites da janela.
    expect(campoData().value).toBe('2026-09-22')
    expect(campoData().min).toBe('2026-09-22')
    expect(campoData().max).toBe('2026-09-29')
  })

  it('atalhos Hoje/Amanhã usam as datas do backend', async () => {
    await abrir(janela())
    fireEvent.click(await screen.findByRole('button', { name: 'Amanhã 23/09' }))
    expect(campoData().value).toBe('2026-09-23')
    fireEvent.click(screen.getByRole('button', { name: 'Hoje 22/09' }))
    expect(campoData().value).toBe('2026-09-22')
  })

  it('desabilita os atalhos fora da janela', async () => {
    // Hoje sábado: min é segunda; e o único dia útil da janela é essa segunda (sem amanhã).
    await abrir(
      janela({
        hoje: '2026-09-26',
        min: '2026-09-28',
        max: '2026-09-28',
        sugerida: '2026-09-28',
        amanha: undefined,
        naoUteis: [],
      }),
    )
    expect(await screen.findByRole('button', { name: 'Hoje 26/09' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^Amanhã/ })).toBeDisabled()
    expect(campoData().value).toBe('2026-09-28')
  })

  it('bloqueia dia não útil com erro inline e desabilita o envio', async () => {
    await abrir(janela())
    await screen.findByText(/Permitido/)
    fireEvent.change(campoData(), { target: { value: '2026-09-26' } })
    expect(screen.getByRole('alert')).toHaveTextContent('26/09 não é dia útil bancário')
    expect(campoData()).toHaveAttribute('aria-invalid', 'true')
    expect(botaoGerar()).toBeDisabled()
  })

  it('bloqueia data fora da janela', async () => {
    await abrir(janela())
    await screen.findByText(/Permitido/)
    fireEvent.change(campoData(), { target: { value: '2026-09-30' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/fora da janela/i)
    expect(botaoGerar()).toBeDisabled()
  })

  it('envia a data escolhida e o retry do lote cancelado repete a MESMA data', async () => {
    mockGerar.mockResolvedValue({
      status: 'gerada',
      dryRun: false,
      writeEnabled: true,
      loteId: 'L1',
      itens: 2,
      valorTotal: 150.5,
      dataDebito: '2026-09-24',
    })
    // `acao` fake que faz o que o `page.tsx` faz no toast do LoteAnteriorCanceladoError:
    // roda a ação e depois a repete com confirmarNovoLote.
    const acao: Acao = jest.fn(async (fn) => {
      await fn()
      await fn({ confirmarNovoLote: true })
    })
    await abrir(janela(), acao)
    await screen.findByText(/Permitido/)
    fireEvent.change(campoData(), { target: { value: '2026-09-24' } })
    fireEvent.click(botaoGerar())
    await waitFor(() => expect(mockGerar).toHaveBeenCalledTimes(2))
    expect(mockGerar).toHaveBeenNthCalledWith(1, 'L1', { dataDebito: '2026-09-24' })
    expect(mockGerar).toHaveBeenNthCalledWith(2, 'L1', {
      confirmarNovoLote: true,
      dataDebito: '2026-09-24',
    })
  })

  it('mensagem de sucesso inclui "débito em dd/mm"', async () => {
    const acao = jest.fn() as jest.MockedFunction<Acao>
    await abrir(janela(), acao)
    await screen.findByText(/Permitido/)
    fireEvent.click(botaoGerar())
    const okMsg = acao.mock.calls[0]?.[1]
    expect(typeof okMsg).toBe('function')
    const msg = (okMsg as (r: unknown) => { titulo: string; descricao?: string })({
      status: 'gerada',
      arquivo: 'PG220901.REM',
      nativeFlpCod: 12,
      numRemessa: 1,
      dataDebito: '2026-09-22',
    })
    expect(msg.descricao).toContain('débito em 22/09')
  })

  it('data congelada: só leitura, com o motivo, e gera com ela', async () => {
    const acao = jest.fn(async (fn: Parameters<Acao>[0]) => {
      await fn()
    }) as unknown as Acao
    mockGerar.mockResolvedValue({
      status: 'gerada',
      dryRun: false,
      writeEnabled: true,
      loteId: 'L1',
      itens: 2,
      valorTotal: 150.5,
    })
    await abrir(
      janela({ congelada: { data: '2026-09-23', nativeFlpCod: 41, motivo: 'lote_nativo_criado' } }),
      acao,
    )
    expect(
      await screen.findByText(/lote nativo flp 41 já criado no Conexos com esta data/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/cancele no fin015/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/data de débito/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Hoje/ })).toBeNull()
    fireEvent.click(botaoGerar())
    await waitFor(() =>
      expect(mockGerar).toHaveBeenCalledWith('L1', { dataDebito: '2026-09-23' }),
    )
  })

  it('janela vazia: explica o motivo e não deixa gerar', async () => {
    await abrir(
      janela({
        min: undefined,
        max: undefined,
        sugerida: undefined,
        amanha: undefined,
        naoUteis: [],
        vazia: { motivo: 'titulo_vencido' },
        limitante: { itemId: '2:802:1', documento: '802/1', vencimento: '2026-09-20' },
      }),
    )
    expect(await screen.findByText(/venceu em 20\/09/)).toBeInTheDocument()
    expect(botaoGerar()).toBeDisabled()
    expect(screen.queryByLabelText(/data de débito/i)).toBeNull()
  })

  it('falha ao carregar a janela: mostra o erro e não deixa gerar', async () => {
    mockJanela.mockRejectedValueOnce(new Error('API 500'))
    render(
      <GerarRemessaDialog lote={lote} open onOpenChange={() => {}} busy={false} acao={jest.fn()} />,
    )
    expect(await screen.findByText(/API 500/)).toBeInTheDocument()
    expect(botaoGerar()).toBeDisabled()
  })
})

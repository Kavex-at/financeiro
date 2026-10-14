/**
 * Confirmações de emissor (ADR-0068, T8): lista só com emissor mascarado, revogar com motivo para
 * `sispag:executar`, erros 404/409/422 em português.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AutorizacaoApiError,
  type ConfirmacaoEmissorBoleto,
  fetchConfirmacoesEmissor,
  revogarConfirmacaoEmissor,
} from '@/lib/sispag'
import { ConfirmacoesEmissorPainel } from './ConfirmacoesEmissorPainel'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, fetchConfirmacoesEmissor: jest.fn(), revogarConfirmacaoEmissor: jest.fn() }
})

const listar = fetchConfirmacoesEmissor as jest.Mock
const revogar = revogarConfirmacaoEmissor as jest.Mock

const par = (over: Partial<ConfirmacaoEmissorBoleto> = {}): ConfirmacaoEmissorBoleto => ({
  id: 'par-1',
  pesCod: '7001',
  credor: 'MULTILOG BRASIL',
  layoutEmissor: 'BRADESCO_237',
  bancoEmissor: '237',
  emissorMascarado: '237 / 2656 / ***2740',
  estado: 'VIGENTE',
  confirmadoPor: 'bia',
  confirmadoEm: '2026-10-14T12:00:00.000Z',
  versao: 1,
  elegivelAutomatico: true,
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('ConfirmacoesEmissorPainel', () => {
  it('lista credor, emissor mascarado e quem confirmou; tabela com legenda', async () => {
    listar.mockResolvedValue([par()])
    render(<ConfirmacoesEmissorPainel podeExecutar={false} />)
    expect(await screen.findByText('MULTILOG BRASIL')).toBeInTheDocument()
    expect(screen.getByText('237 / 2656 / ***2740')).toBeInTheDocument()
    expect(screen.getByText(/bia/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Emissores de boleto confirmados/ })).toBeInTheDocument()
  })

  it('sem executar: nenhum botão Revogar', async () => {
    listar.mockResolvedValue([par()])
    render(<ConfirmacoesEmissorPainel podeExecutar={false} />)
    await screen.findByText('MULTILOG BRASIL')
    expect(screen.queryByRole('button', { name: /^Revogar confirmação de/ })).not.toBeInTheDocument()
  })

  it('par GENERICO mostra o selo; par revogado não tem botão', async () => {
    listar.mockResolvedValue([
      par({ layoutEmissor: 'GENERICO', elegivelAutomatico: false }),
      par({ id: 'par-2', estado: 'REVOGADA', motivoRevogacao: 'conta trocada' }),
    ])
    render(<ConfirmacoesEmissorPainel podeExecutar />)
    expect(await screen.findByText('não elegível a automático')).toBeInTheDocument()
    expect(screen.getByText('revogada')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Revogar confirmação de/ })).toHaveLength(1)
  })

  it('revoga com motivo, recarrega e avisa a tela', async () => {
    listar.mockResolvedValueOnce([par()]).mockResolvedValueOnce([])
    revogar.mockResolvedValue(par({ estado: 'REVOGADA' }))
    const onAlterado = jest.fn()
    render(<ConfirmacoesEmissorPainel podeExecutar onAlterado={onAlterado} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Revogar confirmação de/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Revogar' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Informe o motivo.')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'conta trocada')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Revogar' }))
    await waitFor(() => expect(revogar).toHaveBeenCalledWith('par-1', 'conta trocada'))
    await waitFor(() => expect(onAlterado).toHaveBeenCalled())
    expect(await screen.findByText('Nenhum emissor confirmado')).toBeInTheDocument()
  })

  it.each([
    [404, 'CONFIRMACAO_EMISSOR_NAO_ENCONTRADA', 'Confirmação não encontrada.'],
    [409, 'SUGESTAO_BOLETO_INDISPONIVEL', 'A confirmação mudou; recarregue.'],
    [422, 'CONFIRMACAO_EMISSOR_MOTIVO_OBRIGATORIO', 'Informe o motivo da decisão.'],
  ])('%s: mensagem em português dentro do diálogo', async (status, code, msg) => {
    listar.mockResolvedValue([par()])
    revogar.mockRejectedValue(new AutorizacaoApiError(msg, status, code))
    render(<ConfirmacoesEmissorPainel podeExecutar />)
    await userEvent.click(await screen.findByRole('button', { name: /^Revogar confirmação de/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'x')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Revogar' }))
    expect(await within(dlg).findByText(msg)).toBeInTheDocument()
  })

  it('falha ao listar: mensagem e "Tentar de novo"', async () => {
    listar.mockRejectedValueOnce(new Error('Falha de rede')).mockResolvedValueOnce([par()])
    render(<ConfirmacoesEmissorPainel podeExecutar />)
    expect(await screen.findByText('Falha de rede')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('MULTILOG BRASIL')).toBeInTheDocument()
  })

  it('revogar a última confirmação: a lista fica vazia e o sucesso continua anunciado', async () => {
    listar.mockResolvedValueOnce([par()]).mockResolvedValueOnce([])
    revogar.mockResolvedValue(par({ estado: 'REVOGADA' }))
    render(<ConfirmacoesEmissorPainel podeExecutar />)
    await userEvent.click(await screen.findByRole('button', { name: /^Revogar confirmação de/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'conta trocada')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Revogar' }))
    expect(await screen.findByText('Nenhum emissor confirmado')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Confirmação do emissor revogada.')
  })

  it('o nome do botão de revogar é único por credor e a explicação do selo é texto visível', async () => {
    listar.mockResolvedValue([
      par({ layoutEmissor: 'GENERICO', elegivelAutomatico: false }),
      par({ id: 'par-2', pesCod: '7002', credor: undefined }),
    ])
    render(<ConfirmacoesEmissorPainel podeExecutar />)
    expect(
      await screen.findByRole('button', { name: 'Revogar confirmação de MULTILOG BRASIL' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revogar confirmação de 7002' })).toBeInTheDocument()
    expect(screen.getByText(/Layout genérico: nunca vira automático/)).toBeInTheDocument()
    expect(screen.queryByText(/I15i/)).not.toBeInTheDocument()
  })
})

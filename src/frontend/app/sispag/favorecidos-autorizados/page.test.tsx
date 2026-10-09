/**
 * Favorecidos autorizados (ADR-0065): guard por `sispag:ver`, ações por permissão (esconder, não
 * desabilitar), aprovar bloqueado para quem pediu, aprovação com a impressão mostrada, 409 de
 * destino mudado relê e explica, reaprovação exige "confirmar pedido", revelar sob demanda e com
 * prazo, motivo obrigatório.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { FavorecidoAutorizado } from '@/lib/sispag'

let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({
    carregando: false,
    falhou: false,
    recarregar: jest.fn(),
    tem: (p: Permissao) => permissoes.includes(p),
  }),
}))
jest.mock('@/lib/auth/AuthProvider', () => ({ useAuth: () => ({ username: 'bia' }) }))
let busca = new URLSearchParams()
jest.mock('next/navigation', () => ({ useSearchParams: () => busca }))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    getRecursos: jest.fn(),
    listarFavorecidosAutorizados: jest.fn(),
    reconferirAutorizacao: jest.fn(),
    aprovarAutorizacao: jest.fn(),
    rejeitarAutorizacao: jest.fn(),
    revogarAutorizacao: jest.fn(),
    pedirAutorizacao: jest.fn(),
    revelarDestino: jest.fn(),
    listarCandidatosAutorizacao: jest.fn(),
    buscarFavorecidos: jest.fn(),
    previaDestinoFavorecido: jest
      .fn()
      .mockResolvedValue({ resultado: 'OK', destinoMascarado: 'PIX CPF/CNPJ · **.345.678/****-**', avisos: [] }),
  }
})

import {
  AutorizacaoApiError,
  aprovarAutorizacao,
  getRecursos,
  listarFavorecidosAutorizados,
  pedirAutorizacao,
  reconferirAutorizacao,
  rejeitarAutorizacao,
  revelarDestino,
} from '@/lib/sispag'
import FavorecidosAutorizadosPage from './page'

const FP = 'f'.repeat(64)
const aut = (over: Partial<FavorecidoAutorizado> = {}): FavorecidoAutorizado => ({
  id: 'A1',
  pesCod: '7001',
  credor: 'ACME',
  modalidade: 'TED',
  estado: 'PENDENTE',
  avisos: [],
  origemSolicitacao: 'ITEM',
  filCodLeitura: 4,
  solicitadoPor: 'ana',
  solicitadoEm: '2026-10-08T12:00:00.000Z',
  versao: 1,
  ...over,
})
const atualOk = {
  resultado: 'OK' as const,
  destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
  fingerprint: FP,
  avisos: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
  permissoes = [...CATALOGO_PERMISSOES]
  busca = new URLSearchParams()
  ;(getRecursos as jest.Mock).mockResolvedValue({
    tedEnabled: true,
    pixEnabled: true,
    favorecidoAutorizadoEnabled: true,
  })
  ;(listarFavorecidosAutorizados as jest.Mock).mockResolvedValue([aut()])
  ;(reconferirAutorizacao as jest.Mock).mockImplementation(async (id: string) => ({
    autorizacao: aut({ id }),
    atual: atualOk,
  }))
})

const tabela = async () => within(await screen.findByRole('table', { name: /favorecidos autorizados/i }))

describe('/sispag/favorecidos-autorizados', () => {
  it('sem sispag:ver: acesso negado e nada é buscado', async () => {
    permissoes = ['permutas:ver']
    render(<FavorecidosAutorizadosPage />)
    expect(await screen.findByText(/acesso/i)).toBeInTheDocument()
    expect(listarFavorecidosAutorizados).not.toHaveBeenCalled()
  })

  it('lista com destino mascarado e o selo de conferência; tabela com nome acessível', async () => {
    ;(listarFavorecidosAutorizados as jest.Mock).mockResolvedValue([
      aut({
        estado: 'AUTORIZADO',
        destinoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
        decididoPor: 'carla',
        decididoEm: '2026-10-08T13:00:00.000Z',
        ultimaConferenciaEm: '2026-10-08T14:05:00.000Z',
        ultimaConferenciaResultado: 'IGUAL',
      }),
    ])
    render(<FavorecidosAutorizadosPage />)
    const t = await tabela()
    expect(t.getByText('banco 237 · ag. 1234 · cc ****4321-0')).toBeInTheDocument()
    expect(t.getByText(/igual ao Conexos \(lido 11:05\) · igual ao aprovado em 08\/10 por carla/)).toBeInTheDocument()
  })

  it('só com sispag:ver não há aprovar, rejeitar, revogar nem revelar (esconder, não desabilitar)', async () => {
    permissoes = ['sispag:ver']
    ;(listarFavorecidosAutorizados as jest.Mock).mockResolvedValue([
      aut(),
      aut({ id: 'A2', estado: 'AUTORIZADO', destinoMascarado: 'x' }),
    ])
    render(<FavorecidosAutorizadosPage />)
    const t = await tabela()
    for (const nome of [/aprovar/i, /rejeitar/i, /revogar/i, /revelar/i]) {
      expect(t.queryByRole('button', { name: nome })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /^pedir autorização$/i })).not.toBeInTheDocument()
    expect(t.getAllByRole('button', { name: /reconferir/i }).length).toBeGreaterThan(0)
  })

  it('aprovar envia a impressão que a tela mostrou (lida do reconferir)', async () => {
    ;(aprovarAutorizacao as jest.Mock).mockResolvedValue(aut({ estado: 'AUTORIZADO' }))
    render(<FavorecidosAutorizadosPage />)
    await userEvent.click((await tabela()).getByRole('button', { name: /decidir autorização TED de ACME/i }))
    const dialogo = await screen.findByRole('dialog')
    expect(await within(dialogo).findByText('banco 237 · ag. 1234 · cc ****4321-0')).toBeInTheDocument()
    await userEvent.click(within(dialogo).getByRole('button', { name: /^aprovar$/i }))
    await waitFor(() =>
      expect(aprovarAutorizacao).toHaveBeenCalledWith('A1', { versao: 1, fingerprintMostrado: FP }),
    )
  })

  it('quem pediu vê Aprovar desabilitado com a razão (o backend continua sendo a guarda)', async () => {
    ;(listarFavorecidosAutorizados as jest.Mock).mockResolvedValue([aut({ solicitadoPor: 'bia' })])
    ;(reconferirAutorizacao as jest.Mock).mockResolvedValue({
      autorizacao: aut({ solicitadoPor: 'bia' }),
      atual: atualOk,
    })
    render(<FavorecidosAutorizadosPage />)
    await userEvent.click((await tabela()).getByRole('button', { name: /ver autorização TED de ACME/i }))
    const dialogo = await screen.findByRole('dialog')
    const aprovar = await within(dialogo).findByRole('button', { name: /^aprovar$/i })
    await waitFor(() => expect(aprovar).toBeDisabled())
    expect(within(dialogo).getByText(/quem pediu a autorização não pode aprová-la/i)).toBeInTheDocument()
  })

  it('409 de destino mudado: relê o Conexos e explica, sem fechar', async () => {
    ;(aprovarAutorizacao as jest.Mock).mockRejectedValue(
      new AutorizacaoApiError('O destino mudou.', 409, 'AUTORIZACAO_DESTINO_MUDOU'),
    )
    render(<FavorecidosAutorizadosPage />)
    await userEvent.click((await tabela()).getByRole('button', { name: /decidir autorização/i }))
    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(await within(dialogo).findByRole('button', { name: /^aprovar$/i }))
    expect(await within(dialogo).findByText(/mudou no cadastro do Conexos enquanto a tela estava aberta/i)).toBeInTheDocument()
    expect(reconferirAutorizacao).toHaveBeenCalledTimes(2)
  })

  it('reaprovação sem pedido: mostra antes × agora e exige "Confirmar pedido" antes de aprovar', async () => {
    const reap = aut({
      estado: 'REAPROVACAO_PENDENTE',
      solicitadoPor: undefined,
      destinoMascarado: 'banco 341 · ag. 1 · cc ****9999-1',
      destinoObservadoMascarado: 'banco 237 · ag. 1234 · cc ****4321-0',
    })
    ;(listarFavorecidosAutorizados as jest.Mock).mockResolvedValue([reap])
    ;(reconferirAutorizacao as jest.Mock).mockResolvedValue({ autorizacao: reap, atual: atualOk })
    ;(pedirAutorizacao as jest.Mock).mockResolvedValue({ ...reap, solicitadoPor: 'bia', versao: 2 })
    render(<FavorecidosAutorizadosPage />)
    await userEvent.click((await tabela()).getByRole('button', { name: /decidir autorização/i }))
    const dialogo = await screen.findByRole('dialog')
    expect(await within(dialogo).findByText('banco 341 · ag. 1 · cc ****9999-1')).toBeInTheDocument()
    expect(within(dialogo).getByText('banco 237 · ag. 1234 · cc ****4321-0')).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: /^aprovar$/i })).toBeDisabled()
    await userEvent.click(within(dialogo).getByRole('button', { name: /confirmar pedido/i }))
    await waitFor(() =>
      expect(pedirAutorizacao).toHaveBeenCalledWith({
        pesCod: '7001',
        credor: 'ACME',
        modalidade: 'TED',
        origem: 'MANUAL',
        filCod: 4,
      }),
    )
  })

  it('rejeitar exige motivo', async () => {
    ;(rejeitarAutorizacao as jest.Mock).mockResolvedValue(aut({ estado: 'REJEITADO' }))
    render(<FavorecidosAutorizadosPage />)
    await userEvent.click((await tabela()).getByRole('button', { name: /rejeitar autorização/i }))
    const dialogo = await screen.findByRole('dialog')
    await userEvent.click(within(dialogo).getByRole('button', { name: /^rejeitar$/i }))
    expect(within(dialogo).getByText('Informe o motivo.')).toBeInTheDocument()
    expect(rejeitarAutorizacao).not.toHaveBeenCalled()
    await userEvent.type(within(dialogo).getByLabelText('Motivo'), 'conta de terceiro')
    await userEvent.click(within(dialogo).getByRole('button', { name: /^rejeitar$/i }))
    await waitFor(() =>
      expect(rejeitarAutorizacao).toHaveBeenCalledWith('A1', { versao: 1, motivo: 'conta de terceiro' }),
    )
  })

  it('revelar busca sob demanda, some depois do prazo e não grava em localStorage', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    const setItem = jest.spyOn(Storage.prototype, 'setItem')
    ;(listarFavorecidosAutorizados as jest.Mock).mockResolvedValue([
      aut({ estado: 'AUTORIZADO', destinoMascarado: 'banco 237 · cc ****4321' }),
    ])
    ;(revelarDestino as jest.Mock).mockResolvedValue({
      destinoMascarado: 'banco 237 · cc ****4321',
      destino: { tipo: 'TED', banco: '237', agencia: '1234', conta: '87654321', contaDv: '0' },
    })
    render(<FavorecidosAutorizadosPage />)
    expect(revelarDestino).not.toHaveBeenCalled()
    await user.click((await tabela()).getByRole('button', { name: /revelar destino completo de ACME/i }))
    expect(await screen.findByText('banco 237 · ag. 1234 · cc 87654321-0')).toBeInTheDocument()
    act(() => {
      jest.advanceTimersByTime(30_000)
    })
    expect(screen.queryByText(/87654321/)).not.toBeInTheDocument()
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()
  })

  it('atalho do item (?pedir=1) abre o pedido preenchido', async () => {
    busca = new URLSearchParams('pedir=1&pesCod=9001&modalidade=PIX&filCod=2&credor=BETA')
    render(<FavorecidosAutorizadosPage />)
    const dialogo = await screen.findByRole('dialog', { name: /pedir autorização/i })
    // Favorecido já definido pelo item: sem busca, com a prévia mascarada do destino.
    expect(within(dialogo).getByText('BETA')).toBeInTheDocument()
    expect(within(dialogo).getByText(/código 9001/)).toBeInTheDocument()
    expect(within(dialogo).queryByRole('searchbox')).not.toBeInTheDocument()
    expect(await within(dialogo).findByText('PIX CPF/CNPJ · **.345.678/****-**')).toBeInTheDocument()
    expect(within(dialogo).getByLabelText('PIX')).toBeChecked()
    expect(within(dialogo).queryByLabelText(/filial/i)).not.toBeInTheDocument()
    ;(pedirAutorizacao as jest.Mock).mockResolvedValue({ id: 'A9', estado: 'PENDENTE' })
    await userEvent.click(within(dialogo).getByRole('button', { name: /^pedir autorização$/i }))
    // A filial do lote segue escondida, só para ler o cadastro.
    await waitFor(() =>
      expect(pedirAutorizacao).toHaveBeenCalledWith(expect.objectContaining({ pesCod: '9001', filCod: 2 })),
    )
  })

  it('guarda desligada no tenant: avisa, mas a lista segue montável', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue({
      tedEnabled: false,
      pixEnabled: false,
      favorecidoAutorizadoEnabled: false,
    })
    render(<FavorecidosAutorizadosPage />)
    expect(await screen.findByText(/controle de favorecidos autorizados ainda não está ligado/i)).toBeInTheDocument()
    expect(await tabela()).toBeTruthy()
  })
})

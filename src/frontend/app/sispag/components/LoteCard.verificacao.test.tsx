/**
 * LoteCard — verificação TED/PIX e conferência (ADR-0063): alertas por item, "Tratar" a
 * duplicidade, verificação pendente, aguardando conferência e o botão "Conferir" (escondido de
 * quem finalizou; o backend continua sendo a autoridade).
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { ItemLote, LotePagamento } from '@/lib/sispag'
import type { Acao } from './GerarRemessaDialog'

let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
let usuario: string | null = 'bia'
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: (p: Permissao) => permissoes.includes(p) }),
}))
jest.mock('@/lib/auth/AuthProvider', () => ({ useUsuarioAtual: () => usuario }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchContasPagadoras: jest.fn().mockResolvedValue([]),
    fetchModalidadesDisponiveis: jest.fn().mockResolvedValue([]),
    fetchLinhasDigitaveis: jest.fn().mockResolvedValue({ itens: [], total: 0, dropped: 0 }),
    getRecursos: jest
      .fn()
      .mockResolvedValue({ tedEnabled: true, excecaoDestinoEnabled: false, pixEnabled: true }),
  }
})

import { LoteCard } from './LoteCard'

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
  loteId: 'L1',
  filCod: 4,
  docCod: '6173',
  titCod: '1',
  credor: 'FORNECEDOR A',
  valor: 100,
  modalidade: 'TED',
  incluidoPor: 'cron',
  ...over,
})

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
  id: 'L1',
  filCod: 4,
  status: 'RASCUNHO',
  criadoPor: 'cron',
  automatico: true,
  versao: 3,
  itens: [item()],
  ...over,
})

const alertaDup = {
  id: 'A1',
  loteId: 'L1',
  filCod: 4,
  docCod: '6173',
  titCod: '1',
  tipo: 'DUPLICIDADE_FORTE' as const,
  contraparteDocCod: '6702',
  evidencia: {},
  estado: 'ABERTA' as const,
  criadoEm: '2026-10-05T10:00:00.000Z',
  verificadoEm: '2026-10-05T10:00:00.000Z',
}

const acao: Acao = jest.fn()

const abrir = async (l: LotePagamento) => {
  render(<LoteCard lote={l} busy={false} acao={acao} />)
  await userEvent.click(screen.getByRole('button', { expanded: false }))
}

beforeEach(() => {
  jest.clearAllMocks()
  permissoes = [...CATALOGO_PERMISSOES]
  usuario = 'bia'
})

describe('LoteCard — alertas da verificação TED/PIX', () => {
  it('duplicidade ABERTA aparece com a contraparte e "Tratar" abre o diálogo', async () => {
    await abrir(lote({ itens: [item({ alertas: [alertaDup] })] }))
    expect(screen.getByText(/possível duplicidade · doc 6702/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Tratar alerta de duplicidade/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Possível pagamento em duplicidade')
  })

  it('duplicidade justificada mostra o texto e não oferece "Tratar"', async () => {
    await abrir(
      lote({
        itens: [
          item({
            alertas: [
              { ...alertaDup, estado: 'RESOLVIDA', resolucao: 'JUSTIFICADA', justificativa: 'NF de serviço' },
            ],
          }),
        ],
      }),
    )
    expect(screen.getByText(/duplicidade justificada/)).toBeInTheDocument()
    expect(screen.getByText('“NF de serviço”')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tratar/ })).toBeNull()
  })

  it('sem sispag:executar não há "Tratar"', async () => {
    permissoes = ['sispag:ver']
    await abrir(lote({ itens: [item({ alertas: [alertaDup] })] }))
    expect(screen.queryByRole('button', { name: /Tratar/ })).toBeNull()
  })

  it('verificação pendente e canal habitual aparecem no item', async () => {
    await abrir(
      lote({
        itens: [
          item({
            verificacaoEstado: 'PENDENTE',
            alertas: [
              { ...alertaDup, id: 'C1', tipo: 'CANAL_HABITUAL', evidencia: { grupoDominante: 'BOLETO' } },
            ],
          }),
        ],
      }),
    )
    expect(screen.getByText('verificação pendente')).toBeInTheDocument()
    expect(screen.getByText('canal habitual: boleto')).toBeInTheDocument()
  })

  it('o lote devolvido mostra quem devolveu e o motivo', async () => {
    await abrir(lote({ devolvidoPor: 'bia', motivoDevolucao: 'conta diverge da NF' }))
    expect(screen.getByRole('status')).toHaveTextContent(/Devolvido na conferência por bia.*conta diverge da NF/)
  })

  it('TED/PIX são sempre oferecidos (I10b revisado): nenhum campo de conta/chave no lote', async () => {
    await abrir(lote())
    expect(screen.queryByLabelText(/conta do favorecido|chave pix/i)).toBeNull()
  })
})

describe('LoteCard — conferência por segunda pessoa', () => {
  const finalizado = (over: Partial<LotePagamento> = {}) =>
    lote({ status: 'FINALIZADO', finalizadoPor: 'ana', exigeConferencia: true, ...over })

  it('aguardando conferência: selo, "Conferir" para outra pessoa e remessa travada', () => {
    render(<LoteCard lote={finalizado()} busy={false} acao={acao} />)
    expect(screen.getByText('aguardando conferência')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Conferir/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Gerar remessa/ })).toBeDisabled()
  })

  it('quem finalizou não vê "Conferir"', () => {
    usuario = 'ANA'
    render(<LoteCard lote={finalizado()} busy={false} acao={acao} />)
    expect(screen.queryByRole('button', { name: /Conferir/ })).toBeNull()
  })

  it('quem incluiu item não vê "Conferir"', () => {
    usuario = 'caio'
    render(
      <LoteCard lote={finalizado({ itens: [item({ incluidoPor: 'caio' })] })} busy={false} acao={acao} />,
    )
    expect(screen.queryByRole('button', { name: /Conferir/ })).toBeNull()
  })

  it('sem sispag:conferir não vê "Conferir"', () => {
    permissoes = CATALOGO_PERMISSOES.filter((p) => p !== 'sispag:conferir')
    render(<LoteCard lote={finalizado()} busy={false} acao={acao} />)
    expect(screen.queryByRole('button', { name: /Conferir/ })).toBeNull()
  })

  it('conferido: selo e a remessa liberada', () => {
    render(<LoteCard lote={finalizado({ conferidoPor: 'bia' })} busy={false} acao={acao} />)
    expect(screen.getByText('conferido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Conferir/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Gerar remessa/ })).toBeEnabled()
  })

  it('lote só de boleto não exige conferência', () => {
    render(
      <LoteCard
        lote={finalizado({ exigeConferencia: false, itens: [item({ modalidade: 'BOLETO' })] })}
        busy={false}
        acao={acao}
      />,
    )
    expect(screen.queryByText('aguardando conferência')).toBeNull()
    expect(screen.getByRole('button', { name: /Gerar remessa/ })).toBeEnabled()
  })

  it('"Conferir" abre a visão do conferente', async () => {
    render(<LoteCard lote={finalizado()} busy={false} acao={acao} />)
    await userEvent.click(screen.getByRole('button', { name: /Conferir/ }))
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('Conferir pagamentos TED/PIX')).toBeInTheDocument()
  })
})

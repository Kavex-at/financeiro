/**
 * LoteCard — verificação TED/PIX (ADR-0063) e favorecido autorizado (ADR-0065): alertas de
 * duplicidade por item, verificação pendente, o selo do favorecido com o atalho "Pedir
 * autorização", a mensagem dos itens retirados no finalizar e a remessa sem conferência.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { ItemLote, LotePagamento } from '@/lib/sispag'
import type { Acao } from './GerarRemessaDialog'

let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: (p: Permissao) => permissoes.includes(p) }),
}))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchContasPagadoras: jest.fn().mockResolvedValue([]),
    fetchModalidadesDisponiveis: jest.fn().mockResolvedValue([]),
    fetchLinhasDigitaveis: jest.fn().mockResolvedValue({ itens: [], total: 0, dropped: 0 }),
    getRecursos: jest
      .fn()
      .mockResolvedValue({ tedEnabled: true, pixEnabled: true, favorecidoAutorizadoEnabled: true }),
    pedirAutorizacao: jest.fn(),
  }
})
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))

import { pedirAutorizacao } from '@/lib/sispag'
import { LoteCard, mensagemFinalizado } from './LoteCard'

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

const abrir = async (l: LotePagamento, pesCod?: string) => {
  render(
    <LoteCard
      lote={l}
      busy={false}
      acao={acao}
      {...(pesCod ? { pesCodDoItem: () => pesCod } : {})}
    />,
  )
  await userEvent.click(screen.getByRole('button', { expanded: false }))
}

beforeEach(() => {
  jest.clearAllMocks()
  permissoes = [...CATALOGO_PERMISSOES]
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

  it('verificação pendente aparece no item', async () => {
    await abrir(lote({ itens: [item({ verificacaoEstado: 'PENDENTE' })] }))
    expect(screen.getByText('verificação pendente')).toBeInTheDocument()
  })

  it('TED/PIX são sempre oferecidos (I10b revisado): nenhum campo de conta/chave no lote', async () => {
    await abrir(lote())
    expect(screen.queryByLabelText(/conta do favorecido|chave pix/i)).toBeNull()
  })
})

describe('LoteCard — favorecido autorizado (ADR-0065)', () => {
  it('OK: selo neutro, sem atalho', async () => {
    await abrir(lote({ itens: [item({ autorizacaoAviso: 'OK' })] }), '90001')
    expect(screen.getByText('favorecido autorizado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pedir autorização/i })).toBeNull()
  })

  it('não autorizado: aviso e "Pedir autorização" direto com origem ITEM', async () => {
    ;(pedirAutorizacao as jest.Mock).mockResolvedValue({ id: 'A1' })
    await abrir(lote({ itens: [item({ autorizacaoAviso: 'FAVORECIDO_NAO_AUTORIZADO' })] }), '90001')
    expect(screen.getByText(/favorecido não autorizado/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /pedir autorização TED/i }))
    expect(pedirAutorizacao).toHaveBeenCalledWith({
      pesCod: '90001',
      credor: 'FORNECEDOR A',
      modalidade: 'TED',
      origem: 'ITEM',
      filCod: 4,
    })
    expect(await screen.findByText('autorização pedida')).toBeInTheDocument()
  })

  it('sem o favorecido conhecido, o atalho leva à tela de autorizações preenchida', async () => {
    await abrir(lote({ itens: [item({ autorizacaoAviso: 'DESTINO_ALTERADO' })] }))
    const link = screen.getByRole('link', { name: /pedir autorização TED/i })
    expect(link.getAttribute('href')).toMatch(
      /^\/sispag\/favorecidos-autorizados\?pedir=1&modalidade=TED&filCod=4&credor=FORNECEDOR/,
    )
  })

  it('sem dado no cadastro: orienta pedir ao responsável pelo cadastro do Conexos, sem atalho', async () => {
    await abrir(lote({ itens: [item({ autorizacaoAviso: 'SEM_DADO_PAGAMENTO' })] }), '90001')
    expect(screen.getByText(/pedir ao responsável pelo cadastro do Conexos/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pedir autorização/i })).toBeNull()
  })

  it('sem sispag:executar: só o selo, sem atalho (esconder, não desabilitar)', async () => {
    permissoes = ['sispag:ver']
    await abrir(lote({ itens: [item({ autorizacaoAviso: 'FAVORECIDO_NAO_AUTORIZADO' })] }), '90001')
    expect(screen.queryByRole('button', { name: /pedir autorização/i })).toBeNull()
    expect(screen.queryByRole('link', { name: /pedir autorização/i })).toBeNull()
  })

  it('mensagem do finalizar lista os retirados com o motivo', () => {
    expect(mensagemFinalizado([])).toEqual({ titulo: 'Lote finalizado' })
    const m = mensagemFinalizado([
      { filCod: 4, docCod: '6173', titCod: '1', credor: 'ACME', motivo: 'SEM_DADO_PAGAMENTO' },
    ])
    expect(m.titulo).toBe('Lote finalizado sem 1 item(ns) TED/PIX')
    expect(m.descricao).toMatch(/6173\/1 \(ACME\) — sem conta\/chave .* pedir ao responsável pelo cadastro do Conexos/)
  })

  it('lote FINALIZADO com TED/PIX: remessa liberada, sem selo de conferência', () => {
    render(<LoteCard lote={lote({ status: 'FINALIZADO', finalizadoPor: 'ana' })} busy={false} acao={acao} />)
    expect(screen.getByRole('button', { name: /Gerar remessa/ })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Conferir/ })).toBeNull()
  })
})

/**
 * O lote com boleto agrupado (ADR-0077, I21j): o grupo é UMA linha no card (os N títulos só
 * aparecem ao expandir); retirar age no grupo, com confirmação que nomeia os títulos; só quem tem
 * `sispag:executar` vê a ação, e só em rascunho.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { LotePagamento } from '@/lib/sispag'
import type { Acao } from './GerarRemessaDialog'
import { LoteCard } from './LoteCard'

let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({
    carregando: false,
    tem: (p: Permissao) => permissoes.includes(p),
  }),
}))

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchContasPagadoras: jest.fn().mockResolvedValue([]),
    fetchModalidadesDisponiveis: jest.fn().mockResolvedValue([]),
    fetchLinhasDigitaveis: jest.fn().mockResolvedValue({ itens: [], total: 0, dropped: 0 }),
    fetchRetiradasDoLote: jest.fn().mockResolvedValue([]),
    fetchVinculosPrevistos: jest.fn().mockResolvedValue({ modo: 'off', itens: [] }),
    retirarGrupoDoLote: jest.fn(),
    getRecursos: jest
      .fn()
      .mockResolvedValue({ tedEnabled: false, pixEnabled: false, favorecidoAutorizadoEnabled: false }),
  }
})
import { retirarGrupoDoLote } from '@/lib/sispag'

const item = (docCod: string, over: Record<string, unknown> = {}) =>
  ({
    loteId: 'L1',
    filCod: 2,
    docCod,
    titCod: '1',
    credor: 'PEDRONI',
    valor: 525,
    modalidade: 'BOLETO',
    incluidoPor: 'bia',
    ...over,
  }) as LotePagamento['itens'][number]

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
  id: 'L1',
  filCod: 2,
  status: 'RASCUNHO',
  criadoPor: 'bia',
  versao: 3,
  itens: [
    item('801', { credor: 'CRONOS', valor: 258.4 }),
    ...['901', '902', '903'].map((d) => item(d, { grupoBoletoId: 'G1' })),
  ],
  grupos: [
    {
      grupoId: 'G1',
      codbarMascarado: '34191…7500',
      valorBoleto: 1575,
      vencimentoBoleto: '2026-10-21',
      credor: 'PEDRONI',
      situacao: 'EM_LOTE',
      titulos: ['901', '902', '903'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' })),
    },
  ],
  ...over,
})

const acaoQueExecuta = (): jest.MockedFunction<Acao> =>
  jest.fn<void, Parameters<Acao>>((fn) => {
    void fn()
  })

const abrirCard = async (l: LotePagamento, acao: Acao = acaoQueExecuta()) => {
  render(<LoteCard lote={l} busy={false} acao={acao} />)
  // O card começa recolhido: o botão do cabeçalho (o único com `aria-expanded`) o abre.
  const abrir = screen.getAllByRole('button').find((b) => b.getAttribute('aria-expanded') === 'false')
  if (abrir) await userEvent.click(abrir)
  return acao
}

beforeEach(() => {
  jest.clearAllMocks()
  permissoes = [...CATALOGO_PERMISSOES]
})

describe('LoteCard — boleto agrupado', () => {
  it('o grupo é UMA linha e os três títulos dele não aparecem soltos; o título avulso continua uma linha', async () => {
    await abrirCard(lote())
    expect(screen.getAllByRole('row', { name: /Boleto agrupado/ })).toHaveLength(1)
    expect(screen.getByText('34191…7500')).toBeInTheDocument()
    expect(screen.queryByText('901/1')).not.toBeInTheDocument()
    expect(screen.getByText(/801\/1/)).toBeInTheDocument()
  })

  it('retirar o grupo pede confirmação que nomeia os títulos e só então chama a API (grupo inteiro)', async () => {
    const acao = await abrirCard(lote())
    await userEvent.click(screen.getByRole('button', { name: /Retirar boleto agrupado 34191…7500/ }))
    const dialog = screen.getByRole('dialog', { name: 'Retirar boleto agrupado' })
    for (const d of ['901', '902', '903']) {
      expect(within(dialog).getByText(`${d}/1`)).toBeInTheDocument()
    }
    expect(within(dialog).getByText(/sai inteiro/)).toBeInTheDocument()
    expect(retirarGrupoDoLote).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retirar do lote' }))
    expect(retirarGrupoDoLote).toHaveBeenCalledWith('L1', 'G1', 3)
    expect(acao).toHaveBeenCalled()
  })

  it('sem sispag:executar não há ação de retirar', async () => {
    permissoes = [CATALOGO_PERMISSOES[0] as Permissao].filter((p) => p.endsWith(':ver'))
    await abrirCard(lote())
    expect(screen.queryByRole('button', { name: /Retirar boleto agrupado/ })).not.toBeInTheDocument()
  })

  it('lote finalizado: o grupo aparece, mas não pode ser retirado dali', async () => {
    await abrirCard(lote({ status: 'FINALIZADO' }))
    expect(screen.getByRole('row', { name: /Boleto agrupado/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Retirar boleto agrupado/ })).not.toBeInTheDocument()
  })

  it('o total do lote soma os títulos do grupo (3 × 525) e o avulso — o grupo não é contado duas vezes', async () => {
    await abrirCard(lote())
    expect(document.body.textContent).toMatch(/1\.833,40/)
    expect(document.body.textContent).not.toMatch(/\d{44}|\d{47}/)
  })
})

/**
 * Permutas — botões de ação ⇐ `permutas:executar` (ADR-0053, Task 15).
 *
 * Quem só tem `permutas:ver` vê a tela inteira (leituras) mas NENHUM botão de ação: o botão some,
 * nunca fica desabilitado (R11). Com `permutas:executar`, tudo aparece como antes. O gate real é o
 * servidor (403); esconder é ergonomia.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AbaAutomaticas } from '@/app/permutas/components/AbaAutomaticas'
import { PermutaPendenteTable } from '@/app/permutas/components/PermutaPendenteTable'
import { VisaoGeralTable } from '@/app/permutas/components/VisaoGeralTable'
import { useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'
import type { CasamentoSugerido, PermutaPendente } from '@/lib/types'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'

const permissoesMock = jest.fn<{ carregando: boolean; tem: (p: Permissao) => boolean }, []>()
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => permissoesMock(),
}))

const fetchBorderosMock = jest.fn()
const fetchClientesFiltroMock = jest.fn()
const fetchImportadoresMock = jest.fn()
jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  fetchBorderos: (...a: unknown[]) => fetchBorderosMock(...a),
  fetchClientesFiltro: (...a: unknown[]) => fetchClientesFiltroMock(...a),
  fetchImportadores: (...a: unknown[]) => fetchImportadoresMock(...a),
}))

jest.mock('@/app/permutas/components/usePermutasData', () => ({
  usePermutasData: () => ({
    data: null,
    loading: false,
    error: 'sem dados no teste',
    statusPorAdto: {},
    carregarStatus: jest.fn(),
    load: jest.fn(),
  }),
}))

const SO_VER = { carregando: false, tem: (p: Permissao) => p === 'permutas:ver' }
const EXECUTA = { carregando: false, tem: (p: Permissao) => CATALOGO_PERMISSOES.includes(p) }

const pendente = (over: Partial<PermutaPendente> = {}): PermutaPendente => ({
  docCod: 'ADTO-1',
  filCod: 4,
  referencia: 'REF',
  exportador: 'ACME LTDA',
  valorMoedaNegociada: 1000,
  moeda: 'USD',
  diasEmAberto: 3,
  status: 'permuta-manual',
  saldoRestante: 1000,
  alocacoes: [],
  ...over,
})

const renderVisaoGeral = (p: PermutaPendente) =>
  render(
    <VisaoGeralTable
      vista="adiantamentos"
      filtro="todos"
      listaFiltrada={[p]}
      invoicesPagina={[]}
      pendentesPagina={[p]}
      invoiceListExpandida={null}
      setInvoiceListExpandida={() => {}}
      expandido={p.docCod}
      setExpandido={() => {}}
      invoiceByAdto={new Map()}
      abrirAlocar={() => {}}
      abrirMarcarExcecao={() => {}}
      abrirDesfazerExcecao={() => {}}
      paginaAtual={1}
      totalPaginas={1}
      setPagina={() => {}}
    />,
  )

const CASAMENTO: CasamentoSugerido = {
  priCod: 'PRI-9',
  invoice: {
    docCod: 'INV-9',
    filCod: 2,
    referencia: 'R',
    exportador: 'EXP',
    valorMoedaNegociada: 500,
    moeda: 'USD',
  },
  adiantamentos: [{ docCod: 'ADTO-9', referencia: 'R', valorASerUsado: 500, moeda: 'USD' }],
}

function AutomaticasHarness() {
  const aba = useTabelaFiltro(
    [CASAMENTO],
    (c) => c.invoice.filCod,
    (c) => c.priCod,
  )
  return (
    <AbaAutomaticas
      aba={aba}
      statusPorAdto={{}}
      invoiceExpandida={null}
      setInvoiceExpandida={() => {}}
      processando={null}
      setConfirmacao={() => {}}
      loteResumo={{
        casos: 1,
        adtos: 1,
        proximosN: 1,
        proximosDocCods: ['ADTO-9'],
        totalUsd: 500,
        moeda: 'USD',
      }}
      executandoLote={false}
      setConfirmLoteOpen={() => {}}
      loading={false}
      onAtualizar={() => {}}
    />
  )
}

const BORDERO = {
  borCod: 777,
  filCod: 2,
  situacao: 'EM_CADASTRO',
  finalizado: false,
  estornado: false,
  criadoPor: 'u',
  criadoEm: '2026-09-20T12:00:00.000Z',
  totalBaixado: 100,
  daTrilha: true,
  baixas: [
    {
      invoiceDocCod: 'INV-1',
      adiantamentoDocCod: 'ADTO-1',
      status: 'settled',
      valorBaixado: 100,
      criadoEm: '2026-09-20T12:00:00.000Z',
    },
  ],
}

/** Renderiza a superfície e devolve o `render` pronto (algumas buscam dados antes). */
type Superficie = () => Promise<void>

const superficies: Record<string, Superficie> = {
  pagina: async () => {
    const { default: Pagina } = await import('@/app/permutas/page')
    render(<Pagina />)
  },
  visaoExcecao: async () => {
    renderVisaoGeral(pendente({ status: 'bloqueada', motivoBloqueio: 'sem-saldo-permutar' }))
  },
  visaoDesfazer: async () => {
    renderVisaoGeral(
      pendente({
        status: 'ja-permutado',
        motivoBloqueio: 'permutado-fora-do-painel',
        excecaoManual: {
          justificativa: 'j',
          criadoPor: 'u',
          criadoEm: '2026-09-15T14:30:00.000Z',
          ativa: true,
        },
      }),
    )
  },
  visaoAlocar: async () => {
    renderVisaoGeral(pendente())
  },
  pendenteTable: async () => {
    render(
      <PermutaPendenteTable
        list={[pendente()]}
        statusPorAdto={{}}
        abrirAlocar={() => {}}
        abrirReconciliar={() => {}}
      />,
    )
  },
  automaticas: async () => {
    render(<AutomaticasHarness />)
  },
  borderos: async () => {
    const { BorderosPanel } = await import('@/app/permutas/BorderosPanel')
    render(<BorderosPanel embedded />)
    fireEvent.click(await screen.findByText('777'))
  },
  clientesFiltro: async () => {
    const { default: Pagina } = await import('@/app/permutas/clientes-filtro/page')
    render(<Pagina />)
    await screen.findByText('IMPORTADOR X')
  },
}

/** [ação, superfície, nome acessível do botão] */
const BOTOES: Array<[string, keyof typeof superficies, RegExp]> = [
  ['ingestão', 'pagina', /Ingestão de dados/],
  ['exceção manual', 'visaoExcecao', /Marcar como permutado fora do painel/],
  ['desfazer exceção', 'visaoDesfazer', /Desfazer exceção/],
  ['alocar (visão geral)', 'visaoAlocar', /Alocar invoice/],
  ['alocar (cross-process)', 'pendenteTable', /^Alocar$/],
  ['reconciliar (baixar)', 'pendenteTable', /Baixar/],
  ['processar', 'automaticas', /^Processar$/],
  ['reconciliar lote (executar próximas)', 'automaticas', /Executar próximas/],
  ['finalizar borderô', 'borderos', /Aprovar/],
  ['cancelar borderô', 'borderos', /^Cancelar$/],
  ['excluir borderô / remover baixa', 'borderos', /^Excluir$/],
  ['adicionar cliente-filtro', 'clientesFiltro', /^Adicionar$/],
  ['remover cliente-filtro', 'clientesFiltro', /Remover IMPORTADOR X/],
]

beforeEach(() => {
  permissoesMock.mockReset()
  fetchBorderosMock.mockReset().mockResolvedValue([BORDERO])
  fetchClientesFiltroMock.mockReset().mockResolvedValue([{ pesCod: '55', importador: 'IMPORTADOR X' }])
  fetchImportadoresMock
    .mockReset()
    .mockResolvedValue([{ pesCod: '66', importador: 'OUTRO', qtdAdtos: 2 }])
})

describe('Permutas — só permutas:ver: nenhum botão de ação (escondido, nunca desabilitado)', () => {
  it.each(BOTOES)('%s: ausente', async (_acao, sup, nome) => {
    permissoesMock.mockReturnValue(SO_VER)
    await superficies[sup]()
    expect(screen.queryByRole('button', { name: nome })).not.toBeInTheDocument()
  })
})

describe('Permutas — com permutas:executar: todos os botões como hoje', () => {
  it.each(BOTOES)('%s: presente', async (_acao, sup, nome) => {
    permissoesMock.mockReturnValue(EXECUTA)
    await superficies[sup]()
    await waitFor(() => expect(screen.getAllByRole('button', { name: nome }).length).toBeGreaterThan(0))
  })
})

describe('Permutas — enquanto as permissões carregam, nenhum botão de ação pisca', () => {
  it('visão geral / cross-process / automáticas: ausentes', async () => {
    permissoesMock.mockReturnValue({ carregando: true, tem: () => true })
    await superficies.pendenteTable()
    expect(screen.queryByRole('button', { name: /^Alocar$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Baixar/ })).not.toBeInTheDocument()
  })
})

describe('Permutas — leituras continuam para quem só vê', () => {
  it('borderôs listados (JC-2) e exportar .xlsx disponível', async () => {
    permissoesMock.mockReturnValue(SO_VER)
    await superficies.borderos()
    expect(screen.getByText('777')).toBeInTheDocument()
    expect(fetchBorderosMock).toHaveBeenCalled()
  })

  it('o botão Exportar (.xlsx) segue na página', async () => {
    permissoesMock.mockReturnValue(SO_VER)
    await superficies.pagina()
    expect(screen.getByRole('button', { name: /Exportar/ })).toBeInTheDocument()
  })
})


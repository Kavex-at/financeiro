import { act, render, screen, within } from '@testing-library/react'
import SispagPage from '@/app/sispag/page'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { SispagPainel } from '@/lib/sispag'
import { RESUMO_FIXTURE, TITULOS_FIXTURE } from './__fixtures__/situacaoPagamento'

/**
 * ADR-0075: com `resumoSituacao` a aba de títulos usa os cards, a faixa e o filtro novos; sem ele
 * (backend antigo), a página é a de antes. Os dois caminhos precisam funcionar.
 */

const permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: (p: Permissao) => permissoes.includes(p) }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchSispagPainel: jest.fn(),
    fetchLotes: jest.fn().mockResolvedValue([]),
    fetchRetornos: jest.fn(),
    fetchContasPagadoras: jest.fn().mockResolvedValue([]),
    fetchModalidadesDisponiveis: jest.fn().mockResolvedValue([]),
    fetchBoletosDda: jest.fn(),
    atualizarCarteiraSeDefasada: jest.fn().mockResolvedValue({ estado: 'fresca' }),
    sincronizarLotesSeDefasado: jest.fn().mockResolvedValue({ estado: 'fresca' }),
    fetchTodasSugestoesBoleto: jest.fn().mockResolvedValue({
      sugestoes: [],
      total: 0,
      pagina: 1,
      tamanho: 100,
      contagem: {},
    }),
    fetchConfirmacoesEmissor: jest.fn().mockResolvedValue([]),
    fetchRetidosPorCodigoBarras: jest.fn().mockResolvedValue([]),
    fetchRetiradasDoLote: jest.fn().mockResolvedValue([]),
  }
})

const base: SispagPainel = {
  geradoEm: '2026-10-20T14:00:00.000Z',
  modo: { somenteLeitura: true, conexosWriteEnabled: false, conexosDryRun: true },
  ingestao: {},
  kpis: {
    titulosAVencer7d: 3,
    titulosAVencer30d: 5,
    titulosVencidos: 2,
    valorAVencer30d: 1000,
    lotesAbertos: 0,
    lotesEnviados: 0,
  },
  titulos: TITULOS_FIXTURE,
  lotes: [],
}

const abrir = async (painel: SispagPainel) => {
  process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
  const lib = jest.requireMock('@/lib/sispag')
  lib.fetchSispagPainel.mockResolvedValue(painel)
  await act(async () => {
    render(<SispagPage />)
  })
}

describe('SispagPage — situação de pagamento', () => {
  it('backend novo: cards de ação, faixa de hoje e filtro Todos/Prontos/Bloqueados', async () => {
    await abrir({ ...base, resumoSituacao: RESUMO_FIXTURE })
    expect(screen.getByLabelText('Resumo de ação')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Bloqueados que vencem hoje' })).toBeInTheDocument()
    const filtro = screen.getByRole('group', { name: 'Situação do título' })
    expect(within(filtro).getByRole('button', { name: /^Prontos/ })).toBeInTheDocument()
    expect(within(filtro).getByRole('button', { name: /^Bloqueados/ })).toBeInTheDocument()
    // Os KPIs antigos da página saem: os cards da aba os substituem.
    expect(screen.queryByText('A vencer (7 dias)')).not.toBeInTheDocument()
    // O botão "Criar lote" antigo (título a título) não existe aqui.
    expect(screen.queryByRole('button', { name: /^Criar lote/ })).not.toBeInTheDocument()
  })

  it('backend antigo (sem resumoSituacao): a página é a de antes', async () => {
    await abrir({ ...base, titulos: TITULOS_FIXTURE.map((t) => ({ ...t, situacaoPagamento: undefined })) })
    expect(screen.getByText('A vencer (7 dias)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Resumo de ação')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Bloqueados que vencem hoje' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Criar lote/ })).toBeInTheDocument()
  })
})

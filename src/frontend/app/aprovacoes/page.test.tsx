import { act, render, screen } from '@testing-library/react'
import AprovacoesPage from '@/app/aprovacoes/page'
import { metadata } from '@/app/aprovacoes/layout'
import { fetchAprovacoes, type AprovacaoListItem } from '@/lib/aprovacoes'

// O grid busca a página no mount. A lib inteira é real (tipos, `formatDuracaoSegundos`);
// só a chamada de rede é trocada.
jest.mock('@/lib/aprovacoes', () => {
  const real = jest.requireActual('@/lib/aprovacoes')
  return { ...real, fetchAprovacoes: jest.fn() }
})

// O dropdown de filiais busca a lista completa no ERP; não é o objeto destes testes.
jest.mock('@/lib/api', () => ({
  fetchFiliais: jest.fn().mockResolvedValue({ filiais: [], filCodDefault: null }),
}))

const mockFetch = fetchAprovacoes as jest.MockedFunction<typeof fetchAprovacoes>

const item = (o: Partial<AprovacaoListItem> = {}): AprovacaoListItem => ({
  id: '2:4156:1',
  filCod: 2,
  documentoNumero: '4156',
  tituloNumero: '1',
  fornecedorCod: 10432,
  fornecedorNome: 'FORNECEDOR EXEMPLO LTDA',
  valor: 193720.5,
  moeda: 'BRL',
  dataEmissao: '2026-05-14',
  dataVencimento: '2026-06-14',
  statusWorkflow: 'AGUARDANDO',
  etapasConcluidas: 1,
  etapasTotais: 3,
  etapasAbertas: 1,
  etapaAtual: {
    nome: 'CONTROLLER',
    alcada: 'ALÇADA 2',
    responsavelNome: 'DANILO_LARA',
    paradaHaSegundos: 84_540,
  },
  lacunas: [],
  ...o,
})

const resposta = (o: Partial<Parameters<typeof mockFetch.mockResolvedValue>[0]> = {}) => ({
  items: [item()],
  page: 1,
  pageSize: 25,
  total: 1,
  snapshotEm: '2026-08-19T09:30:00.000Z',
  ...o,
})

const renderPainel = async () => {
  await act(async () => {
    render(<AprovacoesPage />)
  })
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe('AprovacoesPage — carregado', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(resposta())
  })

  it('o H1 identifica a frente e o título da aba acompanha', async () => {
    await renderPainel()

    expect(
      screen.getByRole('heading', { name: 'Trilha de Aprovações', level: 1 }),
    ).toBeInTheDocument()
    expect(metadata.title).toBe('Trilha de Aprovações')
  })

  /**
   * Invariante I7. O dado vem do nosso Postgres, não do ERP ao vivo — se a tela não disser a
   * idade dele, o analista decide sobre uma foto velha achando que é o estado atual.
   */
  it('mostra a idade do snapshot e diz explicitamente que não é o ERP ao vivo', async () => {
    await renderPainel()

    expect(screen.getByText(/Snapshot, não o ERP ao vivo/i)).toBeInTheDocument()
    expect(screen.getByText(/19\/08\/2026/)).toBeInTheDocument()
  })

  it('sem `snapshotEm` a ausência vira alerta, não silêncio', async () => {
    mockFetch.mockResolvedValue(resposta({ snapshotEm: undefined }))
    await renderPainel()

    expect(screen.getByText(/Idade do dado desconhecida/i)).toBeInTheDocument()
  })

  it('a paginação é do SERVIDOR — a página e o tamanho vão na requisição', async () => {
    // Se isto virasse filtro/paginação em memória, a tela teria de baixar os ~23.6k títulos
    // da filial 2 para exibir 25 linhas.
    await renderPainel()

    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 25 }))
  })

  it('a linha traz documento, fornecedor, valor completo e o placar de aprovações', async () => {
    await renderPainel()

    expect(screen.getByText('4156')).toBeInTheDocument()
    expect(screen.getByText('FORNECEDOR EXEMPLO LTDA')).toBeInTheDocument()
    // Valor monetário nunca truncado (taste-profile).
    expect(screen.getByText(/193\.720,50/)).toBeInTheDocument()
    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  /** "Parada há" é espera EM CURSO. Rotular como "durou" fundiria dois fatos diferentes. */
  it('a espera em curso é rotulada como "parada há", nunca como duração fechada', async () => {
    await renderPainel()

    expect(screen.getByText(/parada há 23 h 29 min/i)).toBeInTheDocument()
    expect(screen.queryByText(/durou/i)).not.toBeInTheDocument()
  })

  it('a coluna de data é "Emissão" — nunca "Finalização" (PV-04)', async () => {
    // `docDtaFinalizacao` não existe na projeção atual do ERP. Rotular emissão como
    // finalização seria mentir sobre o marco que o cliente usou para definir o aceite.
    await renderPainel()

    const cabecalhos = screen.getAllByRole('columnheader').map((c) => c.textContent)
    expect(cabecalhos).toContain('Emissão')
    expect(cabecalhos).not.toContain('Finalização')
  })

  /** WCAG 1.3.1 — leitor de tela precisa saber que tabela é essa e a que coluna cada célula pertence. */
  it('a tabela é identificada e cada cabeçalho declara `scope="col"`', async () => {
    await renderPainel()

    expect(
      screen.getByRole('table', { name: /Títulos a pagar e sua trilha de aprovação/i }),
    ).toBeInTheDocument()
    const cabecalhos = screen.getAllByRole('columnheader')
    expect(cabecalhos.length).toBeGreaterThan(0)
    for (const c of cabecalhos) {
      expect(c).toHaveAttribute('scope', 'col')
    }
  })

  it('SEM_WORKFLOW aparece como diagnóstico, não some da lista', async () => {
    mockFetch.mockResolvedValue(
      resposta({ items: [item({ statusWorkflow: 'SEM_WORKFLOW', etapasTotais: 0, etapaAtual: undefined })] }),
    )
    await renderPainel()

    expect(screen.getByText('sem workflow')).toBeInTheDocument()
  })

  /** PV-01 — 13 etapas reais em produção. Estado de primeira classe, com destaque próprio. */
  it('INDETERMINADO é renderizado com destaque, não escondido nem virando "aprovado"', async () => {
    mockFetch.mockResolvedValue(resposta({ items: [item({ statusWorkflow: 'INDETERMINADO' })] }))
    await renderPainel()

    const chip = screen.getByText('indeterminado')
    expect(chip).toBeInTheDocument()
    expect(chip.className).toMatch(/permuta/)
    expect(screen.queryByText('aprovado')).not.toBeInTheDocument()
  })

  /** O backend manda CÓDIGOS; a tela precisa mostrar a frase, não a constante. */
  it('as lacunas aparecem na linha traduzidas do código para o texto do analista', async () => {
    mockFetch.mockResolvedValue(resposta({ items: [item({ lacunas: ['SEM_DATA_FINALIZACAO'] })] }))
    await renderPainel()

    expect(
      screen.getByLabelText(/1 lacuna neste título: A data de finalização do documento/i),
    ).toBeInTheDocument()
    expect(screen.queryByText('SEM_DATA_FINALIZACAO')).not.toBeInTheDocument()
  })

  /** Lacuna nova no backend antes de existir aqui: mostra o código cru, nunca some. */
  it('uma lacuna desconhecida ainda aparece, com o código cru', async () => {
    mockFetch.mockResolvedValue(resposta({ items: [item({ lacunas: ['LACUNA_DO_FUTURO'] })] }))
    await renderPainel()

    expect(screen.getByLabelText(/1 lacuna neste título: LACUNA_DO_FUTURO/i)).toBeInTheDocument()
  })

  it('mais de uma etapa aberta é sinalizada com "+N"', async () => {
    mockFetch.mockResolvedValue(resposta({ items: [item({ etapasAbertas: 3 })] }))
    await renderPainel()

    expect(screen.getByText('+2')).toBeInTheDocument()
  })
})

describe('AprovacoesPage — vazio e erro', () => {
  it('lista vazia sem filtro explica que a ingestão ainda não trouxe títulos', async () => {
    mockFetch.mockResolvedValue(resposta({ items: [], total: 0 }))
    await renderPainel()

    expect(screen.getByText('Nenhum título na base')).toBeInTheDocument()
  })

  it('erro mostra a falha e oferece tentar de novo — não finge lista vazia', async () => {
    mockFetch.mockRejectedValue(new Error('API 503'))
    await renderPainel()

    expect(screen.getByText('Não foi possível carregar')).toBeInTheDocument()
    expect(screen.getByText('API 503')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tentar de novo/i })).toBeInTheDocument()
    expect(screen.queryByText('Nenhum título na base')).not.toBeInTheDocument()
  })
})

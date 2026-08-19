import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TrilhaDrawer } from '@/app/aprovacoes/components/TrilhaDrawer'
import { fetchTrilha, type AprovacaoListItem, type EtapaTrilha } from '@/lib/aprovacoes'

// Só a chamada de rede é trocada. Tipos, `descreverLacuna` e `formatDuracaoSegundos` são os
// REAIS: é o comportamento de formatação que estes testes precisam exercer.
jest.mock('@/lib/aprovacoes', () => {
  const real = jest.requireActual('@/lib/aprovacoes')
  return { ...real, fetchTrilha: jest.fn() }
})

const mockTrilha = fetchTrilha as jest.MockedFunction<typeof fetchTrilha>

const cabecalho = (o: Partial<AprovacaoListItem> = {}): AprovacaoListItem => ({
  id: '2:4156:1',
  filCod: 2,
  documentoNumero: '4156',
  tituloNumero: '1',
  fornecedorCod: 10432,
  fornecedorNome: 'FORNECEDOR EXEMPLO LTDA',
  valor: 193720.5,
  moeda: 'BRL',
  // Deliberadamente diferente das datas das etapas: assim as asserções de data da timeline
  // não podem casar por acidente com a data do cabeçalho.
  dataEmissao: '2026-05-10',
  dataVencimento: '2026-06-14',
  statusWorkflow: 'APROVADO',
  etapasConcluidas: 1,
  etapasTotais: 1,
  etapasAbertas: 0,
  lacunas: [],
  ...o,
})

/**
 * O CASO DE ACEITE, tal como o cliente descreveu: doc 4156, etapa CONTROLLER, alçada COMPRAS,
 * ação LIBERAR, DANILO_LARA. Recebida em 14/05 e agida em 15/05 → 84.534 s de duração fechada.
 */
const etapaCanonica = (o: Partial<EtapaTrilha> = {}): EtapaTrilha => ({
  fblCod: 1,
  ftbCod: 1,
  nome: 'CONTROLLER',
  alcada: 'COMPRAS',
  acao: 'LIBERAR',
  responsavelNome: 'DANILO_LARA',
  status: 'CONCLUIDA',
  statusErp: 2,
  recebidoEm: '2026-05-14T10:12:46.000Z',
  agidoEm: '2026-05-15T09:41:40.000Z',
  duracaoSegundos: 84_534,
  ...o,
})

const trilha = (o: Partial<Parameters<typeof mockTrilha.mockResolvedValue>[0]> = {}) => ({
  cabecalho: cabecalho(),
  etapas: [etapaCanonica()],
  lacunas: [],
  snapshotEm: '2026-08-19T09:30:00.000Z',
  ...o,
})

const abrir = async () => {
  await act(async () => {
    render(<TrilhaDrawer id="2:4156:1" open onOpenChange={() => {}} />)
  })
}

beforeEach(() => {
  mockTrilha.mockReset()
  mockTrilha.mockResolvedValue(trilha())
})

describe('TrilhaDrawer — caso de aceite (doc 4156)', () => {
  it('renderiza a etapa canônica: quem, quando recebeu, quando agiu e quanto durou', async () => {
    await abrir()

    // Tudo dentro do MESMO cartão de etapa: os cinco fatos têm de estar juntos, não
    // espalhados pela tela.
    const etapa = within(screen.getByRole('article'))
    expect(etapa.getByRole('heading', { name: 'CONTROLLER', level: 4 })).toBeInTheDocument()
    expect(etapa.getByText('alçada COMPRAS')).toBeInTheDocument()
    expect(etapa.getByText('LIBERAR')).toBeInTheDocument()
    expect(etapa.getByText('DANILO_LARA')).toBeInTheDocument()
    // Recebeu em 14/05, agiu em 15/05 — os dois carimbos, não só um.
    expect(etapa.getByText(/14\/05\/2026/)).toBeInTheDocument()
    expect(etapa.getByText(/15\/05\/2026/)).toBeInTheDocument()
    // 84.534 s = 23 h 28 min. É o número que o cliente conferiu na tela do ERP.
    expect(etapa.getByText('23 h 28 min')).toBeInTheDocument()
    expect(etapa.getByText(/durou/i)).toBeInTheDocument()
  })

  it('identifica o documento no título do diálogo', async () => {
    await abrir()

    expect(
      screen.getByRole('heading', { name: /Trilha de aprovação — documento 4156/i }),
    ).toBeInTheDocument()
  })

  /** I7 — o detalhe não pode fazer o leitor perder de vista a idade do dado. */
  it('mostra o snapshot também no drawer, dizendo que não é o ERP ao vivo', async () => {
    await abrir()

    expect(screen.getByText(/Snapshot, não o ERP ao vivo/i)).toBeInTheDocument()
    expect(screen.getByText(/19\/08\/2026/)).toBeInTheDocument()
  })

  it('a timeline é uma lista ordenada e as etapas saem na ordem que o backend mandou', async () => {
    mockTrilha.mockResolvedValue(
      trilha({
        etapas: [
          etapaCanonica({ nome: 'CONTROLLER' }),
          etapaCanonica({ fblCod: 1, ftbCod: 2, nome: 'TI' }),
          etapaCanonica({ fblCod: 1, ftbCod: 3, nome: 'FISCAL' }),
        ],
      }),
    )
    await abrir()

    const lista = screen.getByRole('list', { name: /ordem cronológica/i })
    expect(lista.tagName).toBe('OL')
    const nomes = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(nomes).toEqual(['CONTROLLER', 'TI', 'FISCAL'])
    expect(screen.getByText('1ª etapa')).toBeInTheDocument()
    expect(screen.getByText('3ª etapa')).toBeInTheDocument()
  })
})

describe('TrilhaDrawer — duração só aparece onde existe', () => {
  /**
   * Etapa pendente NÃO tem duração: tem espera em curso. Os rótulos são diferentes porque os
   * fatos são diferentes — "parada há 3 dias" e "durou 3 dias" não são a mesma frase.
   */
  it('etapa pendente mostra "parada há" e nunca "durou"', async () => {
    mockTrilha.mockResolvedValue(
      trilha({
        cabecalho: cabecalho({ statusWorkflow: 'AGUARDANDO', etapasConcluidas: 0, etapasAbertas: 1 }),
        etapas: [
          etapaCanonica({
            status: 'PENDENTE',
            acao: undefined,
            agidoEm: undefined,
            duracaoSegundos: undefined,
            paradaHaSegundos: 84_534,
          }),
        ],
      }),
    )
    await abrir()

    expect(screen.getByText(/Espera em curso/i)).toBeInTheDocument()
    expect(screen.getByText(/parada há 23 h 28 min/i)).toBeInTheDocument()
    expect(screen.queryByText(/durou/i)).not.toBeInTheDocument()
    expect(screen.getByText(/ainda não agiu/i)).toBeInTheDocument()
  })

  /**
   * `duracaoSegundos` ausente numa etapa já encerrada significa DESCONHECIDO (carimbos de tempo
   * inconsistentes), não "instantâneo". Um `0` ou um traço seco aqui inventaria uma medição.
   */
  it('etapa concluída sem duração diz que é desconhecido — não mostra 0 nem traço', async () => {
    mockTrilha.mockResolvedValue(
      trilha({
        etapas: [etapaCanonica({ duracaoSegundos: undefined, agidoEm: '2026-05-13T10:00:00.000Z' })],
        lacunas: ['TIMESTAMPS_INCONSISTENTES'],
      }),
    )
    await abrir()

    expect(screen.getByText(/Duração não apurada/i)).toBeInTheDocument()
    expect(screen.getByText(/Não é zero: é desconhecido/i)).toBeInTheDocument()
    expect(screen.queryByText(/durou/i)).not.toBeInTheDocument()
    expect(screen.queryByText('0 s')).not.toBeInTheDocument()
  })

  it('etapa pendente sem "parada há" declara a ausência em vez de mostrar um traço', async () => {
    mockTrilha.mockResolvedValue(
      trilha({
        etapas: [
          etapaCanonica({
            status: 'PENDENTE',
            agidoEm: undefined,
            duracaoSegundos: undefined,
            paradaHaSegundos: undefined,
          }),
        ],
      }),
    )
    await abrir()

    expect(screen.getByText(/o ERP não informou desde quando/i)).toBeInTheDocument()
  })
})

describe('TrilhaDrawer — INDETERMINADO (PV-01)', () => {
  /**
   * Existem 13 etapas reais em produção com `ftbVldStatus = 7`. O código CRU tem de aparecer na
   * tela: é ele que a analista reporta ao time da Columbia, e é o que fecha a pendência.
   */
  it('exibe o status bruto do ERP ao lado do rótulo indeterminado', async () => {
    mockTrilha.mockResolvedValue(
      trilha({
        cabecalho: cabecalho({ statusWorkflow: 'INDETERMINADO' }),
        etapas: [etapaCanonica({ status: 'INDETERMINADO', statusErp: 7 })],
        lacunas: ['STATUS_ETAPA_DESCONHECIDO'],
      }),
    )
    await abrir()

    // O código bruto e o ID da pendência saem juntos, no mesmo texto: é o par que a analista
    // copia para o time da Columbia.
    const etapa = within(screen.getByRole('article'))
    expect(etapa.getByText(/status 7 do ERP, ainda não mapeado — PV-01/i)).toBeInTheDocument()
    expect(etapa.getByText('indeterminado')).toBeInTheDocument()
    // Não vira "aprovado" nem "rejeitado" por chute.
    expect(screen.queryByText('concluída')).not.toBeInTheDocument()
  })

  it('sem `statusErp` ainda assim declara a pendência, em vez de calar', async () => {
    mockTrilha.mockResolvedValue(
      trilha({ etapas: [etapaCanonica({ status: 'INDETERMINADO', statusErp: undefined })] }),
    )
    await abrir()

    expect(screen.getByText(/status não informado pelo ERP, ainda não mapeado/i)).toBeInTheDocument()
  })
})

describe('TrilhaDrawer — marco zero (PV-04)', () => {
  /**
   * O exemplo do cliente começa na finalização do documento. Esse campo não existe na projeção
   * do ERP acessível hoje, então o relógio começa na primeira etapa — e a tela precisa DIZER,
   * senão o usuário lê o tempo total como se cobrisse desde a finalização.
   */
  it('sem `dataFinalizacao`, avisa que o relógio começa na primeira etapa', async () => {
    await abrir()

    expect(screen.getByText('O relógio começa na primeira etapa')).toBeInTheDocument()
    expect(screen.getByText(/não na finalização do documento/i)).toBeInTheDocument()
    expect(screen.getByText(/PV-04/)).toBeInTheDocument()
  })

  it('com `dataFinalizacao`, a finalização entra como o primeiro evento da timeline', async () => {
    mockTrilha.mockResolvedValue(
      trilha({ cabecalho: cabecalho({ dataFinalizacao: '2026-05-13T13:00:00.000Z' }) }),
    )
    await abrir()

    expect(screen.getByText(/Documento finalizado em 13\/05\/2026/i)).toBeInTheDocument()
    expect(screen.queryByText('O relógio começa na primeira etapa')).not.toBeInTheDocument()
  })
})

describe('TrilhaDrawer — lacunas, vazio e erro', () => {
  /** As lacunas ficam em texto na tela, não escondidas em tooltip. */
  it('lista as lacunas traduzidas do código para a frase do analista', async () => {
    mockTrilha.mockResolvedValue(trilha({ lacunas: ['ETAPA_SEM_RESPONSAVEL'] }))
    await abrir()

    expect(screen.getByText('O que esta trilha não nos diz')).toBeInTheDocument()
    expect(screen.getByText('Etapa sem responsável registrado no ERP.')).toBeInTheDocument()
    expect(screen.queryByText('ETAPA_SEM_RESPONSAVEL')).not.toBeInTheDocument()
  })

  it('uma lacuna que o frontend ainda não conhece aparece com o código cru', async () => {
    mockTrilha.mockResolvedValue(trilha({ lacunas: ['LACUNA_DO_FUTURO'] }))
    await abrir()

    expect(screen.getByText('LACUNA_DO_FUTURO')).toBeInTheDocument()
  })

  it('responsável ausente é declarado, não vira espaço em branco', async () => {
    mockTrilha.mockResolvedValue(
      trilha({ etapas: [etapaCanonica({ responsavelNome: undefined })] }),
    )
    await abrir()

    expect(screen.getByText('responsável não registrado no ERP')).toBeInTheDocument()
  })

  it('título sem etapas explica que SEM_WORKFLOW não é erro', async () => {
    mockTrilha.mockResolvedValue(
      trilha({
        cabecalho: cabecalho({ statusWorkflow: 'SEM_WORKFLOW', etapasTotais: 0, etapasConcluidas: 0 }),
        etapas: [],
      }),
    )
    await abrir()

    expect(screen.getByText('Sem etapas de aprovação registradas')).toBeInTheDocument()
    expect(screen.getByText(/Não é erro nem falha de ingestão/i)).toBeInTheDocument()
  })

  it('erro mostra a falha e oferece tentar de novo — nunca uma trilha vazia', async () => {
    mockTrilha.mockRejectedValue(new Error('API 503'))
    await abrir()

    expect(screen.getByText('Não foi possível carregar a trilha')).toBeInTheDocument()
    expect(screen.getByText('API 503')).toBeInTheDocument()

    mockTrilha.mockResolvedValue(trilha())
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /Tentar de novo/i }))
    })

    expect(screen.getByRole('heading', { name: 'CONTROLLER', level: 4 })).toBeInTheDocument()
  })

  it('fechado, não busca nada — o drawer não faz request de título que ninguém abriu', async () => {
    await act(async () => {
      render(<TrilhaDrawer id="2:4156:1" open={false} onOpenChange={() => {}} />)
    })

    expect(mockTrilha).not.toHaveBeenCalled()
  })
})

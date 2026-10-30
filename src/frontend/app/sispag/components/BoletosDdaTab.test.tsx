/**
 * Aba "Boletos DDA": consolidação, filtro, ordem e paginação moram no backend — estes testes fixam
 * que a tela manda os filtros certos e mostra o que recebe, no padrão de Títulos a pagar
 * (`sispag-dda-paridade`): cards com R$, segmentos, chips, filtros de coluna, etiquetas, faixa de
 * hoje, skeleton, e os defeitos de fetch F1–F4.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { BoletoDda, BoletosDdaResposta, FiltroBoletosDda } from '@/lib/sispag'
import { esquecerEstadoBoletosDda } from '../boletos-dda/useTabelaBoletosDda'
import { BoletosDdaTab, resumoDaSincronizacao } from './BoletosDdaTab'

/** Permissões do usuário no teste (ADR-0053). Padrão: o Administrador (as nove). */
let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: (p: Permissao) => permissoes.includes(p) }),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, fetchBoletosDda: jest.fn(), sincronizarBoletosDda: jest.fn() }
})

// A defasagem depende do relógio e do dia da semana; aqui é controlada por teste (a regra em si
// tem teste próprio em `ddaDefasado.test.ts`). Padrão: sem alerta.
jest.mock('./ddaDefasado', () => ({ horasDdaDefasado: jest.fn() }))

import { toast } from 'sonner'
import { fetchBoletosDda, sincronizarBoletosDda } from '@/lib/sispag'
import { horasDdaDefasado } from './ddaDefasado'

const mockDefasado = horasDdaDefasado as jest.MockedFunction<typeof horasDdaDefasado>
const mockFetch = fetchBoletosDda as jest.MockedFunction<typeof fetchBoletosDda>
const mockSync = sincronizarBoletosDda as jest.MockedFunction<typeof sincronizarBoletosDda>

const PADRAO = { escopo: 'a-vencer', pagina: 1, tamanho: 25 }
const ultimoFiltro = (): FiltroBoletosDda | undefined => mockFetch.mock.calls.at(-1)?.[0]

const ADP: BoletoDda = {
  ddcCod: 152,
  ditCod: 7,
  numero: '001532761',
  valor: 4815.33,
  vencimento: '2026-09-25',
  vencido: false,
  arquivos: 1,
  bancoEmissor: '341',
  linhaDigitavel: '34191090110134337000242865890009315800000481533',
  situacao: 'CANDIDATO',
  filial: 1,
  candidatos: [
    {
      filCod: 1,
      docCod: '5046',
      titCod: '1',
      credor: 'ADP BRASIL LTDA',
      vencimento: '2026-09-24',
      diferencaDias: 1,
      lote: { loteId: 'L1', status: 'FINALIZADO' },
    },
  ],
}

const zero = { qtd: 0, valor: 0 }

/** Resposta de UMA página, como o backend devolve. */
const pagina = (
  boletos: BoletoDda[],
  over: Partial<BoletosDdaResposta> = {},
): BoletosDdaResposta => {
  const contagem = {
    todas: boletos.length,
    VINCULADO: 0,
    CANDIDATO: 0,
    AMBIGUO: 0,
    FORA_JANELA: 0,
    TITULO_SAIU_CARTEIRA: 0,
    SEM_TITULO: 0,
    emGrupo: 0,
  }
  const totais = {
    todas: { ...zero },
    VINCULADO: { ...zero },
    CANDIDATO: { ...zero },
    AMBIGUO: { ...zero },
    FORA_JANELA: { ...zero },
    TITULO_SAIU_CARTEIRA: { ...zero },
    SEM_TITULO: { ...zero },
    emGrupo: { ...zero },
    grupoSugerido: { ...zero },
    grupoConfirmado: { ...zero },
    hoje: { ...zero },
    urgentes: { ...zero },
    urgentesParaConferir: { ...zero },
    urgentesSemTitulo: { ...zero },
  }
  for (const b of boletos) {
    contagem[b.situacao] += 1
    totais.todas.qtd += 1
    totais.todas.valor += b.valor
    totais[b.situacao].qtd += 1
    totais[b.situacao].valor += b.valor
    if (b.grupo) contagem.emGrupo += 1
  }
  return {
    boletos,
    total: boletos.length,
    pagina: 1,
    tamanho: 25,
    contagem,
    totais,
    facetas: { filiais: [{ valor: 1, qtd: boletos.length }], semFilial: 2, bancos: [{ valor: '341', qtd: 1 }] },
    amostraHoje: [],
    filiais: [1],
    sincronizadoEm: Date.parse('2026-09-24T12:00:00Z'),
    regraCandidato:
      'candidato = diferença de até R$ 0,05 no mesmo dia, ou valor igual com vencimento de 1 a 5 dias depois do título',
    ...over,
  }
}

beforeEach(() => {
  esquecerEstadoBoletosDda()
  mockFetch.mockReset()
  mockSync.mockReset()
  mockDefasado.mockReset()
  mockDefasado.mockReturnValue(undefined)
  jest.mocked(toast.success).mockReset()
  jest.mocked(toast.warning).mockReset()
  jest.mocked(toast.error).mockReset()
  permissoes = [...CATALOGO_PERMISSOES]
})

describe('BoletosDdaTab', () => {
  it('pede a 1ª página de "a vencer" (25 por página) e mostra candidato com credor, diferença e lote', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)

    expect(await screen.findByText('ADP BRASIL LTDA')).toBeInTheDocument()
    expect(ultimoFiltro()).toEqual(PADRAO)
    expect(mockFetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(screen.getByText('+1 dia')).toBeInTheDocument()
    expect(screen.getByText('lote finalizado')).toBeInTheDocument()
    expect(screen.getByText('25/09/2026')).toBeInTheDocument()
  })

  it('o "?" mostra a regra de candidato vigente (camadas), não mais "valor exato ±N dias"', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('ADP BRASIL LTDA')

    fireEvent.click(screen.getByRole('button', { name: 'Como a situação do boleto é calculada' }))
    const regras = screen.getByRole('region', { name: 'Como a situação do boleto é calculada' })
    expect(regras).toHaveTextContent(/diferença de até R\$ 0,05 no mesmo dia/)
    expect(screen.queryByText(/±/)).not.toBeInTheDocument()
  })

  it('mostra "em N arquivos" quando o boleto apareceu em mais de um arquivo do fin124', async () => {
    mockFetch.mockResolvedValue(pagina([{ ...ADP, arquivos: 3 }]))
    render(<BoletosDdaTab />)
    expect(await screen.findByText(/em 3 arquivos/)).toBeInTheDocument()
  })

  it('"Saiu da carteira" é segmento próprio, mostra o título que saiu e vai ao servidor', async () => {
    const saiu: BoletoDda = {
      ...ADP,
      ditCod: 99,
      situacao: 'TITULO_SAIU_CARTEIRA',
      candidatos: [],
      titulosSaidos: [{ filCod: 1, docCod: '900', titCod: '1', credor: 'FORNECEDOR SAIDO LTDA' }],
    }
    mockFetch.mockResolvedValue(pagina([saiu]))
    render(<BoletosDdaTab />)
    expect(await screen.findByText('FORNECEDOR SAIDO LTDA')).toBeInTheDocument()

    const segmentos = screen.getByRole('group', { name: 'Situação do boleto' })
    fireEvent.click(within(segmentos).getByRole('button', { name: /Saiu da carteira/ }))
    await waitFor(() =>
      expect(ultimoFiltro()).toEqual({ ...PADRAO, situacoes: ['TITULO_SAIU_CARTEIRA'] }),
    )
  })

  it('"Fora da janela" tem card e segmento próprios', async () => {
    const fora: BoletoDda = { ...ADP, ditCod: 98, situacao: 'FORA_JANELA', candidatos: [] }
    mockFetch.mockResolvedValue(pagina([fora]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    fireEvent.click(await screen.findByRole('button', { name: 'Ver fora da janela' }))
    await waitFor(() => expect(ultimoFiltro()).toEqual({ ...PADRAO, situacoes: ['FORA_JANELA'] }))
  })

  it('segmento "Sem título" vai ao servidor como situacoes e volta para a página 1', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    const segmentos = screen.getByRole('group', { name: 'Situação do boleto' })
    fireEvent.click(within(segmentos).getByRole('button', { name: /Sem título/ }))
    await waitFor(() => expect(ultimoFiltro()).toEqual({ ...PADRAO, situacoes: ['SEM_TITULO'] }))
  })

  it('segmentos mostram quantidade e R$ de cada situação', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    const segmentos = screen.getByRole('group', { name: 'Situação do boleto' })
    const conferir = within(segmentos).getByRole('button', { name: /Para conferir/ })
    expect(conferir).toHaveTextContent('1')
    expect(conferir).toHaveTextContent('R$ 4.815,33')
  })

  it('busca vai ao servidor depois do debounce — uma requisição, não uma por tecla', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    const antes = mockFetch.mock.calls.length

    const campo = screen.getByRole('searchbox', { name: 'Buscar boletos' })
    fireEvent.change(campo, { target: { value: '48' } })
    fireEvent.change(campo, { target: { value: '4815' } })

    await waitFor(() => expect(ultimoFiltro()).toEqual({ ...PADRAO, busca: '4815' }))
    expect(mockFetch.mock.calls.length - antes).toBe(1)
  })

  it('paginação pede a próxima página ao servidor', async () => {
    mockFetch.mockResolvedValue(pagina([ADP], { total: 60 }))
    render(<BoletosDdaTab />)
    expect(await screen.findByText('Página 1 de 3')).toBeInTheDocument()
    expect(screen.getByText('Mostrando 1–25 de 60')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }))
    await waitFor(() => expect(ultimoFiltro()).toEqual({ ...PADRAO, pagina: 2 }))
  })

  it('"Mostrando X de Y boletos" usa o escopo inteiro (facetas)', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    expect(screen.getByText('Mostrando 1 de 3 boletos')).toBeInTheDocument()
  })

  it('troca para "Todos" e recarrega depois de sincronizar', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    mockSync.mockResolvedValue({
      arquivosNovos: 1,
      arquivosRelidos: 30,
      arquivosLidos: 31,
      arquivosAdiados: 0,
      boletos: 3000,
      falhas: 0,
    })
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    fireEvent.click(screen.getByRole('button', { name: 'Todos (inclui vencidos)' }))
    await waitFor(() => expect(ultimoFiltro()).toEqual({ ...PADRAO, escopo: 'todos' }))
    const antes = mockFetch.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /Atualizar DDA/ }))
    await waitFor(() => expect(mockSync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockFetch.mock.calls.length).toBe(antes + 1))
    expect(toast.success).toHaveBeenCalledWith('DDA atualizado', {
      description: '31 arquivo(s) lido(s)',
    })
  })

  it('ambíguo: a linha mostra só o candidato mais próximo; o resto abre no modal', async () => {
    const pedroni = (docCod: string, vencimento: string, diferencaDias: number) => ({
      filCod: 2,
      docCod,
      titCod: '1',
      credor: 'PEDRONI LOGISTICA LTDA',
      vencimento,
      diferencaDias,
    })
    const AMBIGUO: BoletoDda = {
      ddcCod: 162,
      ditCod: 9,
      numero: '329691',
      valor: 1412,
      vencimento: '2026-09-24',
      vencido: false,
      arquivos: 1,
      situacao: 'AMBIGUO',
      candidatos: [
        pedroni('34685', '2026-09-24', 0),
        pedroni('34872', '2026-09-25', -1),
        pedroni('36171', '2026-09-26', -2),
      ],
    }
    mockFetch.mockResolvedValue(pagina([AMBIGUO]))
    render(<BoletosDdaTab />)

    expect(await screen.findByText(/34685\/1/)).toBeInTheDocument()
    expect(screen.queryByText(/34872\/1/)).not.toBeInTheDocument()
    const resumo = screen.getByRole('button', { name: /Ver os 3 títulos candidatos/ })
    expect(resumo).toHaveTextContent('+2 títulos · 1 credor · 0 a -2 dias')

    fireEvent.click(resumo)
    expect(await screen.findByRole('dialog')).toHaveTextContent('3 títulos candidatos')
    expect(screen.getByText('34872/1')).toBeInTheDocument()
    expect(screen.getByText('36171/1')).toBeInTheDocument()
  })

  it('pool DDA parado em dia útil mostra o aviso com as horas', async () => {
    mockDefasado.mockReturnValue(30)
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    expect(screen.getByText(/DDA parado há 30 h/)).toBeInTheDocument()
    expect(mockDefasado).toHaveBeenCalledWith(Date.parse('2026-09-24T12:00:00Z'))
  })

  it('pool em dia: nenhum aviso de defasagem', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    expect(screen.queryByText(/DDA parado há/)).not.toBeInTheDocument()
  })

  it('sem sincronização ainda, orienta a clicar em "Atualizar DDA"', async () => {
    mockFetch.mockResolvedValue(pagina([], { sincronizadoEm: undefined }))
    render(<BoletosDdaTab />)
    expect(
      await screen.findByText('Clique em "Atualizar DDA" para trazer os boletos do fin124.'),
    ).toBeInTheDocument()
    expect(screen.getByText('DDA ainda não sincronizado')).toBeInTheDocument()
  })

  it('erro de carga oferece "Tentar de novo"', async () => {
    mockFetch.mockRejectedValueOnce(new Error('API 500'))
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    fireEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }))
    expect(await screen.findByText('001532761')).toBeInTheDocument()
  })
})

describe('I-DDA7 — aviso conta da última conferência e fica quieto durante a abertura', () => {
  it('usa conferidoEm (não sincronizadoEm) e mostra as duas marcas no cabeçalho', async () => {
    mockFetch.mockResolvedValue(
      pagina([ADP], { conferidoEm: Date.parse('2026-09-24T15:00:00Z') }),
    )
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    expect(mockDefasado).toHaveBeenCalledWith(Date.parse('2026-09-24T15:00:00Z'))
    expect(screen.getByText(/^DDA conferido em .* · dados de /)).toBeInTheDocument()
  })

  it('backend antigo (sem conferidoEm) cai em sincronizadoEm', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    expect(mockDefasado).toHaveBeenCalledWith(Date.parse('2026-09-24T12:00:00Z'))
  })

  it('enquanto a abertura atualiza a carteira/confere o DDA, não avisa', async () => {
    mockDefasado.mockReturnValue(11)
    mockFetch.mockResolvedValue(pagina([ADP]))
    const { rerender } = render(<BoletosDdaTab atualizandoCarteira />)
    await screen.findByText('001532761')
    expect(screen.queryByText(/DDA parado há/)).not.toBeInTheDocument()
    rerender(<BoletosDdaTab atualizandoCarteira={false} />)
    expect(screen.getByText(/DDA parado há 11 h/)).toBeInTheDocument()
  })
})

describe('F1 — "não sincronizado" só quando o servidor diz', () => {
  it('primeira carga: skeleton nos cards e na tabela, e nada de "não sincronizado"', async () => {
    mockFetch.mockReturnValue(new Promise(() => {}))
    render(<BoletosDdaTab />)
    expect(await screen.findByRole('status', { name: 'Carregando boletos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Resumo dos boletos DDA')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Carregando o DDA…')).toBeInTheDocument()
    expect(screen.queryByText('DDA ainda não sincronizado')).not.toBeInTheDocument()
  })

  it('GET com erro: diz que não leu, nunca "não sincronizado"', async () => {
    mockFetch.mockRejectedValue(new Error('Banco fora do ar'))
    render(<BoletosDdaTab />)
    expect(await screen.findByText('Banco fora do ar')).toBeInTheDocument()
    expect(screen.getByText('Não foi possível ler o DDA')).toBeInTheDocument()
    expect(screen.queryByText('DDA ainda não sincronizado')).not.toBeInTheDocument()
  })
})

describe('F2/F3 — toast do "Atualizar DDA"', () => {
  it('conta o que foi lido; adiados e falhas viram aviso para rodar de novo', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    mockSync.mockResolvedValue({
      arquivosNovos: 5,
      arquivosRelidos: 0,
      arquivosLidos: 0,
      arquivosAdiados: 3,
      boletos: 0,
      falhas: 2,
    })
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    fireEvent.click(screen.getByRole('button', { name: /Atualizar DDA/ }))
    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
    const [titulo, opcoes] = jest.mocked(toast.warning).mock.calls[0] ?? []
    expect(titulo).toBe('DDA atualizado em parte')
    expect(opcoes?.description).toContain('0 arquivo(s) lido(s) · 3 adiado(s) · 2 com falha')
    expect(opcoes?.description).not.toContain('5')
  })

  it('backend sem arquivosLidos: deriva de novos + relidos − falhas − adiados', () => {
    expect(
      resumoDaSincronizacao({ arquivosNovos: 4, arquivosRelidos: 6, boletos: 1, falhas: 1 }),
    ).toEqual({ completa: false, descricao: expect.stringContaining('9 arquivo(s) lido(s)') })
  })

  it('erro do servidor mostra a mensagem dele', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    mockSync.mockRejectedValue(new Error('Conexos fora do ar'))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    fireEvent.click(screen.getByRole('button', { name: /Atualizar DDA/ }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível atualizar o DDA', {
        description: 'Conexos fora do ar',
      }),
    )
  })
})

describe('F4 — requisição superada e ingestão da página', () => {
  it('trocar o filtro aborta a requisição anterior', async () => {
    mockFetch.mockResolvedValueOnce(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    mockFetch.mockReturnValue(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Todos (inclui vencidos)' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
    const sinalDaSegunda = mockFetch.mock.calls[1]?.[1]?.signal
    fireEvent.click(screen.getByRole('button', { name: 'A vencer' }))
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3))
    expect(sinalDaSegunda?.aborted).toBe(true)
  })

  it('nova ingestão da carteira (versaoCarteira) relê a aba', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    const { rerender } = render(<BoletosDdaTab versaoCarteira="2026-10-30T10:00:00Z" />)
    await screen.findByText('001532761')
    const antes = mockFetch.mock.calls.length
    rerender(<BoletosDdaTab versaoCarteira="2026-10-30T12:00:00Z" />)
    await waitFor(() => expect(mockFetch.mock.calls.length).toBe(antes + 1))
  })

  it('os filtros sobrevivem à troca de aba (desmontar e montar de novo)', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    const { unmount } = render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    fireEvent.click(screen.getByRole('button', { name: 'Todos (inclui vencidos)' }))
    await waitFor(() => expect(ultimoFiltro()?.escopo).toBe('todos'))
    unmount()
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    expect(ultimoFiltro()).toEqual({ ...PADRAO, escopo: 'todos' })
    expect(screen.getByRole('button', { name: 'Todos (inclui vencidos)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

describe('cards, chips, colunas e faixa (paridade com Títulos a pagar)', () => {
  it('cards com R$; "Conferir" liga o segmento e os chips Candidato/Ambíguo', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    const cards = screen.getByLabelText('Resumo dos boletos DDA')
    expect(cards).toHaveTextContent('Para conferir')
    expect(cards).toHaveTextContent('R$ 4.815,33 · 1 com um candidato · 0 ambíguos')

    fireEvent.click(within(cards).getByRole('button', { name: 'Conferir' }))
    await waitFor(() =>
      expect(ultimoFiltro()).toEqual({ ...PADRAO, situacoes: ['CANDIDATO', 'AMBIGUO'] }),
    )
    const segmentos = screen.getByRole('group', { name: 'Situação do boleto' })
    expect(within(segmentos).getByRole('button', { name: /Para conferir/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: /^Candidato/ }))
    await waitFor(() => expect(ultimoFiltro()).toEqual({ ...PADRAO, situacoes: ['CANDIDATO'] }))
  })

  it('"Vencem em até 2 dias" liga hoje + 1–2 dias sem os casados; "Limpar filtros" desfaz', async () => {
    mockFetch.mockResolvedValue(
      pagina([ADP], {
        totais: {
          ...pagina([ADP]).totais!,
          urgentes: { qtd: 1, valor: 4815.33 },
          urgentesParaConferir: { qtd: 1, valor: 4815.33 },
        },
      }),
    )
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    fireEvent.click(screen.getByRole('button', { name: 'Ver só os urgentes' }))
    await waitFor(() =>
      expect(ultimoFiltro()).toEqual({
        ...PADRAO,
        situacoes: ['CANDIDATO', 'AMBIGUO', 'SEM_TITULO'],
        faixas: ['HOJE', '1-2'],
      }),
    )
    expect(screen.getByRole('button', { name: /Remover filtro: Vencimento: hoje, 1 a 2 dias/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    await waitFor(() => expect(ultimoFiltro()).toEqual(PADRAO))
  })

  it('filtro de coluna Título vai ao servidor depois do debounce e vira etiqueta removível', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')

    fireEvent.click(screen.getByRole('button', { name: /Filtrar Título/ }))
    fireEvent.change(await screen.findByLabelText('Filtrar Título por texto'), {
      target: { value: 'adp' },
    })
    await waitFor(() => expect(ultimoFiltro()).toEqual({ ...PADRAO, titulo: 'adp' }))

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro: Título contém "adp"' }))
    await waitFor(() => expect(ultimoFiltro()).toEqual(PADRAO))
  })

  it('ordenar pelo cabeçalho vai ao servidor', async () => {
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    fireEvent.click(screen.getByRole('button', { name: 'Ordenar por Valor' }))
    await waitFor(() =>
      expect(ultimoFiltro()).toEqual({ ...PADRAO, ordem: { coluna: 'valor', direcao: 1 } }),
    )
  })

  it('faixa "vencem hoje": lista os não casados e "Ver só estes" filtra', async () => {
    mockFetch.mockResolvedValue(
      pagina([ADP], {
        amostraHoje: [ADP],
        totais: { ...pagina([ADP]).totais!, hoje: { qtd: 3, valor: 9000 } },
      }),
    )
    render(<BoletosDdaTab />)
    const faixa = await screen.findByRole('region', { name: 'Boletos não casados que vencem hoje' })
    expect(faixa).toHaveTextContent('3 boleto(s) não casado(s) vencem hoje')
    expect(faixa).toHaveTextContent('E mais 2 na tabela.')
    act(() => {
      fireEvent.click(within(faixa).getByRole('button', { name: 'Ver só estes' }))
    })
    await waitFor(() =>
      expect(ultimoFiltro()).toEqual({
        ...PADRAO,
        situacoes: ['CANDIDATO', 'AMBIGUO', 'SEM_TITULO'],
        faixas: ['HOJE'],
      }),
    )
  })

  it('coluna Filial: "sem filial" quando o boleto não tem filial de exibição', async () => {
    const livre: BoletoDda = { ...ADP, ditCod: 8, numero: '8', situacao: 'SEM_TITULO', candidatos: [] }
    delete (livre as { filial?: number }).filial
    mockFetch.mockResolvedValue(pagina([ADP, livre]))
    render(<BoletosDdaTab />)
    await screen.findByText('001532761')
    expect(screen.getByText('sem filial')).toBeInTheDocument()
  })
})

/**
 * ADR-0053: consultar os boletos (`GET /sispag/boletos-dda`) basta `sispag:ver`; sincronizar com o
 * fin124 exige `sispag:executar`. Sem `ver`, por defesa, o componente não lê nada.
 */
describe('BoletosDdaTab — permissões', () => {
  it('só sispag:ver: busca os boletos, mas não mostra "Atualizar DDA"', async () => {
    permissoes = ['sispag:ver']
    mockFetch.mockResolvedValue(pagina([ADP]))
    render(<BoletosDdaTab />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /atualizar dda|sincronizar/i })).not.toBeInTheDocument()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('só sispag:ver e pool vazio: não manda clicar em "Atualizar DDA"', async () => {
    permissoes = ['sispag:ver']
    mockFetch.mockResolvedValue(pagina([], { sincronizadoEm: undefined }))
    render(<BoletosDdaTab />)
    expect(
      await screen.findByText('A ingestão traz os boletos do fin124 às 07h, 12h e 16h dos dias úteis.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Clique em "Atualizar DDA"/)).not.toBeInTheDocument()
  })

  it('sem sispag:ver: não busca nada nem mostra "Atualizar DDA"', () => {
    permissoes = []
    render(<BoletosDdaTab />)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /atualizar dda|sincronizar/i })).not.toBeInTheDocument()
  })
})

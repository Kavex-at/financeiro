/**
 * Aba Boletos DDA absorve os boletos agrupados (I21v, entrevista de 2026-10-29): cartão "Pagam
 * vários títulos", chip "Em grupo", linha expansível com os títulos, Confirmar/Anular na linha e
 * "Compor com títulos". Paridade com a antiga aba Boletos agrupados nos testes do bloco.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import {
  confirmarGrupoBoleto,
  fetchBoletosDda,
  fetchGruposBoleto,
  fetchSugestoesGrupoBoleto,
  type BoletoDda,
  type BoletosDdaResposta,
} from '@/lib/sispag'
import { BoletosDdaTab } from './BoletosDdaTab'
import { grupoConfirmado, sugestaoGrupo } from './grupoBoleto.fixtures'

let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: (p: Permissao) => permissoes.includes(p) }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))
jest.mock('./ddaDefasado', () => ({ horasDdaDefasado: jest.fn(() => undefined) }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchBoletosDda: jest.fn(),
    sincronizarBoletosDda: jest.fn(),
    fetchSugestoesGrupoBoleto: jest.fn(),
    fetchGruposBoleto: jest.fn(),
    confirmarGrupoBoleto: jest.fn(),
    anularGrupoBoleto: jest.fn(),
  }
})

const mockFetch = fetchBoletosDda as jest.Mock
const sugestoes = fetchSugestoesGrupoBoleto as jest.Mock
const grupos = fetchGruposBoleto as jest.Mock
const confirmar = confirmarGrupoBoleto as jest.Mock

const BOLETO_GRUPO: BoletoDda = {
  ddcCod: 900,
  ditCod: 332841,
  numero: '332841',
  valor: 1575,
  vencimento: '2026-10-21',
  vencido: false,
  bancoEmissor: '341',
  codbar: 'x'.repeat(44),
  situacao: 'SEM_TITULO',
  candidatos: [],
  grupo: { estado: 'SUGERIDO', filCod: 2, nTitulos: 3, confirmavel: true },
}
const BOLETO_CONFIRMADO: BoletoDda = {
  ...BOLETO_GRUPO,
  ditCod: 5,
  numero: '5',
  grupo: { estado: 'CONFIRMADO', id: 'G1', filCod: 2, nTitulos: 3, confirmavel: true },
}
const BOLETO_AVULSO: BoletoDda = {
  ...BOLETO_GRUPO,
  ditCod: 7,
  numero: '7',
  situacao: 'CANDIDATO',
  grupo: undefined as never,
}
delete (BOLETO_AVULSO as { grupo?: unknown }).grupo

const pagina = (boletos: BoletoDda[], over: Partial<BoletosDdaResposta> = {}): BoletosDdaResposta => {
  const contagem = { todas: boletos.length, VINCULADO: 0, CANDIDATO: 0, AMBIGUO: 0, SEM_TITULO: 0, emGrupo: 0 }
  for (const b of boletos) {
    contagem[b.situacao] += 1
    if (b.grupo) contagem.emGrupo += 1
  }
  return {
    boletos,
    total: boletos.length,
    pagina: 1,
    tamanho: 20,
    contagem,
    filiais: [2],
    sincronizadoEm: Date.parse('2026-10-20T12:00:00Z'),
    regraCandidato: 'regra',
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  permissoes = [...CATALOGO_PERMISSOES]
  mockFetch.mockResolvedValue(pagina([BOLETO_GRUPO, BOLETO_CONFIRMADO, BOLETO_AVULSO]))
  sugestoes.mockResolvedValue([sugestaoGrupo()])
  grupos.mockResolvedValue([])
})

describe('Boletos DDA × grupos (I21v)', () => {
  it('cartão "Pagam vários títulos" com a contagem e o atalho para o filtro', async () => {
    render(<BoletosDdaTab />)
    const cartao = (await screen.findByText('Pagam vários títulos')).closest('div') as HTMLElement
    await waitFor(() => expect(cartao.parentElement?.textContent).toMatch(/2/))
    await userEvent.click(await screen.findByRole('button', { name: 'Ver os grupos' }))
    await waitFor(() =>
      expect(mockFetch).toHaveBeenLastCalledWith(expect.objectContaining({ emGrupo: true })),
    )
  })

  it('chip "Em grupo (N)" liga e desliga o filtro emGrupo no servidor', async () => {
    render(<BoletosDdaTab />)
    const chip = await screen.findByRole('button', { name: 'Em grupo (2)' })
    await userEvent.click(chip)
    await waitFor(() =>
      expect(mockFetch).toHaveBeenLastCalledWith(expect.objectContaining({ emGrupo: true, pagina: 1 })),
    )
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(chip)
    await waitFor(() => expect(mockFetch.mock.calls.at(-1)?.[0]).not.toHaveProperty('emGrupo'))
  })

  it('Paridade (estado vazio): filtro "Em grupo" sem resultado explica e oferece limpar', async () => {
    render(<BoletosDdaTab />)
    mockFetch.mockResolvedValue(pagina([]))
    await userEvent.click(await screen.findByRole('button', { name: /^Em grupo/ }))
    expect(await screen.findByText('Nenhum boleto encontrado')).toBeInTheDocument()
  })

  it('linha de grupo é expansível e mostra os títulos do grupo (sugerido) com Confirmar grupo', async () => {
    confirmar.mockResolvedValue({ criado: true, grupo: grupoConfirmado() })
    const onGrupoAlterado = jest.fn()
    render(<BoletosDdaTab onGrupoAlterado={onGrupoAlterado} />)
    const alternar = await screen.findByRole('button', { name: /Ver os 3 títulos do grupo do boleto 332841/ })
    expect(alternar).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(alternar)
    expect(alternar).toHaveAttribute('aria-expanded', 'true')
    const bloco = await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
    for (const doc of ['38883', '38884', '38885']) {
      expect(within(bloco).getByText(`${doc}/1`)).toBeInTheDocument()
    }
    await userEvent.click(within(bloco).getByRole('button', { name: /^Confirmar grupo de PEDRONI/ }))
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onGrupoAlterado).toHaveBeenCalled())
  })

  it('grupo confirmado: estado "confirmado" na linha e Anular grupo na linha expandida', async () => {
    grupos.mockResolvedValue([grupoConfirmado({ ditCod: 5 })])
    sugestoes.mockResolvedValue([])
    render(<BoletosDdaTab />)
    expect(await screen.findByText(/Grupo confirmado/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /títulos do grupo do boleto 5/ }))
    expect(await screen.findByRole('button', { name: /^Anular grupo de PEDRONI/ })).toBeInTheDocument()
  })

  it('Paridade (sem sispag:executar): a linha lê o grupo e não oferece escrita nem composição', async () => {
    permissoes = permissoes.filter((p) => p !== 'sispag:executar')
    render(<BoletosDdaTab onCompor={undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ver os 3 títulos do grupo do boleto 332841/ }))
    await screen.findByRole('region', { name: /PEDRONI/ })
    expect(screen.queryByRole('button', { name: /Confirmar grupo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Compor com títulos/ })).not.toBeInTheDocument()
  })

  it('Paridade (compor): "Compor com títulos" nas mesmas condições de antes, e não em grupo confirmado', async () => {
    const onCompor = jest.fn()
    render(<BoletosDdaTab onCompor={onCompor} />)
    await screen.findByText('332841')
    // Sugerido e avulso (não vinculado, não vencido, com código de barras) compõem; o confirmado não.
    const botoes = await screen.findAllByRole('button', { name: /Compor com títulos/ })
    expect(botoes).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Compor com títulos o boleto 332841' }))
    expect(onCompor).toHaveBeenCalledWith(expect.objectContaining({ ditCod: 332841 }))
    expect(screen.queryByRole('button', { name: 'Compor com títulos o boleto 5' })).not.toBeInTheDocument()
  })

  it('Paridade (falha ao carregar o grupo): mensagem e "Tentar de novo" dentro da linha', async () => {
    sugestoes.mockRejectedValueOnce(new Error('Falha de rede')).mockResolvedValueOnce([sugestaoGrupo()])
    render(<BoletosDdaTab />)
    fireEvent.click(await screen.findByRole('button', { name: /Ver os 3 títulos do grupo do boleto 332841/ }))
    expect(await screen.findByText('Falha de rede')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('region', { name: /PEDRONI/ })).toBeInTheDocument()
  })
})

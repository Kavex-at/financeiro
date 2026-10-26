/**
 * Painel dos boletos agrupados (ADR-0077, I21e): sugestões de grupo fechado com o motivo quando não
 * são confirmáveis, confirmar, e os grupos confirmados com situação e anulação. Escrita só para
 * `sispag:executar`; botões desabilitados durante a chamada; nenhum código completo na tela.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  anularGrupoBoleto,
  AutorizacaoApiError,
  confirmarGrupoBoleto,
  fetchGruposBoleto,
  fetchSugestoesGrupoBoleto,
  type GrupoBoletoListado,
  type SugestaoGrupoBoleto,
} from '@/lib/sispag'
import { GrupoBoletoPainel } from './GrupoBoletoPainel'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchSugestoesGrupoBoleto: jest.fn(),
    fetchGruposBoleto: jest.fn(),
    confirmarGrupoBoleto: jest.fn(),
    anularGrupoBoleto: jest.fn(),
  }
})

const sugestoes = fetchSugestoesGrupoBoleto as jest.Mock
const grupos = fetchGruposBoleto as jest.Mock
const confirmar = confirmarGrupoBoleto as jest.Mock
const anular = anularGrupoBoleto as jest.Mock

const TITULOS = ['38883', '38884', '38885'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' }))

const sugestao = (over: Partial<SugestaoGrupoBoleto> = {}): SugestaoGrupoBoleto => ({
  filCod: 2,
  pesCod: '9001',
  credor: 'PEDRONI',
  ddcCod: 900,
  ditCod: 332841,
  numeroBoleto: '332841',
  codbarMascarado: '34191…7500',
  valorBoletoCentavos: 157500,
  vencimentoBoleto: '2026-10-21',
  somaTitulosCentavos: 157500,
  titulos: TITULOS.map((t) => ({
    ...t,
    motivos: [],
    valorCentavos: 52500,
    vencimento: '2026-10-21',
    valorLiquidoCentavos: 52500,
    deltaDias: 0,
  })),
  intercambiavel: false,
  parVigente: true,
  confirmavel: true,
  motivos: [],
  ...over,
})

const grupoListado = (over: Partial<GrupoBoletoListado> = {}): GrupoBoletoListado => ({
  id: 'G1',
  filCod: 2,
  pesCod: '9001',
  credor: 'PEDRONI',
  ddcCod: 900,
  ditCod: 332841,
  codbarMascarado: '34191…7500',
  valorBoletoCentavos: 157500,
  vencimentoBoleto: '2026-10-21',
  titulos: TITULOS.map((t) => ({ ...t, valorLiquidoCentavos: 52500, vencimento: '2026-10-21' })),
  somaTitulosCentavos: 157500,
  origem: 'SUGERIDO',
  intercambiavel: false,
  estado: 'CONFIRMADO',
  confirmadoPor: 'bia',
  versao: 1,
  situacao: 'DISPONIVEL',
  orfao: { orfao: false },
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  sugestoes.mockResolvedValue([])
  grupos.mockResolvedValue([])
})

describe('GrupoBoletoPainel — sugestões', () => {
  it('mostra credor, boleto mascarado, valor, vencimento, os títulos e a soma', async () => {
    sugestoes.mockResolvedValue([sugestao()])
    render(<GrupoBoletoPainel podeExecutar />)
    const cartao = await screen.findByRole('article', { name: /PEDRONI/ })
    expect(within(cartao).getByText('34191…7500')).toBeInTheDocument()
    expect(within(cartao).getAllByText(/1\.575,00/).length).toBeGreaterThanOrEqual(1)
    expect(within(cartao).getByText('21/10/2026')).toBeInTheDocument()
    for (const t of TITULOS) {
      expect(within(cartao).getByText(`${t.docCod}/${t.titCod}`)).toBeInTheDocument()
    }
    expect(within(cartao).getByText(/Soma dos títulos/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d{44}|\d{47}/)
  })

  it('pede as sugestões da filial recebida', async () => {
    render(<GrupoBoletoPainel podeExecutar filCod={2} />)
    await waitFor(() => expect(sugestoes).toHaveBeenCalledWith(2))
    expect(grupos).toHaveBeenCalledWith(2)
  })

  it('não confirmável mostra o motivo em português e NÃO tem botão de confirmar (alçada)', async () => {
    sugestoes.mockResolvedValue([
      sugestao({ confirmavel: false, motivo: 'NAO_LIBERADO', motivos: ['NAO_LIBERADO'] }),
    ])
    render(<GrupoBoletoPainel podeExecutar />)
    const cartao = await screen.findByRole('article', { name: /PEDRONI/ })
    expect(within(cartao).getByText(/aguardando alçada/)).toBeInTheDocument()
    expect(within(cartao).queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('filiais diferentes: "não suportado ... pagar à mão", sem botão', async () => {
    sugestoes.mockResolvedValue([
      sugestao({ confirmavel: false, motivo: 'CRUZA_FILIAL', motivos: ['CRUZA_FILIAL'] }),
    ])
    render(<GrupoBoletoPainel podeExecutar />)
    expect(
      await screen.findByText(/não suportado: títulos de filiais diferentes, pagar à mão/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('intercambiável é explicado em uma linha', async () => {
    sugestoes.mockResolvedValue([sugestao({ intercambiavel: true })])
    render(<GrupoBoletoPainel podeExecutar />)
    expect(await screen.findByText(/boletos iguais/i)).toBeInTheDocument()
  })

  it('confirmar chama a API com o boleto e os N títulos (origem SUGERIDO), recarrega e avisa a tela', async () => {
    sugestoes.mockResolvedValueOnce([sugestao()]).mockResolvedValueOnce([])
    confirmar.mockResolvedValue({ criado: true, grupo: grupoListado() })
    const onAlterado = jest.fn()
    render(<GrupoBoletoPainel podeExecutar onAlterado={onAlterado} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ }))
    await waitFor(() =>
      expect(confirmar).toHaveBeenCalledWith({
        origem: 'SUGERIDO',
        ddcCod: 900,
        ditCod: 332841,
        titulos: TITULOS,
      }),
    )
    await waitFor(() => expect(onAlterado).toHaveBeenCalled())
    await waitFor(() => expect(sugestoes).toHaveBeenCalledTimes(2))
  })

  it('o botão fica desabilitado durante a chamada (sem clique duplo)', async () => {
    sugestoes.mockResolvedValue([sugestao()])
    let resolver: (v: unknown) => void = () => undefined
    confirmar.mockReturnValue(new Promise((r) => (resolver = r)))
    render(<GrupoBoletoPainel podeExecutar />)
    const botao = await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ })
    await userEvent.click(botao)
    expect(botao).toBeDisabled()
    await userEvent.click(botao)
    expect(confirmar).toHaveBeenCalledTimes(1)
    resolver({ criado: true, grupo: grupoListado() })
  })

  it('erro do servidor (409) aparece em português e o painel continua utilizável', async () => {
    sugestoes.mockResolvedValue([sugestao()])
    confirmar.mockRejectedValue(
      new AutorizacaoApiError('Um dos títulos já está em outro grupo.', 409, 'GRUPO_BOLETO_TITULO_INELEGIVEL'),
    )
    render(<GrupoBoletoPainel podeExecutar />)
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Um dos títulos já está em outro grupo.',
    )
    expect(screen.getByRole('button', { name: /^Confirmar grupo de PEDRONI/ })).toBeEnabled()
  })

  it('sem sispag:executar: lê tudo, nenhum botão de escrita', async () => {
    sugestoes.mockResolvedValue([sugestao()])
    grupos.mockResolvedValue([grupoListado()])
    render(<GrupoBoletoPainel podeExecutar={false} />)
    await screen.findByRole('article', { name: /PEDRONI/ })
    expect(screen.queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Anular grupo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Compor grupo/ })).not.toBeInTheDocument()
  })

  it('falha ao carregar: mensagem e "Tentar de novo"', async () => {
    sugestoes.mockRejectedValueOnce(new Error('Falha de rede')).mockResolvedValueOnce([sugestao()])
    render(<GrupoBoletoPainel podeExecutar />)
    expect(await screen.findByText('Falha de rede')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('article', { name: /PEDRONI/ })).toBeInTheDocument()
  })

  it('"Compor grupo manualmente" abre a composição (quem tem executar)', async () => {
    const onCompor = jest.fn()
    render(<GrupoBoletoPainel podeExecutar onCompor={onCompor} />)
    await userEvent.click(await screen.findByRole('button', { name: /Compor grupo manualmente/ }))
    expect(onCompor).toHaveBeenCalled()
  })
})

describe('GrupoBoletoPainel — grupos confirmados', () => {
  it.each([
    ['DISPONIVEL', 'Disponível'],
    ['EM_LOTE', 'Em lote'],
    ['EM_REMESSA', 'Em remessa'],
    ['REJEITADO', 'Rejeitado pelo banco'],
    ['RETIDO', 'Retido'],
    ['DIVERGENTE', 'Divergente'],
    ['ORFAO', 'Órfão'],
  ])('a situação %s aparece como "%s"', async (situacao, rotulo) => {
    grupos.mockResolvedValue([grupoListado({ situacao })])
    render(<GrupoBoletoPainel podeExecutar />)
    const tabela = await screen.findByRole('table', { name: /Boletos agrupados confirmados/ })
    expect(within(tabela).getByText(rotulo)).toBeInTheDocument()
  })

  it('REJEITADO diz o que fazer: resolva o borderô antigo no Conexos antes de pôr o grupo num lote novo', async () => {
    grupos.mockResolvedValue([grupoListado({ situacao: 'REJEITADO' })])
    render(<GrupoBoletoPainel podeExecutar />)
    expect(
      await screen.findByText(
        /Resolva o borderô antigo no Conexos antes de pôr o grupo num lote novo/,
      ),
    ).toBeInTheDocument()
  })

  it('anular abre o motivo (mínimo de 10 caracteres), chama a API e mostra o aviso de lote comprometido', async () => {
    grupos.mockResolvedValueOnce([grupoListado({ situacao: 'EM_REMESSA' })]).mockResolvedValueOnce([])
    anular.mockResolvedValue({
      anulado: true,
      grupo: grupoListado({ estado: 'ANULADO' }),
      avisoLoteComprometido: {
        loteId: 'L1',
        status: 'FINALIZADO',
        mensagem: 'O grupo está num lote finalizado: a próxima remessa o retira.',
      },
    })
    const onAlterado = jest.fn()
    render(<GrupoBoletoPainel podeExecutar onAlterado={onAlterado} />)
    await userEvent.click(await screen.findByRole('button', { name: /^Anular grupo de PEDRONI/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'curto')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular grupo' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('pelo menos 10 caracteres')
    expect(anular).not.toHaveBeenCalled()
    await userEvent.clear(within(dlg).getByLabelText('Motivo'))
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'boleto pago por fora do sistema')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular grupo' }))
    await waitFor(() => expect(anular).toHaveBeenCalledWith('G1', 'boleto pago por fora do sistema'))
    await waitFor(() => expect(onAlterado).toHaveBeenCalled())
    expect(await screen.findByRole('status')).toHaveTextContent(
      'O grupo está num lote finalizado: a próxima remessa o retira.',
    )
  })

  it('erro ao anular fica DENTRO do diálogo, que continua aberto', async () => {
    grupos.mockResolvedValue([grupoListado()])
    anular.mockRejectedValue(
      new AutorizacaoApiError('O grupo de boleto já foi pago: não pode ser anulado.', 409, 'GRUPO_BOLETO_ESTADO_CONFLITANTE'),
    )
    render(<GrupoBoletoPainel podeExecutar />)
    await userEvent.click(await screen.findByRole('button', { name: /^Anular grupo de PEDRONI/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'motivo suficientemente longo')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular grupo' }))
    expect(
      await within(dlg).findByText('O grupo de boleto já foi pago: não pode ser anulado.'),
    ).toBeInTheDocument()
  })

  it('sem grupos: estado vazio explica o que aparece aqui', async () => {
    render(<GrupoBoletoPainel podeExecutar />)
    expect(await screen.findByText('Nenhum boleto agrupado confirmado')).toBeInTheDocument()
  })
})

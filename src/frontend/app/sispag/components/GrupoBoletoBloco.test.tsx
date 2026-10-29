/**
 * O boleto agrupado inline (ADR-0077, I21v) — gaveta do título e linha da aba Boletos DDA. Cada
 * teste "Paridade" corresponde a uma linha do inventário da antiga aba Boletos agrupados (entrevista
 * de 2026-10-29): remover a aba não perde nada. Escrita só para `sispag:executar`; só a máscara 5+4.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  anularGrupoBoleto,
  AutorizacaoApiError,
  confirmarGrupoBoleto,
  fetchGruposBoleto,
  fetchSugestoesGrupoBoleto,
} from '@/lib/sispag'
import { GrupoBoletoDaFilial } from './GrupoBoletoDaFilial'
import { grupoConfirmado, sugestaoGrupo, TITULOS_PEDRONI } from './grupoBoleto.fixtures'

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

const DOC = TITULOS_PEDRONI[1] as { filCod: number; docCod: string; titCod: string }

const naGaveta = (over: { podeExecutar?: boolean; onAlterado?: () => void } = {}) =>
  render(
    <GrupoBoletoDaFilial
      filCod={2}
      onde={{ tipo: 'titulo', chave: DOC }}
      tituloAtual={DOC}
      podeExecutar={over.podeExecutar ?? true}
      onAlterado={over.onAlterado}
    />,
  )

beforeEach(() => {
  jest.clearAllMocks()
  sugestoes.mockResolvedValue([])
  grupos.mockResolvedValue([])
})

describe('Gaveta — o grupo inline', () => {
  it('Paridade (lista de sugestões): boleto mascarado, valor, vencimento, TODOS os títulos, a soma contra o boleto; o título atual destacado', async () => {
    sugestoes.mockResolvedValue([sugestaoGrupo()])
    naGaveta()
    const bloco = await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
    expect(within(bloco).getByText('34191…7500')).toBeInTheDocument()
    expect(within(bloco).getAllByText(/1\.575,00/).length).toBeGreaterThanOrEqual(2)
    expect(within(bloco).getByText('21/10/2026')).toBeInTheDocument()
    for (const t of TITULOS_PEDRONI) {
      expect(within(bloco).getByText(`${t.docCod}/${t.titCod}`)).toBeInTheDocument()
    }
    expect(within(bloco).getByText(/Soma dos títulos/)).toBeInTheDocument()
    const atual = within(bloco).getByText('38884/1').closest('li')
    expect(atual).toHaveAttribute('aria-current', 'true')
    expect(within(bloco).getByText('este título')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\d{44}|\d{47}/)
  })

  it('abre do mesmo jeito a partir de qualquer título do grupo', async () => {
    sugestoes.mockResolvedValue([sugestaoGrupo()])
    const outro = TITULOS_PEDRONI[2] as { filCod: number; docCod: string; titCod: string }
    render(
      <GrupoBoletoDaFilial
        filCod={2}
        onde={{ tipo: 'titulo', chave: outro }}
        tituloAtual={outro}
        podeExecutar
      />,
    )
    const bloco = await screen.findByRole('region', { name: /Boleto agrupado de PEDRONI/ })
    expect(within(bloco).getByText('38885/1').closest('li')).toHaveAttribute('aria-current', 'true')
    expect(within(bloco).getByText('38884/1').closest('li')).not.toHaveAttribute('aria-current')
  })

  it('pede os grupos da filial do título', async () => {
    naGaveta()
    await waitFor(() => expect(sugestoes).toHaveBeenCalledWith(2))
    expect(grupos).toHaveBeenCalledWith(2)
  })

  it('Paridade (não confirmável): motivo em português (alçada) e NENHUM botão de confirmar', async () => {
    sugestoes.mockResolvedValue([
      sugestaoGrupo({ confirmavel: false, motivo: 'NAO_LIBERADO', motivos: ['NAO_LIBERADO'] }),
    ])
    naGaveta()
    const bloco = await screen.findByRole('region', { name: /PEDRONI/ })
    expect(within(bloco).getByText(/aguardando alçada/)).toBeInTheDocument()
    expect(within(bloco).queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('Paridade (filiais diferentes): "não suportado ... pagar à mão", sem botão', async () => {
    sugestoes.mockResolvedValue([
      sugestaoGrupo({ confirmavel: false, motivo: 'CRUZA_FILIAL', motivos: ['CRUZA_FILIAL'] }),
    ])
    naGaveta()
    expect(
      await screen.findByText(/não suportado: títulos de filiais diferentes, pagar à mão/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('Paridade (intercambiável): explicado em uma linha', async () => {
    sugestoes.mockResolvedValue([sugestaoGrupo({ intercambiavel: true })])
    naGaveta()
    expect(await screen.findByText(/boletos iguais/i)).toBeInTheDocument()
  })

  it('Paridade (confirmar): chama a API com o boleto e os N títulos (origem SUGERIDO), relê o grupo e avisa a tela', async () => {
    sugestoes.mockResolvedValueOnce([sugestaoGrupo()]).mockResolvedValueOnce([])
    grupos.mockResolvedValueOnce([]).mockResolvedValueOnce([grupoConfirmado()])
    confirmar.mockResolvedValue({ criado: true, grupo: grupoConfirmado() })
    const onAlterado = jest.fn()
    naGaveta({ onAlterado })
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ }))
    await waitFor(() =>
      expect(confirmar).toHaveBeenCalledWith({
        origem: 'SUGERIDO',
        ddcCod: 900,
        ditCod: 332841,
        titulos: TITULOS_PEDRONI,
      }),
    )
    await waitFor(() => expect(onAlterado).toHaveBeenCalled())
    await waitFor(() => expect(sugestoes).toHaveBeenCalledTimes(2))
    // A gaveta fica aberta no estado novo: grupo confirmado, com Anular.
    expect(await screen.findByRole('button', { name: /^Anular grupo de PEDRONI/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Boleto agrupado confirmado.')
  })

  it('Paridade (clique duplo): o botão fica desabilitado durante a chamada', async () => {
    sugestoes.mockResolvedValue([sugestaoGrupo()])
    let resolver: (v: unknown) => void = () => undefined
    confirmar.mockReturnValue(new Promise((r) => (resolver = r)))
    naGaveta()
    const botao = await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ })
    await userEvent.click(botao)
    expect(botao).toBeDisabled()
    await userEvent.click(botao)
    expect(confirmar).toHaveBeenCalledTimes(1)
    resolver({ criado: true, grupo: grupoConfirmado() })
  })

  it('Paridade (erro 409): aparece em português e o bloco continua utilizável', async () => {
    sugestoes.mockResolvedValue([sugestaoGrupo()])
    confirmar.mockRejectedValue(
      new AutorizacaoApiError('Um dos títulos já está em outro grupo.', 409, 'GRUPO_BOLETO_TITULO_INELEGIVEL'),
    )
    naGaveta()
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Um dos títulos já está em outro grupo.')
    expect(screen.getByRole('button', { name: /^Confirmar grupo de PEDRONI/ })).toBeEnabled()
  })

  it('Paridade (sem sispag:executar): lê tudo, nenhum botão de escrita', async () => {
    sugestoes.mockResolvedValue([sugestaoGrupo()])
    naGaveta({ podeExecutar: false })
    await screen.findByRole('region', { name: /PEDRONI/ })
    expect(screen.queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('Paridade (falha ao carregar): mensagem e "Tentar de novo"', async () => {
    sugestoes.mockRejectedValueOnce(new Error('Falha de rede')).mockResolvedValueOnce([sugestaoGrupo()])
    naGaveta()
    expect(await screen.findByText('Falha de rede')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('region', { name: /PEDRONI/ })).toBeInTheDocument()
  })

  it('Paridade (loading): mostra o carregamento enquanto lê', async () => {
    sugestoes.mockReturnValue(new Promise(() => undefined))
    naGaveta()
    expect(await screen.findByText(/Carregando o grupo/)).toBeInTheDocument()
  })

  it('S2: sugestão com avisos pede o reconhecimento antes de enviar e manda reconheceAvisos', async () => {
    sugestoes.mockResolvedValue([
      sugestaoGrupo({
        avisos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
        titulos: TITULOS_PEDRONI.map((t) => ({
          ...t,
          motivos: [],
          valorCentavos: 52500,
          vencimento: '2026-10-20',
          deltaDias: 1,
        })),
      }),
    ])
    confirmar.mockResolvedValue({ criado: true, grupo: grupoConfirmado() })
    naGaveta()
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmar grupo de PEDRONI/ }))
    expect(confirmar).not.toHaveBeenCalled()
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('checkbox'))
    await userEvent.click(within(dlg).getByRole('button', { name: /Reconhecer|Confirmar/ }))
    await waitFor(() =>
      expect(confirmar).toHaveBeenCalledWith(
        expect.objectContaining({ reconheceAvisos: ['TITULO_VENCE_ANTES_DO_BOLETO'] }),
      ),
    )
  })
})

describe('Gaveta — grupo confirmado (EM_GRUPO)', () => {
  it.each([
    ['DISPONIVEL', 'Disponível'],
    ['EM_LOTE', 'Em lote'],
    ['EM_REMESSA', 'Em remessa'],
    ['REJEITADO', 'Rejeitado pelo banco'],
    ['RETIDO', 'Retido'],
    ['DIVERGENTE', 'Divergente'],
    ['ORFAO', 'Órfão'],
  ])('Paridade (situação): %s aparece como "%s"', async (situacao, rotulo) => {
    grupos.mockResolvedValue([grupoConfirmado({ situacao })])
    naGaveta()
    const bloco = await screen.findByRole('region', { name: /PEDRONI/ })
    expect(within(bloco).getByText(rotulo)).toBeInTheDocument()
  })

  it('Paridade (orientação): REJEITADO diz o que fazer no Conexos antes de pôr o grupo num lote novo', async () => {
    grupos.mockResolvedValue([grupoConfirmado({ situacao: 'REJEITADO' })])
    naGaveta()
    expect(
      await screen.findByText(/Resolva o borderô antigo no Conexos antes de pôr o grupo num lote novo/),
    ).toBeInTheDocument()
  })

  it('o confirmado vence a sugestão do mesmo título', async () => {
    sugestoes.mockResolvedValue([sugestaoGrupo()])
    grupos.mockResolvedValue([grupoConfirmado()])
    naGaveta()
    expect(await screen.findByRole('button', { name: /^Anular grupo de PEDRONI/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar grupo/ })).not.toBeInTheDocument()
  })

  it('Paridade (anular): motivo mínimo de 10 caracteres, chama a API e mostra o aviso de lote comprometido', async () => {
    grupos.mockResolvedValueOnce([grupoConfirmado({ situacao: 'EM_REMESSA' })]).mockResolvedValueOnce([])
    anular.mockResolvedValue({
      anulado: true,
      grupo: grupoConfirmado({ estado: 'ANULADO' }),
      avisoLoteComprometido: {
        loteId: 'L1',
        status: 'FINALIZADO',
        mensagem: 'O grupo está num lote finalizado: a próxima remessa o retira.',
      },
    })
    const onAlterado = jest.fn()
    naGaveta({ onAlterado })
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

  it('Paridade (anular com erro): fica DENTRO do diálogo, que continua aberto', async () => {
    grupos.mockResolvedValue([grupoConfirmado()])
    anular.mockRejectedValue(
      new AutorizacaoApiError('O grupo de boleto já foi pago: não pode ser anulado.', 409, 'GRUPO_BOLETO_ESTADO_CONFLITANTE'),
    )
    naGaveta()
    await userEvent.click(await screen.findByRole('button', { name: /^Anular grupo de PEDRONI/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'motivo suficientemente longo')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular grupo' }))
    expect(
      await within(dlg).findByText('O grupo de boleto já foi pago: não pode ser anulado.'),
    ).toBeInTheDocument()
  })

  it('Paridade (sem sispag:executar): sem Anular', async () => {
    grupos.mockResolvedValue([grupoConfirmado()])
    naGaveta({ podeExecutar: false })
    await screen.findByRole('region', { name: /PEDRONI/ })
    expect(screen.queryByRole('button', { name: /^Anular grupo/ })).not.toBeInTheDocument()
  })
})

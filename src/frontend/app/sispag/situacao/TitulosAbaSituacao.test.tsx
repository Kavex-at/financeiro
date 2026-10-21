import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  type CriarLotesPorFilialResult,
  criarLotesPorFilial,
  type LotePagamento,
  type ResumoSituacao,
} from '@/lib/sispag'
import { RESUMO_FIXTURE, TITULOS_FIXTURE } from '../__fixtures__/situacaoPagamento'
import { TitulosAbaSituacao } from './TitulosAbaSituacao'

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    criarLotesPorFilial: jest.fn(),
    desfazerBloqueioDuplicidade: jest.fn(),
    tentarAjusteCentavos: jest.fn(),
  }
})

const mockCriar = criarLotesPorFilial as jest.MockedFunction<typeof criarLotesPorFilial>

const lote = (status: LotePagamento['status']): LotePagamento =>
  ({ id: `l-${status}`, status, filCod: 1, itens: [] }) as unknown as LotePagamento

function montar(
  sobrescritas: Partial<React.ComponentProps<typeof TitulosAbaSituacao>> = {},
  resumo: ResumoSituacao = RESUMO_FIXTURE,
) {
  const props: React.ComponentProps<typeof TitulosAbaSituacao> = {
    titulos: TITULOS_FIXTURE,
    resumo,
    lotes: [lote('RASCUNHO'), lote('RASCUNHO'), lote('FINALIZADO')],
    lotesIndisponiveis: false,
    podeExecutar: true,
    busy: false,
    retidos: new Map(),
    resumoDoDesfecho: () => undefined,
    onAbrirSugestao: jest.fn(),
    onVerBoleto: jest.fn(),
    onIrParaLote: jest.fn(),
    onIrParaLotes: jest.fn(),
    onRetirar: jest.fn(),
    onResolvido: jest.fn(async () => undefined),
    onLotesCriados: jest.fn(async () => undefined),
    formando: false,
    onFormarAutomaticos: jest.fn(async () => undefined),
    ...sobrescritas,
  }
  render(<TitulosAbaSituacao {...props} />)
  return props
}

const linhasDaTabela = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)
const credoresVisiveis = () =>
  linhasDaTabela().map((r) => within(r).getAllByRole('cell')[1]?.textContent ?? '')

afterEach(() => jest.clearAllMocks())

describe('TitulosAbaSituacao: cards e faixa', () => {
  it('os quatro cards: prontos, precisam de ação (com dono), urgentes e lotes', () => {
    montar()
    const grupo = screen.getByLabelText('Resumo de ação')
    expect(within(grupo).getByText('Prontos para pagar')).toBeInTheDocument()
    expect(within(grupo).getByText('Precisam de ação')).toBeInTheDocument()
    expect(within(grupo).getByText(/5 com você/)).toBeInTheDocument()
    expect(within(grupo).getByText(/1 com aprovador/)).toBeInTheDocument()
    expect(within(grupo).getByText('Vencem em até 2 dias')).toBeInTheDocument()
    expect(within(grupo).getByText(/2 para finalizar · 1 para gerar remessa/)).toBeInTheDocument()
  })

  it('a faixa vermelha lista só bloqueados que vencem hoje (vencidos ficam de fora)', () => {
    montar()
    const faixa = screen.getByRole('region', { name: 'Bloqueados que vencem hoje' })
    expect(within(faixa).getByText(/2 bloqueados vencem hoje \(20\/10\/2026\)/)).toBeInTheDocument()
    expect(within(faixa).getByText(/LOGÍSTICA BETA/)).toBeInTheDocument()
    expect(within(faixa).getByText(/JOMED/)).toBeInTheDocument()
    expect(within(faixa).queryByText(/DEPÓSITO CENTRAL/)).not.toBeInTheDocument()
    expect(within(faixa).queryByText(/TRANSLOG SUL/)).not.toBeInTheDocument()
  })

  it('"Ver só estes" filtra Bloqueados que vencem hoje', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Ver só estes 2' }))
    expect(credoresVisiveis().sort()).toEqual(['JOMED', 'LOGÍSTICA BETA'].sort())
  })

  it('sem bloqueado vencendo hoje, a faixa não aparece', () => {
    montar({ titulos: TITULOS_FIXTURE.filter((t) => t.diasAteVencimento !== 0) })
    expect(screen.queryByRole('region', { name: 'Bloqueados que vencem hoje' })).not.toBeInTheDocument()
  })

  it('avisa quando uma fonte de situação ficou indisponível', () => {
    montar({}, { ...RESUMO_FIXTURE, fontesIndisponiveis: ['BOLETO'] })
    expect(screen.getByText(/Situação incompleta/)).toHaveTextContent(/sugestões de boleto/)
  })

  it('card de lotes diz que não carregou quando a lista de lotes falhou', () => {
    montar({ lotesIndisponiveis: true })
    expect(screen.getByText('não foi possível carregar os lotes')).toBeInTheDocument()
  })
})

describe('TitulosAbaSituacao: filtro externo e chips', () => {
  it('Todos mostra tudo, Prontos e Bloqueados particionam', async () => {
    montar()
    expect(linhasDaTabela()).toHaveLength(18)
    await userEvent.click(screen.getByRole('button', { name: /^Prontos/ }))
    expect(linhasDaTabela()).toHaveLength(9)
    await userEvent.click(screen.getByRole('button', { name: /^Bloqueados/ }))
    expect(linhasDaTabela()).toHaveLength(9)
  })

  it('os chips de motivo só aparecem em Bloqueados e filtram', async () => {
    montar()
    expect(screen.queryByRole('group', { name: 'Motivo do bloqueio' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Bloqueados/ }))
    const chips = screen.getByRole('group', { name: 'Motivo do bloqueio' })
    await userEvent.click(within(chips).getByRole('button', { name: /Vencido/ }))
    expect(credoresVisiveis().sort()).toEqual(['DEPÓSITO CENTRAL', 'TRANSLOG SUL'])
    await userEvent.click(within(chips).getByRole('button', { name: /Vencido/ }))
    expect(linhasDaTabela()).toHaveLength(9)
  })

  it('"Boleto sem DDA" marcado abre os sub-chips por sugestão, que filtram', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: /^Bloqueados/ }))
    const grupo = () => screen.queryByRole('group', { name: 'Boleto sem DDA por sugestão' })
    expect(grupo()).not.toBeInTheDocument()
    const chips = screen.getByRole('group', { name: 'Motivo do bloqueio' })
    await userEvent.click(within(chips).getByRole('button', { name: /Boleto sem DDA/ }))
    expect(linhasDaTabela()).toHaveLength(2)
    const sub = grupo()
    expect(sub).toBeInTheDocument()
    expect(within(sub as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Sugestão para confirmar1',
      'Sem boleto no DDA1',
    ])
    await userEvent.click(within(sub as HTMLElement).getByRole('button', { name: /Sugestão para confirmar/ }))
    expect(credoresVisiveis()).toEqual(['CEVA LOGISTICS'])
    // Desmarcar o motivo fecha a linha e descarta o sub-filtro.
    await userEvent.click(within(chips).getByRole('button', { name: /Boleto sem DDA/ }))
    expect(grupo()).not.toBeInTheDocument()
    expect(linhasDaTabela()).toHaveLength(9)
  })

  it('o botão "?" abre e fecha as regras', async () => {
    montar()
    const ajuda = screen.getByRole('button', { name: 'Como a situação é calculada' })
    expect(ajuda).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(ajuda)
    const regras = screen.getByRole('region', { name: 'Como a situação de pagamento é calculada' })
    expect(within(regras).getByText('Permuta ou adiantamento')).toBeInTheDocument()
    expect(within(regras).getByText('Aprovador')).toBeInTheDocument()
    await userEvent.click(ajuda)
    expect(screen.queryByRole('region', { name: 'Como a situação de pagamento é calculada' })).not.toBeInTheDocument()
  })
})

describe('TitulosAbaSituacao: tabela', () => {
  it('ordena por vencimento crescente por padrão: vencidos primeiro', () => {
    montar()
    expect(credoresVisiveis().slice(0, 2)).toEqual(['DEPÓSITO CENTRAL', 'TRANSLOG SUL'])
  })

  it('mostra a data do vencimento, não só os dias', () => {
    montar()
    const linha = linhasDaTabela().find((r) => r.textContent?.includes('NELSON HEUSI')) as HTMLElement
    expect(within(linha).getByText('22/10/2026')).toBeInTheDocument()
    expect(within(linha).getByText('vence em 2d')).toBeInTheDocument()
  })

  it('clicar no nome da coluna ordena (valor) e marca aria-sort', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Valor' }))
    expect(credoresVisiveis()[0]).toBe('NELSON HEUSI')
    expect(screen.getByRole('columnheader', { name: /Valor/ })).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Valor' }))
    expect(credoresVisiveis()[0]).toBe('SEGUROS MARÍTIMOS')
  })

  it('filtro de credor no cabeçalho gera etiqueta removível e "Limpar filtros"', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar Credor' }))
    await userEvent.type(await screen.findByLabelText('Filtrar Credor por texto'), 'ceva')
    await userEvent.keyboard('{Escape}')
    expect(credoresVisiveis().sort()).toEqual(['CEVA LOGISTICS', 'CEVA LOGISTICS'])
    expect(screen.getByText(/Mostrando 2 de 18 títulos/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Remover filtro: Credor contém "ceva"/ }))
    expect(linhasDaTabela()).toHaveLength(18)
  })

  it('a coluna Situação e os chips editam a mesma seleção', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: /^Bloqueados/ }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Motivo do bloqueio' })).getByRole('button', { name: /Boleto sem DDA/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar Situação' }))
    const caixa = await screen.findByRole('checkbox', { name: /Boleto sem DDA/ })
    expect(caixa).toBeChecked()
  })

  it('linha bloqueada não tem caixa de seleção; mostra motivo, dono e o botão da ação', () => {
    montar()
    const linha = linhasDaTabela().find((r) => r.textContent?.includes('TRANSPORTES YAMA')) as HTMLElement
    expect(within(linha).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(linha).getAllByText('Aguardando aprovação').length).toBeGreaterThan(0)
    expect(within(linha).getByText('resolve: aprovador')).toBeInTheDocument()
    expect(within(linha).getByRole('button', { name: 'Abrir no Conexos' })).toBeInTheDocument()
  })

  it('ação sem tela própria abre a orientação, com o documento para copiar', async () => {
    montar()
    const linha = linhasDaTabela().find((r) => r.textContent?.includes('TRANSPORTES YAMA')) as HTMLElement
    await userEvent.click(within(linha).getByRole('button', { name: 'Abrir no Conexos' }))
    expect(await screen.findByText('Cobrar a liberação no Conexos')).toBeInTheDocument()
    expect(screen.getByText('filial 1 · documento 5590/1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copiar o documento 5590/1' })).toBeInTheDocument()
  })

  it('"Ver boleto" abre o painel do boleto; permuta leva a Permutas', async () => {
    const props = montar()
    const jomed = linhasDaTabela().find((r) => r.textContent?.includes('JOMED')) as HTMLElement
    await userEvent.click(within(jomed).getByRole('button', { name: 'Ver boleto' }))
    expect(props.onVerBoleto).toHaveBeenCalledWith(expect.objectContaining({ docCod: '5544' }))
    const permuta = linhasDaTabela().find((r) => r.textContent?.includes('COLUMBIA ADTO')) as HTMLElement
    expect(within(permuta).getByRole('link', { name: 'Abrir em Permutas' })).toHaveAttribute('href', '/permutas')
    expect(within(permuta).getByText(/pode já ter permuta parcial/)).toBeInTheDocument()
  })

  it('quem só vê não tem caixas nem botões que escrevem', () => {
    montar({ podeExecutar: false })
    expect(screen.queryAllByRole('checkbox').length).toBe(0)
    expect(screen.queryByRole('button', { name: /Formar lotes automáticos/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Selecionar os 9 prontos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar o ajuste de novo' })).not.toBeInTheDocument()
  })
})

describe('TitulosAbaSituacao: seleção e lotes por filial', () => {
  it('"Selecionar os prontos" marca os 9 e a barra diz que serão 3 lotes', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar os 9 prontos' }))
    const barra = screen.getByRole('region', { name: 'Seleção de títulos' })
    expect(within(barra).getByText(/9 selecionados/)).toBeInTheDocument()
    expect(within(barra).getByText('Filiais 1, 3, 7: será criado um lote para cada filial.')).toBeInTheDocument()
    expect(within(barra).getByRole('button', { name: 'Criar 3 lotes' })).toBeInTheDocument()
  })

  it('selecionar um pronto de uma filial: "um lote"', async () => {
    montar()
    await userEvent.click(screen.getByRole('button', { name: /^Prontos/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar o título 116/1' }))
    const barra = screen.getByRole('region', { name: 'Seleção de títulos' })
    expect(within(barra).getByText('Filial 1: um lote.')).toBeInTheDocument()
    expect(within(barra).getByRole('button', { name: 'Criar 1 lote' })).toBeInTheDocument()
  })

  it('criar manda as chaves em UMA chamada e, com recusa, mostra o resultado por filial', async () => {
    const resultado: CriarLotesPorFilialResult = {
      lotes: [
        {
          filCod: 1,
          resultado: 'CRIADO',
          loteId: 'L1',
          incluidos: [{ filCod: 1, docCod: '116', titCod: '1' }],
          recusados: [],
        },
        {
          filCod: 7,
          resultado: 'PARCIAL',
          loteId: 'L7',
          incluidos: [{ filCod: 7, docCod: '5534', titCod: '1' }],
          recusados: [
            {
              chave: { filCod: 7, docCod: '5537', titCod: '1' },
              codigo: 'TITULO_NAO_ELEGIVEL',
              motivo: 'DUPLICIDADE',
              mensagem: 'Este título tem um bloqueio por duplicidade.',
            },
          ],
        },
      ],
    }
    mockCriar.mockResolvedValue(resultado)
    const props = montar()
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar os 9 prontos' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar 3 lotes' }))
    await waitFor(() => expect(mockCriar).toHaveBeenCalledTimes(1))
    const enviado = mockCriar.mock.calls[0][0].titulos
    expect(enviado).toHaveLength(9)
    expect(enviado).toContainEqual({ filCod: 7, docCod: '5570', titCod: '1' })
    expect(props.onLotesCriados).toHaveBeenCalled()
    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('2 lotes criados, mas 1 título(s) não entraram')).toBeInTheDocument()
    expect(within(dialogo).getByText('Criado em parte')).toBeInTheDocument()
    expect(within(dialogo).getByText('Possível duplicidade')).toBeInTheDocument()
    expect(within(dialogo).getByText('Este título tem um bloqueio por duplicidade.')).toBeInTheDocument()
    expect(within(dialogo).getByText(/PORTO SECO NORTE/)).toBeInTheDocument()
    await userEvent.click(within(dialogo).getAllByRole('button', { name: 'Abrir o lote' })[1])
    expect(props.onIrParaLote).toHaveBeenCalledWith('L7')
    // a seleção foi limpa
    expect(screen.queryByRole('region', { name: 'Seleção de títulos' })).not.toBeInTheDocument()
  })

  it('tudo certo: só um toast, sem diálogo', async () => {
    mockCriar.mockResolvedValue({
      lotes: [{ filCod: 1, resultado: 'CRIADO', loteId: 'L1', incluidos: [], recusados: [] }],
    })
    montar()
    await userEvent.click(screen.getByRole('button', { name: /^Prontos/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar o título 116/1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar 1 lote' }))
    await waitFor(() => expect(mockCriar).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  describe('título que já está em lote RASCUNHO (ADR-0064)', () => {
    const comRascunho = () =>
      TITULOS_FIXTURE.map((t) =>
        t.docCod === '116' && t.titCod === '1'
          ? { ...t, loteRascunho: { id: 'l-RASCUNHO', automatico: false } }
          : t,
      )
    const selecionarEClicar = async () => {
      await userEvent.click(screen.getByRole('button', { name: /^Prontos/ }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar o título 116/1' }))
      await userEvent.click(screen.getByRole('button', { name: 'Criar 1 lote' }))
    }

    it('pede a confirmação de onde ele sai ANTES de chamar o servidor', async () => {
      montar({ titulos: comRascunho() })
      await selecionarEClicar()
      const dialogo = await screen.findByRole('dialog')
      expect(dialogo).toHaveTextContent(/já estão em lotes em rascunho/)
      expect(mockCriar).not.toHaveBeenCalled()
    })

    it('confirmado, envia mover: true; cancelado, não envia nada', async () => {
      mockCriar.mockResolvedValue({
        lotes: [{ filCod: 1, resultado: 'CRIADO', loteId: 'L1', incluidos: [], recusados: [] }],
      })
      montar({ titulos: comRascunho() })
      await selecionarEClicar()
      let dialogo = await screen.findByRole('dialog')
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }))
      expect(mockCriar).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: 'Criar 1 lote' }))
      dialogo = await screen.findByRole('dialog')
      await userEvent.click(within(dialogo).getByRole('button', { name: /Mover e criar lote/ }))
      await waitFor(() => expect(mockCriar).toHaveBeenCalledTimes(1))
      expect(mockCriar.mock.calls[0][0]).toMatchObject({ mover: true })
    })

    it('sem título em rascunho na seleção, vai direto e SEM mover', async () => {
      mockCriar.mockResolvedValue({
        lotes: [{ filCod: 1, resultado: 'CRIADO', loteId: 'L1', incluidos: [], recusados: [] }],
      })
      montar()
      await userEvent.click(screen.getByRole('button', { name: /^Prontos/ }))
      await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar o título 116/1' }))
      await userEvent.click(screen.getByRole('button', { name: 'Criar 1 lote' }))
      await waitFor(() => expect(mockCriar).toHaveBeenCalledTimes(1))
      expect(mockCriar.mock.calls[0][0]).not.toHaveProperty('mover')
    })
  })

  it('"Formar lotes automáticos" mostra a prévia só com prontos e só chama o servidor ao confirmar', async () => {
    const props = montar()
    await userEvent.click(screen.getByRole('button', { name: /Formar lotes automáticos/ }))
    const previa = screen.getByRole('region', { name: 'Prévia dos lotes automáticos' })
    expect(within(previa).getByText(/7 título\(s\) em 2 filial\(is\)/)).toBeInTheDocument()
    expect(within(previa).getByText(/Filial 1/)).toBeInTheDocument()
    expect(within(previa).queryByText(/Filial 3/)).not.toBeInTheDocument()
    expect(within(previa).getByText(/Ficam de fora 9 bloqueado\(s\)/)).toBeInTheDocument()
    expect(props.onFormarAutomaticos).not.toHaveBeenCalled()
    await userEvent.click(within(previa).getByRole('button', { name: 'Formar os lotes' }))
    expect(props.onFormarAutomaticos).toHaveBeenCalledTimes(1)
  })
})

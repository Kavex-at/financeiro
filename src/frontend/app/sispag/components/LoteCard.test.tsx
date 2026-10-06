/**
 * Transições do lote passam por uma confirmação que nomeia o lote (filial, títulos, total) antes
 * de chamar a API — antes disparavam no primeiro clique. O "Marcar retorno recebido" foi
 * aposentado (ADR-0055): o status segue a baixa dos títulos, via "Sincronizar agora".
 */

import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { LotePagamento } from '@/lib/sispag'
import type { Acao } from './GerarRemessaDialog'
import { LoteCard } from './LoteCard'

/** Permissões do usuário no teste (ADR-0053). Padrão: o Administrador (as nove). */
let permissoes: { carregando: boolean; lista: Permissao[] } = {
  carregando: false,
  lista: [...CATALOGO_PERMISSOES],
}
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({
    carregando: permissoes.carregando,
    tem: (p: Permissao) => !permissoes.carregando && permissoes.lista.includes(p),
  }),
}))

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchContasPagadoras: jest.fn().mockResolvedValue([]),
    fetchModalidadesDisponiveis: jest.fn().mockResolvedValue([]),
    fetchLinhasDigitaveis: jest.fn().mockResolvedValue({ itens: [], total: 0, dropped: 0 }),
    finalizarLote: jest.fn(),
    cancelarLote: jest.fn(),
    reabrirLote: jest.fn(),
    sincronizarLote: jest.fn(),
    baixarRemessa: jest.fn(),
    removerItem: jest.fn(),
    // ADR-0054: por padrão as flags estão desligadas — a tela de antes.
    getRecursos: jest
      .fn()
      .mockResolvedValue({ tedEnabled: false, excecaoDestinoEnabled: false, pixEnabled: false }),
  }
})

jest.mock('@/lib/download', () => ({
  ...jest.requireActual('@/lib/download'),
  baixarBlob: jest.fn(),
}))

import { baixarBlob } from '@/lib/download'
import {
  baixarRemessa,
  cancelarLote,
  fetchContasPagadoras,
  fetchLinhasDigitaveis,
  fetchModalidadesDisponiveis,
  finalizarLote,
  getRecursos,
  reabrirLote,
  sincronizarLote,
} from '@/lib/sispag'

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
  id: 'L1',
  filCod: 7,
  status: 'RASCUNHO',
  criadoPor: 'u1',
  versao: 3,
  itens: [
    {
      loteId: 'L1',
      filCod: 7,
      docCod: '801',
      titCod: '1',
      valor: 100,
      modalidade: 'PIX',
      incluidoPor: 'u1',
    } as LotePagamento['itens'][number],
  ],
  ...over,
})

/** `acao` que executa a chamada, como o `acaoLote` do page.tsx. */
const acaoQueExecuta = (): jest.MockedFunction<Acao> =>
  jest.fn<void, Parameters<Acao>>((fn) => {
    void fn()
  })

const renderCard = (l: LotePagamento, acao: Acao = acaoQueExecuta()) => {
  render(<LoteCard lote={l} busy={false} acao={acao} />)
  return acao
}

describe('LoteCard — confirmação das transições', () => {
  const envOriginal = process.env.NEXT_PUBLIC_ENV
  beforeEach(() => {
    jest.clearAllMocks()
    permissoes = { carregando: false, lista: [...CATALOGO_PERMISSOES] }
  })
  afterEach(() => {
    process.env.NEXT_PUBLIC_ENV = envOriginal
  })

  it('Finalizar abre a confirmação com o lote e só chama a API ao confirmar', async () => {
    const user = userEvent.setup()
    const acao = renderCard(lote())

    await user.click(screen.getByRole('button', { name: /^finalizar$/i }))

    expect(acao).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Finalizar lote' })
    expect(within(dialog).getByText(/Filial 7 · 1 título\(s\)/)).toBeInTheDocument()
    expect(within(dialog).getByText('Lote L1')).toBeInTheDocument()
    expect(within(dialog).getByText(/Nada é enviado ao Conexos/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Finalizar lote' }))

    expect(finalizarLote).toHaveBeenCalledWith('L1', 3)
    expect(acao).toHaveBeenCalledWith(expect.any(Function), 'Lote finalizado')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Voltar" fecha sem cancelar o lote', async () => {
    const user = userEvent.setup()
    const acao = renderCard(lote())

    await user.click(screen.getByRole('button', { name: /^cancelar$/i }))
    const dialog = screen.getByRole('dialog', { name: 'Cancelar lote' })
    expect(within(dialog).getByText(/não pode ser reaberto/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Voltar' }))

    expect(acao).not.toHaveBeenCalled()
    expect(cancelarLote).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Reabrir com lote nativo avisa que o flp do fin015 não é alterado', async () => {
    const user = userEvent.setup()
    renderCard(lote({ status: 'FINALIZADO', nativeFlpCod: 4321 }))

    await user.click(screen.getByRole('button', { name: /^reabrir$/i }))
    const dialog = screen.getByRole('dialog', { name: 'Reabrir lote' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'O lote nativo flp 4321 já existe no Conexos (fin015)',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Reabrir lote' }))

    expect(reabrirLote).toHaveBeenCalledWith('L1', 3)
  })

  it('lote FINALIZADO ainda não tem remessa: o badge diz "aguardando remessa"', () => {
    renderCard(lote({ status: 'FINALIZADO' }))

    expect(screen.getByText('aguardando remessa')).toBeInTheDocument()
    expect(screen.queryByText('aguardando retorno')).not.toBeInTheDocument()
  })

  it.each(['local', 'prd'])(
    '"Marcar retorno recebido" não existe mais, nem em dev local (%s) — ADR-0055',
    (env) => {
      process.env.NEXT_PUBLIC_ENV = env
      renderCard(lote({ status: 'FINALIZADO' }))
      expect(screen.getByRole('button', { name: /reabrir/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /marcar retorno/i })).not.toBeInTheDocument()
    },
  )
})

/**
 * ADR-0053: com só `sispag:ver`, nenhuma ação do lote aparece (escondida, nunca desabilitada), e a
 * tela não chama as leituras que o backend reserva a `sispag:executar` (JC-3: contas pagadoras e
 * arquivo `.REM`; linhas digitáveis, ver `_inbox/auth-permissoes-modulo-gap.md`).
 */
describe('LoteCard — só sispag:ver', () => {
  const envOriginal = process.env.NEXT_PUBLIC_ENV
  beforeEach(() => {
    jest.clearAllMocks()
    permissoes = { carregando: false, lista: ['sispag:ver'] }
    process.env.NEXT_PUBLIC_ENV = 'local'
  })
  afterEach(() => {
    process.env.NEXT_PUBLIC_ENV = envOriginal
    permissoes = { carregando: false, lista: [...CATALOGO_PERMISSOES] }
  })

  const renderRascunhoAberto = async () => {
    const user = userEvent.setup()
    render(<LoteCard lote={lote()} busy={false} acao={acaoQueExecuta()} onAdicionar={jest.fn()} />)
    await user.click(screen.getByRole('button', { expanded: false }))
  }

  it.each([
    ['Adicionar título', /adicionar título/i],
    ['Finalizar', /^finalizar$/i],
    ['Cancelar', /^cancelar$/i],
    ['Remover item', /remover título/i],
  ])('rascunho: "%s" não aparece', async (_nome, rotulo) => {
    await renderRascunhoAberto()
    expect(screen.queryByRole('button', { name: rotulo })).not.toBeInTheDocument()
  })

  it('rascunho: escolher conta não aparece e as contas pagadoras NÃO são buscadas (JC-3)', async () => {
    await renderRascunhoAberto()
    expect(screen.queryByRole('combobox', { name: /conta pagadora/i })).not.toBeInTheDocument()
    expect(fetchContasPagadoras).not.toHaveBeenCalled()
  })

  it('rascunho: a modalidade vira texto (sem seletor) e as disponíveis não são buscadas', async () => {
    await renderRascunhoAberto()
    expect(
      screen.queryByRole('combobox', { name: /forma de pagamento/i }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('PIX')).toBeInTheDocument()
    expect(fetchModalidadesDisponiveis).not.toHaveBeenCalled()
  })

  it.each([
    ['Gerar remessa', /gerar remessa/i],
    ['Reabrir', /^reabrir$/i],
  ])('finalizado: "%s" não aparece', (_nome, rotulo) => {
    renderCard(lote({ status: 'FINALIZADO' }))
    expect(screen.queryByRole('button', { name: rotulo })).not.toBeInTheDocument()
  })

  it('remessa gerada: "Sincronizar agora" não aparece sem sispag:executar', () => {
    renderCard(lote({ status: 'REMESSA_GERADA' }))
    expect(screen.queryByRole('button', { name: /sincronizar agora/i })).not.toBeInTheDocument()
  })

  it('remessa gerada: "Baixar .REM" não aparece e o arquivo não é pedido (JC-3)', () => {
    renderCard(lote({ status: 'REMESSA_GERADA', remessaArquivo: 'PG280901.REM' }))
    expect(screen.queryByRole('button', { name: /baixar/i })).not.toBeInTheDocument()
    expect(baixarRemessa).not.toHaveBeenCalled()
  })

  it('remessa gerada com boleto: as linhas digitáveis são buscadas (basta sispag:ver)', async () => {
    const user = userEvent.setup()
    const l = lote({ status: 'REMESSA_GERADA' })
    l.itens[0].modalidade = 'BOLETO'
    render(<LoteCard lote={l} busy={false} acao={acaoQueExecuta()} />)
    await user.click(screen.getByRole('button', { expanded: false }))
    await waitFor(() => expect(fetchLinhasDigitaveis).toHaveBeenCalledWith(l.id))
  })

  it('enquanto as permissões carregam, nenhuma ação aparece (nada pisca)', () => {
    permissoes = { carregando: true, lista: [...CATALOGO_PERMISSOES] }
    renderCard(lote())
    expect(screen.queryByRole('button', { name: /^finalizar$/i })).not.toBeInTheDocument()
    expect(fetchContasPagadoras).not.toHaveBeenCalled()
  })

  it('com sispag:executar tudo volta como hoje (e as contas são buscadas)', () => {
    permissoes = { carregando: false, lista: ['sispag:ver', 'sispag:executar'] }
    renderCard(lote())
    expect(screen.getByRole('button', { name: /^finalizar$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancelar$/i })).toBeInTheDocument()
    expect(fetchContasPagadoras).toHaveBeenCalledWith(7)
  })
})

describe('LoteCard — destino de TED/PIX: cadastro primeiro, exceção como fallback (ADR-0061)', () => {
  const ligado = { tedEnabled: true, excecaoDestinoEnabled: true, pixEnabled: true }
  const desligado = { tedEnabled: false, excecaoDestinoEnabled: false, pixEnabled: false }
  const itemTed = (over: Partial<LotePagamento['itens'][number]> = {}) =>
    ({
      loteId: 'L1',
      filCod: 7,
      docCod: '801',
      titCod: '1',
      valor: 100,
      credor: 'ACME',
      modalidade: 'TED',
      incluidoPor: 'u1',
      ...over,
    }) as LotePagamento['itens'][number]

  beforeEach(() => {
    jest.clearAllMocks()
    permissoes = { carregando: false, lista: [...CATALOGO_PERMISSOES] }
    ;(getRecursos as jest.Mock).mockResolvedValue(desligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([])
  })

  const abrir = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /filial 7/i }))
  }

  it('flags desligadas: nenhum selo nem botão de exceção — igual ao main', async () => {
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      { docCod: '801', titCod: '1', modalidades: [] },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed()] }))
    await abrir(user)
    await waitFor(() => expect(getRecursos).toHaveBeenCalled())
    expect(screen.queryByText(/aguardando exceção/i)).not.toBeInTheDocument()
    expect(screen.queryByText('exceção')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cadastrar exceção/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^finalizar$/i })).toBeEnabled()
  })

  it('destino do cadastro aparece MASCARADO, sem selo de exceção', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      {
        docCod: '801',
        titCod: '1',
        modalidades: ['TED'],
        destinos: { TED: { origem: 'CADASTRO', destinoMascarado: 'banco 237 · cc ****1111-0' } },
      },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed()] }))
    await abrir(user)
    expect(await screen.findByText('cadastro: banco 237 · cc ****1111-0')).toBeInTheDocument()
    expect(screen.queryByText('exceção')).not.toBeInTheDocument()
  })

  it('destino de exceção APROVADA: selo "exceção" com a máscara vinda da oferta', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      {
        docCod: '801',
        titCod: '1',
        modalidades: ['TED'],
        destinos: {
          TED: { origem: 'EXCECAO', destinoMascarado: 'banco 237 · ag. 1234 · cc ****7766-1' },
        },
      },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed()] }))
    await abrir(user)
    expect(await screen.findByText('banco 237 · ag. 1234 · cc ****7766-1')).toBeInTheDocument()
    expect(screen.getByText('exceção')).toBeInTheDocument()
  })

  it('item TED sem destino: aviso de que sai do lote ao finalizar; Finalizar segue habilitado (ADR-0063, I10b revisado)', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      { docCod: '801', titCod: '1', modalidades: [] },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed()] }))
    await abrir(user)
    expect(
      await screen.findByText('sem conta/chave no cadastro: sai do lote ao finalizar'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sem conta (TED) ou chave PIX no cadastro do Conexos para: 801/1 (ACME)',
    )
    // Quem decide é a verificação do finalizar (I13j): o botão não trava por isso.
    expect(screen.getByRole('button', { name: /^finalizar$/i })).toBeEnabled()
  })

  it('quem tem sispag:excecao vê o link para a tela de exceções e o atalho de cadastro', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      { docCod: '801', titCod: '1', modalidades: [] },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed()] }))
    await abrir(user)
    const link = await screen.findByRole('link', { name: /exceções de destino/i })
    expect(link).toHaveAttribute('href', '/sispag/excecoes')
    await user.click(
      screen.getByRole('button', { name: /cadastrar exceção de destino para o favorecido do título 801\/1/i }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Cadastrar exceção de destino' })
    expect(within(dialog).getByText(/título 801\/1 · ACME/)).toBeInTheDocument()
    // Favorecido do título: nenhum campo de pesCod/filial.
    expect(within(dialog).queryByLabelText(/código do favorecido/i)).not.toBeInTheDocument()
  })

  it('sem sispag:excecao: só o texto, sem link nem botão (esconder, não desabilitar)', async () => {
    permissoes = {
      carregando: false,
      lista: CATALOGO_PERMISSOES.filter((p) => p !== 'sispag:excecao'),
    }
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      { docCod: '801', titCod: '1', modalidades: [] },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed()] }))
    await abrir(user)
    expect(
      await screen.findByText('sem conta/chave no cadastro: sai do lote ao finalizar'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /exceções de destino/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cadastrar exceção/i })).not.toBeInTheDocument()
  })

  it('fora de RASCUNHO não há atalho de cadastro', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    const user = userEvent.setup()
    renderCard(lote({ status: 'FINALIZADO', itens: [itemTed()] }))
    await abrir(user)
    await waitFor(() => expect(getRecursos).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /cadastrar exceção/i })).not.toBeInTheDocument()
  })

  it('o diálogo do atalho abre na aba PIX quando o favorecido tem chave CPF/CNPJ no próprio documento (D12)', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      {
        docCod: '801',
        titCod: '1',
        modalidades: ['PIX'],
        destinos: {
          PIX: {
            origem: 'CADASTRO',
            destinoMascarado: 'PIX CPF/CNPJ ***.444.777-**',
            chaveCpfCnpjDoFavorecido: true,
          },
        },
      },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed({ modalidade: 'TED' })] }))
    await abrir(user)
    await waitFor(() => expect(fetchModalidadesDisponiveis).toHaveBeenCalled())
    await user.click(
      await screen.findByRole('button', { name: /cadastrar exceção de destino para o favorecido/i }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Cadastrar exceção de destino' })
    expect(within(dialog).getByRole('tab', { name: /PIX/ })).toHaveAttribute('aria-selected', 'true')
  })
})

/** ADR-0055: o status do lote segue a baixa do título — "Sincronizar agora" e situação por item. */
describe('LoteCard — sincronização pelo título (ADR-0055)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    permissoes = { carregando: false, lista: [...CATALOGO_PERMISSOES] }
  })

  const itemSinc = (over: Partial<LotePagamento['itens'][number]> = {}) =>
    ({
      loteId: 'L1',
      filCod: 7,
      docCod: '801',
      titCod: '1',
      valor: 100,
      modalidade: 'PIX',
      incluidoPor: 'u1',
      ...over,
    }) as LotePagamento['itens'][number]

  it.each(['REMESSA_GERADA', 'RETORNADO', 'BAIXADO'] as const)(
    '"Sincronizar agora" aparece em %s e chama a API pelo caminho das ações',
    async (status) => {
      const user = userEvent.setup()
      const acao = renderCard(lote({ status }))
      await user.click(screen.getByRole('button', { name: /sincronizar agora/i }))
      expect(sincronizarLote).toHaveBeenCalledWith('L1')
      expect(acao).toHaveBeenCalledWith(expect.any(Function), 'Lote sincronizado')
    },
  )

  it.each(['RASCUNHO', 'FINALIZADO', 'CANCELADO'] as const)(
    '"Sincronizar agora" NÃO aparece em %s (não há remessa para acompanhar)',
    (status) => {
      renderCard(lote({ status }))
      expect(screen.queryByRole('button', { name: /sincronizar agora/i })).not.toBeInTheDocument()
    },
  )

  it('o botão fica desabilitado enquanto uma ação está em curso (carregando)', () => {
    render(<LoteCard lote={lote({ status: 'REMESSA_GERADA' })} busy acao={acaoQueExecuta()} />)
    expect(screen.getByRole('button', { name: /sincronizar agora/i })).toBeDisabled()
  })

  it('cada item mostra a situação (PAGO/AGENDADO/REJEITADO/SEM_RETORNO)', async () => {
    const user = userEvent.setup()
    renderCard(
      lote({
        status: 'REMESSA_GERADA',
        itens: [
          itemSinc({ docCod: '1', situacao: 'PAGO' }),
          itemSinc({ docCod: '2', situacao: 'AGENDADO' }),
          itemSinc({ docCod: '3', situacao: 'REJEITADO' }),
          itemSinc({ docCod: '4', situacao: 'SEM_RETORNO' }),
        ],
      }),
    )
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('pago')).toBeInTheDocument()
    expect(screen.getByText('agendado')).toBeInTheDocument()
    expect(screen.getByText('rejeitado')).toBeInTheDocument()
    expect(screen.getByText('sem retorno')).toBeInTheDocument()
  })

  it('divergência aparece com o detalhe no item', async () => {
    const user = userEvent.setup()
    renderCard(
      lote({
        status: 'BAIXADO',
        itens: [
          itemSinc({
            situacao: 'PAGO',
            divergencia: true,
            divergenciaDetalhe: 'título pago voltou a aberto no fin064 (estorno?)',
          }),
        ],
      }),
    )
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/divergência/i)).toBeInTheDocument()
    expect(screen.getByText(/voltou a aberto/)).toBeInTheDocument()
  })

  it('pago fora do retorno mostra o borderô da baixa', async () => {
    const user = userEvent.setup()
    renderCard(
      lote({
        status: 'BAIXADO',
        itens: [
          itemSinc({
            situacao: 'PAGO',
            origemBaixa: 'FORA_DO_RETORNO',
            borCod: 22320,
            pagoEm: '2026-09-24T15:00:00.000Z',
          }),
        ],
      }),
    )
    await user.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(/borderô 22320/)).toBeInTheDocument()
    expect(screen.getByText(/fora do retorno/i)).toBeInTheDocument()
  })

  it('o card mostra "sincronizado em" (a leitura mais recente)', () => {
    renderCard(
      lote({
        status: 'REMESSA_GERADA',
        itens: [itemSinc({ situacao: 'AGENDADO', sincronizadoEm: '2026-09-29T14:35:00.000Z' })],
      }),
    )
    expect(screen.getByText(/sincronizado em/i)).toBeInTheDocument()
  })

  it('lote RETORNADO fica destacado e diz que exige tratamento', () => {
    renderCard(lote({ status: 'RETORNADO' }))
    expect(screen.getByText(/rejeitado pelo banco/i)).toBeInTheDocument()
    expect(document.getElementById('lote-L1')?.className).toMatch(/border-danger/)
  })
})

describe('LoteCard — download da remessa e seleção para o export', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    permissoes = { carregando: false, lista: ['sispag:ver', 'sispag:executar'] }
  })

  it.each(['REMESSA_GERADA', 'RETORNADO', 'BAIXADO'] as const)(
    '%s: "Baixar remessa" aparece no cabeçalho mesmo sem remessaArquivo na lista',
    (status) => {
      // Causa-raiz do "não vi o download": a lista vinha sem `remessaArquivo` e o botão sumia.
      renderCard(lote({ status }))
      expect(screen.getByRole('button', { name: /baixar remessa/i })).toBeInTheDocument()
      // O export de títulos é só pela seleção + barra da aba Finalizados (sem atalho no card).
      expect(screen.queryByRole('button', { name: /exportar títulos/i })).not.toBeInTheDocument()
    },
  )

  it.each(['RASCUNHO', 'FINALIZADO'] as const)('%s: sem download', (status) => {
    renderCard(lote({ status }))
    expect(screen.queryByRole('button', { name: /baixar remessa/i })).not.toBeInTheDocument()
  })

  it('baixar entrega os bytes do backend com o nome anunciado', async () => {
    const user = userEvent.setup()
    const arquivo = new Blob(['CNAB'])
    ;(baixarRemessa as jest.Mock).mockResolvedValue({ nome: 'PG061001.REM', arquivo })
    const acao = renderCard(lote({ status: 'REMESSA_GERADA', remessaArquivo: 'PG061001.REM' }))
    await user.click(screen.getByRole('button', { name: /baixar remessa/i }))
    expect(acao).toHaveBeenCalledWith(expect.any(Function), 'Remessa PG061001.REM baixada')
    await waitFor(() => expect(baixarBlob).toHaveBeenCalledWith(arquivo, 'PG061001.REM'))
  })

  it('só sispag:ver: não baixa o .REM (dados bancários dos fornecedores)', () => {
    permissoes = { carregando: false, lista: ['sispag:ver'] }
    renderCard(lote({ status: 'REMESSA_GERADA', remessaArquivo: 'PG061001.REM' }))
    expect(screen.queryByRole('button', { name: /baixar remessa/i })).not.toBeInTheDocument()
  })

  it('caixa de seleção só com onSelecionar e só em lote com remessa', async () => {
    const user = userEvent.setup()
    const onSelecionar = jest.fn()
    const { rerender } = render(
      <LoteCard
        lote={lote({ status: 'REMESSA_GERADA' })}
        busy={false}
        acao={acaoQueExecuta()}
        onSelecionar={onSelecionar}
      />,
    )
    await user.click(screen.getByRole('checkbox', { name: /selecionar lote/i }))
    expect(onSelecionar).toHaveBeenCalledWith(expect.objectContaining({ id: 'L1' }), true)

    rerender(
      <LoteCard
        lote={lote({ status: 'FINALIZADO' })}
        busy={false}
        acao={acaoQueExecuta()}
        onSelecionar={onSelecionar}
      />,
    )
    expect(screen.queryByRole('checkbox', { name: /selecionar lote/i })).not.toBeInTheDocument()
  })
})

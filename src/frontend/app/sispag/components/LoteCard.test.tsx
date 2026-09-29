/**
 * Transições do lote passam por uma confirmação que nomeia o lote (filial, títulos, total) antes
 * de chamar a API — antes disparavam no primeiro clique. E o "Marcar retorno recebido", que é
 * simulação, só aparece em dev local.
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
    marcarRetorno: jest.fn(),
    baixarRemessa: jest.fn(),
    removerItem: jest.fn(),
    // ADR-0054: por padrão as flags estão desligadas — a tela de antes.
    getRecursos: jest
      .fn()
      .mockResolvedValue({ tedEnabled: false, destinoManualEnabled: false, pixEnabled: false }),
    limparDestinoItem: jest.fn(),
  }
})

import {
  baixarRemessa,
  cancelarLote,
  fetchContasPagadoras,
  fetchLinhasDigitaveis,
  fetchModalidadesDisponiveis,
  finalizarLote,
  getRecursos,
  marcarRetorno,
  reabrirLote,
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

  it('"Marcar retorno recebido" (simulação) não aparece fora de dev local', () => {
    process.env.NEXT_PUBLIC_ENV = 'prd'
    renderCard(lote({ status: 'FINALIZADO' }))

    expect(screen.getByRole('button', { name: /reabrir/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /marcar retorno/i })).not.toBeInTheDocument()
  })

  it('em dev local, "Marcar retorno recebido" aparece e confirma que é simulação', async () => {
    process.env.NEXT_PUBLIC_ENV = 'local'
    const user = userEvent.setup()
    renderCard(lote({ status: 'FINALIZADO' }))

    await user.click(screen.getByRole('button', { name: /marcar retorno recebido/i }))
    const dialog = screen.getByRole('dialog', { name: 'Simular retorno do Nexxera' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/simulação/)
    expect(marcarRetorno).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Marcar retorno recebido' }))
    expect(marcarRetorno).toHaveBeenCalledWith('L1', 3)
  })
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
    ['Marcar retorno (simulação, mesmo em dev local)', /marcar retorno/i],
  ])('finalizado: "%s" não aparece', (_nome, rotulo) => {
    renderCard(lote({ status: 'FINALIZADO' }))
    expect(screen.queryByRole('button', { name: rotulo })).not.toBeInTheDocument()
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

describe('LoteCard — destino de TED/PIX (ADR-0054)', () => {
  const ligado = { tedEnabled: true, destinoManualEnabled: true, pixEnabled: false }
  const desligado = { tedEnabled: false, destinoManualEnabled: false, pixEnabled: false }
  const itemTed = (over: Partial<LotePagamento['itens'][number]> = {}) =>
    ({
      loteId: 'L1',
      filCod: 7,
      docCod: '801',
      titCod: '1',
      valor: 100,
      modalidade: 'TED',
      incluidoPor: 'u1',
      ...over,
    }) as LotePagamento['itens'][number]

  beforeEach(() => {
    jest.clearAllMocks()
    ;(getRecursos as jest.Mock).mockResolvedValue(desligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([])
  })

  const abrir = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /filial 7/i }))
  }

  it('flags desligadas: nenhum botão de destino, nenhum selo — igual ao main', async () => {
    const user = userEvent.setup()
    renderCard(
      lote({
        itens: [
          itemTed({
            destinoManualResumo: { tipo: 'CONTA', destinoMascarado: 'banco 237 · cc ****7766-1' },
          }),
        ],
      }),
    )
    await abrir(user)
    await waitFor(() => expect(getRecursos).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /informar destino/i })).not.toBeInTheDocument()
    expect(screen.queryByText('manual')).not.toBeInTheDocument()
    expect(screen.queryByText(/\*\*\*\*7766/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^finalizar$/i })).toBeEnabled()
  })

  it('flag manual ligada e RASCUNHO: botão "Informar destino" ao lado da forma de pagamento', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed()] }))
    await abrir(user)
    await user.click(await screen.findByRole('button', { name: /informar destino do título 801\/1/i }))
    expect(screen.getByRole('dialog', { name: 'Informar destino' })).toBeInTheDocument()
  })

  it('destino manual aparece MASCARADO como veio do backend, com o selo "manual"', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      { docCod: '801', titCod: '1', modalidades: ['TED'] },
    ])
    const user = userEvent.setup()
    renderCard(
      lote({
        itens: [
          itemTed({
            destinoManualResumo: {
              tipo: 'CONTA',
              destinoMascarado: 'banco 237 · ag. 1234 · cc ****7766-1',
              informadoPor: 'ana',
            },
          }),
        ],
      }),
    )
    await abrir(user)
    expect(await screen.findByText('banco 237 · ag. 1234 · cc ****7766-1')).toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()
  })

  it('fora de RASCUNHO o destino é só leitura (sem botão)', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    const user = userEvent.setup()
    renderCard(
      lote({
        status: 'FINALIZADO',
        itens: [
          itemTed({ destinoManualResumo: { tipo: 'CONTA', destinoMascarado: 'banco 237 · cc ****7766-1' } }),
        ],
      }),
    )
    await abrir(user)
    expect(await screen.findByText('banco 237 · cc ****7766-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /informar destino/i })).not.toBeInTheDocument()
  })

  it('item TED sem destino: Finalizar desabilitado com a mensagem do backend', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
    ;(fetchModalidadesDisponiveis as jest.Mock).mockResolvedValue([
      { docCod: '801', titCod: '1', modalidades: [] },
    ])
    const user = userEvent.setup()
    renderCard(lote({ itens: [itemTed({ credor: 'ACME' })] }))
    await abrir(user)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^finalizar$/i })).toBeDisabled(),
    )
    expect(screen.getByRole('button', { name: /^finalizar$/i })).toHaveAttribute(
      'title',
      expect.stringContaining('Sem destino de pagamento para: 801/1 (ACME)'),
    )
  })
})

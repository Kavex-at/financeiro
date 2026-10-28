import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SispagPage from '@/app/sispag/page'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import {
  atualizarCarteiraSeDefasada,
  type ArquivoRetorno,
  conciliarRetorno,
  fetchBoletosDda,
  fetchContasPagadoras,
  fetchLotes,
  fetchRetornos,
  fetchSispagPainel,
  type LotePagamento,
  type SispagPainel,
  type TituloAPagar,
} from '@/lib/sispag'

/** Permissões do usuário no teste (ADR-0053). Padrão: o Administrador (as nove). */
let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: (p: Permissao) => permissoes.includes(p) }),
}))
beforeEach(() => {
  permissoes = [...CATALOGO_PERMISSOES]
})

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }))

const painel: SispagPainel = {
  geradoEm: '2026-09-23T14:00:00.000Z',
  modo: { somenteLeitura: true, conexosWriteEnabled: false, conexosDryRun: true },
  ingestao: {},
  kpis: {
    titulosAVencer7d: 0,
    titulosAVencer30d: 0,
    titulosVencidos: 0,
    valorAVencer30d: 0,
    lotesAbertos: 0,
    lotesEnviados: 0,
  },
  titulos: [],
  lotes: [],
}

const loteRascunho: LotePagamento = {
  id: 'lote-1',
  filCod: 1,
  banco: '341',
  conta: '12345',
  status: 'RASCUNHO',
  criadoPor: 'analista',
  versao: 1,
  criadoEm: '2026-09-23T13:00:00.000Z',
  automatico: true,
  itens: [],
} as unknown as LotePagamento

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    fetchSispagPainel: jest.fn(),
    fetchLotes: jest.fn(),
    fetchRetornos: jest.fn(),
    conciliarRetorno: jest.fn(),
    fetchContasPagadoras: jest.fn().mockResolvedValue([]),
    fetchModalidadesDisponiveis: jest.fn().mockResolvedValue([]),
    fetchBoletosDda: jest.fn(),
    // ADR-0060: o refresh ao abrir não pode bater na rede real nos demais testes da página.
    atualizarCarteiraSeDefasada: jest.fn().mockResolvedValue({ estado: 'fresca' }),
    // ADR-0066: idem para a sincronização dos lotes ao abrir e o botão "Sincronizar lotes".
    sincronizarLotesSeDefasado: jest.fn().mockResolvedValue({ estado: 'fresca' }),
    sincronizarLotes: jest.fn(),
    // ADR-0068: as sugestões de boleto são evidência opcional; por padrão, nenhuma.
    fetchTodasSugestoesBoleto: jest.fn().mockResolvedValue({
      sugestoes: [],
      total: 0,
      pagina: 1,
      tamanho: 100,
      contagem: {},
    }),
    fetchConfirmacoesEmissor: jest.fn().mockResolvedValue([]),
    // ADR-0069 emenda 1: títulos retidos por código de barras — por padrão, nenhum.
    fetchRetidosPorCodigoBarras: jest.fn().mockResolvedValue([]),
    fetchRetiradasDoLote: jest.fn().mockResolvedValue([]),
  }
})

/** ADR-0076: o topo da aba de lotes em rascunho — filtro por prontidão e finalizar os prontos. */
describe('SispagPage — prontidão dos lotes em rascunho (ADR-0076)', () => {
  const pronto = {
    ...loteRascunho,
    id: 'lote-pronto',
    prontidao: {
      estado: 'PRONTO',
      itensQueVao: 0,
      barram: 0,
      saem: 0,
      pendencias: [],
      fontesIndisponiveis: [],
    },
  } as unknown as LotePagamento
  const comPendencia = {
    ...loteRascunho,
    id: 'lote-pendente',
    filCod: 7,
    conta: undefined,
    prontidao: {
      estado: 'COM_PENDENCIA',
      itensQueVao: 0,
      barram: 0,
      saem: 0,
      pendencias: [
        { efeito: 'BARRA', codigo: 'SEM_CONTA', rotulo: 'Sem conta pagadora', dono: 'VOCE' },
      ],
      fontesIndisponiveis: [],
    },
  } as unknown as LotePagamento

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue(painel)
    lib.fetchLotes.mockReset()
    // a lista chega com o pronto PRIMEIRO; "pendências primeiro" o põe por último
    lib.fetchLotes.mockResolvedValue([pronto, comPendencia])
  })

  const abrirCandidatos = async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<SispagPage />)
    })
    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (2)' }))
    return user
  }

  it('pendências primeiro, filtro por prontidão e a faixa de finalizar os prontos', async () => {
    const user = await abrirCandidatos()
    const grupo = screen.getByRole('group', { name: 'Situação do lote' })
    expect(within(grupo).getByRole('button', { name: /Prontos para finalizar 1/ })).toBeInTheDocument()
    expect(within(grupo).getByRole('button', { name: /Com pendência 1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finalizar o lote pronto' })).toBeInTheDocument()

    const selos = screen.getAllByText(/^(Não finaliza|Pronto para finalizar)$/).map((e) => e.textContent)
    expect(selos).toEqual(['Não finaliza', 'Pronto para finalizar'])

    await user.click(within(grupo).getByRole('button', { name: /Prontos para finalizar 1/ }))
    expect(screen.queryByText('Não finaliza')).not.toBeInTheDocument()
    expect(screen.getByText('Pronto para finalizar')).toBeInTheDocument()
  })

  it('sem sispag:executar: sem finalizar em massa, o filtro continua', async () => {
    permissoes = ['sispag:ver']
    await abrirCandidatos()
    expect(screen.queryByRole('button', { name: /Finalizar o lote pronto/ })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Situação do lote' })).toBeInTheDocument()
  })
})

/**
 * Incidente 2026-09-23: `GET /sispag/lotes` quebrou (coluna da migração 0061 ainda ausente em
 * produção) e a tela mostrou "Lotes candidatos (0)" / "Nenhum lote candidato" — o erro era
 * engolido por um `.catch(() => [])`. Falha do endpoint tem de parecer falha, não lista vazia.
 */
describe('SispagPage — falha ao carregar os lotes', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue(painel)
    // `mockReset` e não `clearAllMocks`: um `mockResolvedValueOnce` não consumido vazaria.
    lib.fetchLotes.mockReset()
  })

  const renderPainel = async () => {
    await act(async () => {
      render(<SispagPage />)
    })
  }

  it('mostra erro nas abas de lotes em vez de "Nenhum lote candidato"', async () => {
    ;(fetchLotes as jest.Mock).mockRejectedValue(new Error('column "data_debito" does not exist'))
    const user = userEvent.setup()
    await renderPainel()

    // O painel (títulos) continua de pé: a falha é só dos lotes.
    expect(screen.getByRole('tab', { name: 'Títulos a pagar' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lotes candidatos (—)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Finalizados (—)' })).toBeInTheDocument()
    expect(screen.getByText('não foi possível carregar')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (—)' }))
    const alerta = screen.getByRole('alert')
    expect(within(alerta).getByText('Não foi possível carregar os lotes')).toBeInTheDocument()
    expect(within(alerta).getByText(/data_debito/)).toBeInTheDocument()
    expect(screen.queryByText('Nenhum lote candidato')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Finalizados (—)' }))
    expect(within(screen.getByRole('alert')).getByText(/data_debito/)).toBeInTheDocument()
    expect(screen.queryByText('Nenhum lote finalizado')).not.toBeInTheDocument()
  })

  it('"Tentar de novo" recarrega e, se o endpoint voltou, mostra os lotes', async () => {
    ;(fetchLotes as jest.Mock)
      .mockRejectedValueOnce(new Error('falhou'))
      .mockResolvedValueOnce([loteRascunho])
    const user = userEvent.setup()
    await renderPainel()

    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (—)' }))
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lotes candidatos (1)' })).toBeInTheDocument()
  })

  it('o link para Favorecidos autorizados aparece para quem vê o SISPAG (ADR-0065)', async () => {
    permissoes = ['sispag:ver']
    ;(fetchLotes as jest.Mock).mockResolvedValue([])
    await renderPainel()
    expect(screen.getByRole('link', { name: 'Favorecidos autorizados' })).toHaveAttribute(
      'href',
      '/sispag/favorecidos-autorizados',
    )
  })

  it('lista vazia de verdade continua sendo "Nenhum lote candidato"', async () => {
    ;(fetchLotes as jest.Mock).mockResolvedValue([])
    const user = userEvent.setup()
    await renderPainel()

    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (0)' }))
    expect(screen.getByText('Nenhum lote candidato')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

/**
 * ADR-0069 emenda 1 (I16g): título retirado do lote por boleto repetido aparece na aba de títulos
 * com o selo "retido por boleto repetido", a máscara do código e a ação de desfazer com motivo.
 */
describe('SispagPage — títulos retidos por código de barras', () => {
  const titulo: TituloAPagar = {
    docCod: '1001',
    titCod: '1',
    filCod: 2,
    credor: 'PEDRONI',
    valor: 1412,
    vencimento: Date.UTC(2026, 9, 14, 15),
    diasAteVencimento: 3,
    liberado: true,
    pago: false,
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue({ ...painel, titulos: [titulo] })
    lib.fetchLotes.mockReset()
    lib.fetchLotes.mockResolvedValue([])
    lib.fetchRetidosPorCodigoBarras.mockReset()
    lib.fetchRetidosPorCodigoBarras.mockResolvedValue([
      {
        filCod: 2,
        docCod: '1001',
        titCod: '1',
        origem: 'CODIGO_BARRAS_REPETIDO',
        codigoMascarado: '34191…0000',
        tituloMantido: { filCod: 2, docCod: '1000', titCod: '1' },
        marcadoEm: '2026-10-14T10:00:00.000Z',
      },
    ])
  })

  it('marca o título com o selo, a máscara e o título que ficou', async () => {
    await act(async () => {
      render(<SispagPage />)
    })
    expect(await screen.findByText(/retido por boleto repetido/)).toBeInTheDocument()
    expect(screen.getByText(/código 34191…0000/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /desfazer retenção/i })).toBeInTheDocument()
  })

  it('sem sispag:executar não oferece desfazer', async () => {
    permissoes = ['sispag:ver']
    await act(async () => {
      render(<SispagPage />)
    })
    expect(await screen.findByText(/retido por boleto repetido/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /desfazer retenção/i })).toBeNull()
  })
})

/**
 * "Processar e conciliar" manda o Conexos parsear o .RET e GRAVAR AS BAIXAS no fin010. Disparava
 * no primeiro clique; agora pede confirmação nomeando o arquivo, o banco e a filial.
 */
describe('SispagPage — Processar e conciliar pede confirmação', () => {
  const retorno: ArquivoRetorno = {
    filCod: 7,
    bncCod: 341,
    gtbCodSeq: 2,
    garCodSeq: 55,
    arquivo: 'PG280901.RET',
    banco: 'Itaú',
    configNome: 'SISPAG',
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue(painel)
    lib.fetchLotes.mockReset()
    lib.fetchLotes.mockResolvedValue([])
    ;(fetchRetornos as jest.Mock).mockReset()
    ;(fetchRetornos as jest.Mock).mockResolvedValue([retorno])
    ;(conciliarRetorno as jest.Mock).mockReset()
    ;(conciliarRetorno as jest.Mock).mockResolvedValue({
      dryRun: false,
      totalLinhas: 1,
      pagos: 1,
      rejeitados: 0,
      naoReconhecidos: 0,
    })
  })

  const abrirRetornos = async () => {
    const user = userEvent.setup()
    await act(async () => {
      render(<SispagPage />)
    })
    await user.click(screen.getByRole('tab', { name: 'Retorno Lote (RET) - Conexos' }))
    await user.click(screen.getByRole('button', { name: 'Carregar retornos' }))
    await user.click(await screen.findByRole('button', { name: 'Processar e conciliar' }))
    return user
  }

  it('o clique abre a confirmação com o arquivo e NÃO chama o ERP', async () => {
    await abrirRetornos()

    const dialog = screen.getByRole('dialog', { name: 'Processar o retorno PG280901.RET' })
    expect(within(dialog).getByText('Itaú · SISPAG · filial 7')).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('gravar as baixas')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('fin010')
    expect(conciliarRetorno).not.toHaveBeenCalled()
  })

  it('"Voltar" fecha sem processar', async () => {
    const user = await abrirRetornos()

    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(conciliarRetorno).not.toHaveBeenCalled()
  })

  it('confirmar processa exatamente o arquivo escolhido, com processar=true', async () => {
    const user = await abrirRetornos()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Processar e conciliar' }))

    expect(conciliarRetorno).toHaveBeenCalledTimes(1)
    expect(conciliarRetorno).toHaveBeenCalledWith({
      filCod: 7,
      bncCod: 341,
      gtbCodSeq: 2,
      garCodSeq: 55,
      processar: true,
    })
  })

  it('"Conciliar" (só leitura) segue sem confirmação', async () => {
    const user = await abrirRetornos()
    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    await user.click(screen.getByRole('button', { name: 'Conciliar' }))

    expect(conciliarRetorno).toHaveBeenCalledWith(expect.objectContaining({ processar: false }))
  })
})

/**
 * ADR-0053 (Task 16): com só `sispag:ver`, nenhum botão de ação do SISPAG aparece — escondido,
 * nunca desabilitado — e a tela não chama as leituras reservadas a `sispag:executar` (JC-3:
 * contas pagadoras; boletos DDA e linhas digitáveis, ver `_inbox/auth-permissoes-modulo-gap.md`).
 */
describe('SispagPage — só sispag:ver', () => {
  const tituloEmLote = {
    docCod: '801',
    titCod: '1',
    filCod: 1,
    credor: 'FORNECEDOR X',
    valor: 100,
    diasAteVencimento: 5,
    liberado: true,
    pago: false,
    emLote: true,
    loteRascunho: { id: 'lote-1', automatico: true },
  } as unknown as TituloAPagar
  const tituloLivre = {
    ...tituloEmLote,
    docCod: '802',
    emLote: false,
    loteRascunho: undefined,
  } as unknown as TituloAPagar
  const retorno: ArquivoRetorno = {
    filCod: 7,
    bncCod: 341,
    gtbCodSeq: 2,
    garCodSeq: 55,
    arquivo: 'PG280901.RET',
    banco: 'Itaú',
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    permissoes = ['sispag:ver']
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue({ ...painel, titulos: [tituloEmLote, tituloLivre] })
    lib.fetchLotes.mockReset()
    lib.fetchLotes.mockResolvedValue([loteRascunho])
    ;(fetchRetornos as jest.Mock).mockReset()
    ;(fetchRetornos as jest.Mock).mockResolvedValue([retorno])
    ;(fetchContasPagadoras as jest.Mock).mockClear()
    ;(fetchBoletosDda as jest.Mock).mockClear()
  })

  const renderPainel = async () => {
    await act(async () => {
      render(<SispagPage />)
    })
  }

  it.each([
    ['Ingestão de dados', /ingestão de dados/i],
    ['Formar lotes automáticos', /formar lotes/i],
    ['Novo lote (Criar lote)', /criar lote/i],
    ['Retirar do lote', /retirar do lote/i],
  ])('aba de títulos: "%s" não aparece', async (_nome, rotulo) => {
    await renderPainel()
    expect(screen.queryByRole('button', { name: rotulo })).not.toBeInTheDocument()
  })

  it('aba de títulos: sem seleção para incluir em lote (nenhum checkbox)', async () => {
    await renderPainel()
    expect(screen.getAllByText('FORNECEDOR X', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('checkbox', { name: /selecionar título/i })).not.toBeInTheDocument()
  })

  it('a leitura continua: o link do lote na linha do título e as abas de consulta', async () => {
    await renderPainel()
    expect(screen.getByRole('tab', { name: 'Títulos a pagar' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Lotes candidatos (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Retorno Lote (RET) - Conexos' })).toBeInTheDocument()
  })

  it('aba Boletos DDA aparece para quem só vê, mas sem "Atualizar DDA" (ADR-0053)', async () => {
    ;(fetchBoletosDda as jest.Mock).mockResolvedValue({ boletos: [], total: 0, regraCandidato: '' })
    const user = userEvent.setup()
    await renderPainel()
    await user.click(screen.getByRole('tab', { name: /boletos dda/i }))
    await waitFor(() => expect(fetchBoletosDda).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /atualizar dda/i })).not.toBeInTheDocument()
  })

  it('lotes candidatos: sem ações no card e sem ler as contas pagadoras (JC-3)', async () => {
    const user = userEvent.setup()
    await renderPainel()
    await user.click(screen.getByRole('tab', { name: 'Lotes candidatos (1)' }))
    expect(screen.queryByRole('button', { name: /^finalizar$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /adicionar título/i })).not.toBeInTheDocument()
    expect(fetchContasPagadoras).not.toHaveBeenCalled()
  })

  it.each([
    ['Processar e conciliar', /processar e conciliar/i],
    ['Conciliar retorno', /^conciliar$/i],
  ])('retornos: "%s" não aparece (a lista continua)', async (_nome, rotulo) => {
    const user = userEvent.setup()
    await renderPainel()
    await user.click(screen.getByRole('tab', { name: 'Retorno Lote (RET) - Conexos' }))
    await user.click(screen.getByRole('button', { name: 'Carregar retornos' }))
    expect(await screen.findByText('PG280901.RET')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: rotulo })).not.toBeInTheDocument()
  })

  it('com sispag:executar, tudo como hoje', async () => {
    permissoes = ['sispag:ver', 'sispag:executar']
    await renderPainel()
    expect(screen.getByRole('button', { name: /ingestão de dados/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /formar lotes/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /criar lote/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retirar do lote/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /boletos dda/i })).toBeInTheDocument()
  })
})


/**
 * ADR-0060 — carteira ao abrir a tela. A tela mostra o que está gravado e pede o refresh; quando a
 * ingestão termina, recarrega o painel sozinha. Quem só tem `sispag:ver` também dispara.
 */
describe('SispagPage — atualiza a carteira ao abrir', () => {
  const mockRefresh = atualizarCarteiraSeDefasada as jest.Mock

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockReset()
    lib.fetchSispagPainel.mockResolvedValue(painel)
    lib.fetchLotes.mockReset()
    lib.fetchLotes.mockResolvedValue([])
    mockRefresh.mockReset()
  })

  const renderPainel = async () => {
    await act(async () => {
      render(<SispagPage />)
    })
  }

  it('carteira fresca: pede o refresh UMA vez e não recarrega o painel', async () => {
    mockRefresh.mockResolvedValue({ estado: 'fresca', idadeMin: 4 })
    await renderPainel()
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
    expect(fetchSispagPainel as jest.Mock).toHaveBeenCalledTimes(1)
  })

  it('atualizada: mostra "atualizando" enquanto roda e recarrega o painel ao terminar', async () => {
    let terminar: (v: unknown) => void = () => {}
    mockRefresh.mockReturnValue(new Promise((resolve) => (terminar = resolve)))
    await renderPainel()

    // Os dados gravados já estão na tela, com o aviso de que a atualização está em curso.
    expect(await screen.findByText(/atualizando a carteira/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Títulos a pagar' })).toBeInTheDocument()
    expect(fetchSispagPainel as jest.Mock).toHaveBeenCalledTimes(1)

    await act(async () => {
      terminar({ estado: 'atualizada', idadeMin: 0 })
    })
    await waitFor(() => expect(fetchSispagPainel as jest.Mock).toHaveBeenCalledTimes(2))
    await waitFor(() =>
      expect(screen.queryByText(/atualizando a carteira/)).not.toBeInTheDocument(),
    )
  })

  it('falha_recente: mantém os dados e avisa, sem recarregar', async () => {
    mockRefresh.mockResolvedValue({
      estado: 'falha_recente',
      motivo: 'nenhuma das 7 filiais foi lida',
    })
    await renderPainel()
    expect(await screen.findByText(/não foi possível atualizar agora/)).toBeInTheDocument()
    expect(screen.getByText(/nenhuma das 7 filiais foi lida/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Títulos a pagar' })).toBeInTheDocument()
    expect(fetchSispagPainel as jest.Mock).toHaveBeenCalledTimes(1)
  })

  it('erro da chamada: avisa e mantém a carteira gravada', async () => {
    mockRefresh.mockRejectedValue(new Error('API 500'))
    await renderPainel()
    expect(await screen.findByText(/não foi possível atualizar agora/)).toBeInTheDocument()
    expect(screen.getByText(/API 500/)).toBeInTheDocument()
  })

  it('quem só tem sispag:ver dispara o refresh (ADR-0060)', async () => {
    permissoes = ['sispag:ver' as Permissao]
    mockRefresh.mockResolvedValue({ estado: 'fresca' })
    await renderPainel()
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
  })

  it('não dispara se o painel não carregou', async () => {
    ;(jest.requireMock('@/lib/sispag').fetchSispagPainel as jest.Mock).mockRejectedValue(
      new Error('fora do ar'),
    )
    await renderPainel()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

/**
 * ADR-0066 — lotes ao abrir a tela e "Sincronizar lotes". A sincronização roda DEPOIS da
 * carteira (cap de sessões do robô) e o botão único substitui o "Sincronizar agora" por lote.
 */
describe('SispagPage — sincroniza os lotes', () => {
  const lib = () => jest.requireMock('@/lib/sispag')

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    permissoes = ['sispag:ver' as Permissao]
    lib().fetchSispagPainel.mockReset()
    lib().fetchSispagPainel.mockResolvedValue(painel)
    lib().fetchLotes.mockReset()
    lib().fetchLotes.mockResolvedValue([])
    lib().atualizarCarteiraSeDefasada.mockReset()
    lib().sincronizarLotesSeDefasado.mockReset()
    lib().sincronizarLotes.mockReset()
  })

  const renderPainel = async () => {
    await act(async () => {
      render(<SispagPage />)
    })
  }

  it('ao abrir: só sincroniza os lotes depois que a carteira termina, e recarrega os lotes', async () => {
    let terminarCarteira: (v: unknown) => void = () => {}
    lib().atualizarCarteiraSeDefasada.mockReturnValue(
      new Promise((resolve) => (terminarCarteira = resolve)),
    )
    lib().sincronizarLotesSeDefasado.mockResolvedValue({ estado: 'atualizada', idadeMin: 0 })
    await renderPainel()
    await waitFor(() => expect(lib().atualizarCarteiraSeDefasada).toHaveBeenCalledTimes(1))
    expect(lib().sincronizarLotesSeDefasado).not.toHaveBeenCalled()

    await act(async () => {
      terminarCarteira({ estado: 'fresca' })
    })
    await waitFor(() => expect(lib().sincronizarLotesSeDefasado).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(lib().fetchLotes).toHaveBeenCalledTimes(2))
  })

  it('falha_recente dos lotes: avisa e mantém o último status gravado', async () => {
    lib().atualizarCarteiraSeDefasada.mockResolvedValue({ estado: 'fresca' })
    lib().sincronizarLotesSeDefasado.mockResolvedValue({
      estado: 'falha_recente',
      motivo: 'Bad Credentials',
    })
    await renderPainel()
    expect(await screen.findByText(/não foi possível sincronizar os lotes agora/)).toBeInTheDocument()
    expect(screen.getByText(/Bad Credentials/)).toBeInTheDocument()
  })

  it('quem só tem sispag:ver vê "Sincronizar lotes"; o clique força a passada e recarrega', async () => {
    const user = userEvent.setup()
    lib().atualizarCarteiraSeDefasada.mockResolvedValue({ estado: 'fresca' })
    lib().sincronizarLotesSeDefasado.mockResolvedValue({ estado: 'fresca' })
    lib().sincronizarLotes.mockResolvedValue({
      estado: 'atualizada',
      passada: { runId: 'r', status: 'success', resumo: { lotes: 5, transicionados: 2 } },
    })
    await renderPainel()
    await waitFor(() => expect(lib().sincronizarLotesSeDefasado).toHaveBeenCalled())
    const lotesAntes = lib().fetchLotes.mock.calls.length

    await user.click(screen.getByRole('button', { name: /sincronizar lotes/i }))
    await waitFor(() => expect(lib().sincronizarLotes).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(lib().fetchLotes.mock.calls.length).toBe(lotesAntes + 1))
  })

  it('outra passada rodando: não recarrega nem acusa erro', async () => {
    const user = userEvent.setup()
    lib().atualizarCarteiraSeDefasada.mockResolvedValue({ estado: 'fresca' })
    lib().sincronizarLotesSeDefasado.mockResolvedValue({ estado: 'fresca' })
    lib().sincronizarLotes.mockResolvedValue({ estado: 'em_andamento' })
    await renderPainel()
    await waitFor(() => expect(lib().sincronizarLotesSeDefasado).toHaveBeenCalled())
    const lotesAntes = lib().fetchLotes.mock.calls.length
    await user.click(screen.getByRole('button', { name: /sincronizar lotes/i }))
    await waitFor(() => expect(lib().sincronizarLotes).toHaveBeenCalledTimes(1))
    expect(lib().fetchLotes.mock.calls.length).toBe(lotesAntes)
  })
})

/**
 * Aba Títulos a pagar: título em lote finalizado / com remessa gerada fica fora da tabela por
 * padrão (a um clique), o motivo do "selecionar todos" bloqueado aparece em texto e o export
 * está disponível para quem só vê.
 */
describe('SispagPage — títulos: comprometidos, selecionar todos e export', () => {
  const base = {
    titCod: '1',
    filCod: 1,
    valor: 100,
    diasAteVencimento: 5,
    liberado: true,
    pago: false,
  }
  const livre = { ...base, docCod: '801', credor: 'LIVRE LTDA' } as TituloAPagar
  const outraFilial = { ...base, docCod: '802', filCod: 2, credor: 'OUTRA FILIAL SA' } as TituloAPagar
  const comRemessa = {
    ...base,
    docCod: '803',
    credor: 'JA NA REMESSA SA',
    loteComprometido: { id: 'L9', status: 'REMESSA_GERADA' },
  } as TituloAPagar

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockReset()
    lib.fetchSispagPainel.mockResolvedValue({
      ...painel,
      titulos: [livre, outraFilial, comRemessa],
    })
    lib.fetchLotes.mockReset()
    lib.fetchLotes.mockResolvedValue([])
    ;(fetchRetornos as jest.Mock).mockResolvedValue([])
  })

  const renderPainel = async () => {
    await act(async () => {
      render(<SispagPage />)
    })
  }

  it('esconde o título com remessa gerada por padrão e o botão o traz de volta', async () => {
    await renderPainel()
    expect(screen.getByText('LIVRE LTDA')).toBeInTheDocument()
    expect(screen.queryByText('JA NA REMESSA SA')).not.toBeInTheDocument()
    // A contagem da faixa não conta o oculto.
    expect(screen.getByRole('button', { name: 'A vencer (2)' })).toBeInTheDocument()

    const filtro = screen.getByRole('button', { name: /em lote finalizado\/remessa \(1\)/i })
    expect(filtro).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(filtro)

    expect(screen.getByText('JA NA REMESSA SA')).toBeInTheDocument()
    expect(filtro).toHaveAttribute('aria-pressed', 'true')
  })

  it('com várias filiais, o motivo do bloqueio do "selecionar todos" aparece em texto', async () => {
    await renderPainel()
    expect(screen.getByText('Filtre por uma filial para selecionar todos')).toBeInTheDocument()
  })

  it('o export conta as linhas do filtro e aparece para quem só vê', async () => {
    permissoes = ['sispag:ver']
    await renderPainel()
    expect(screen.getByRole('button', { name: /exportar \(2\)/i })).toBeEnabled()
  })
})

describe('SispagPage — sugestão de boleto na aba de títulos (ADR-0068)', () => {
  const titulo = {
    docCod: '5046',
    titCod: '1',
    filCod: 1,
    credor: 'ADP BRASIL LTDA',
    valor: 4815.33,
    vencimento: Date.UTC(2026, 8, 24),
    diasAteVencimento: 5,
    liberado: true,
    pago: false,
    emLote: false,
    formaPagamentoConexos: 6,
    temBoleto: false,
  } as unknown as TituloAPagar

  const sugestao = {
    filCod: 1,
    docCod: '5046',
    titCod: '1',
    valorTitulo: 4815.33,
    vencimentoTitulo: '2026-09-24',
    dataDebito: '2026-09-24',
    ddcCod: 152,
    ditCod: 7,
    numeroBoleto: '001532761',
    valorBoleto: 4815.33,
    vencimentoBoleto: '2026-09-27',
    avaliacao: {
      resultado: 'FORTE',
      deltaValor: 0,
      deltaPercentual: 0,
      deltaDias: 3,
      sinais: ['VALOR_IGUAL'],
      confirmavel: true,
    },
    estado: 'SUGERIDA',
    confirmavel: true,
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue({ ...painel, titulos: [titulo] })
    lib.fetchLotes.mockReset()
    lib.fetchLotes.mockResolvedValue([])
    lib.fetchBoletosDdaDoTitulo = jest.fn().mockResolvedValue({ doTitulo: [], mesmoValor: [] })
    lib.fetchTodasSugestoesBoleto.mockResolvedValue({
      sugestoes: [sugestao],
      total: 1,
      pagina: 1,
      tamanho: 100,
      contagem: {},
    })
  })

  const abrir = async () => {
    await act(async () => {
      render(<SispagPage />)
    })
    await userEvent.click(await screen.findByRole('button', { name: 'sugestão disponível' }))
    return screen.findByRole('dialog')
  }

  it('sispag:ver abre a sugestão e vê "Copiar", mas não Confirmar nem Rejeitar', async () => {
    permissoes = ['sispag:ver']
    const dlg = await abrir()
    expect(within(dlg).getByText('Sugestão de boleto')).toBeInTheDocument()
    expect(within(dlg).getByText('+3 dias')).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: /Copiar linha digitável/ })).toBeInTheDocument()
    expect(within(dlg).queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
    expect(within(dlg).queryByRole('button', { name: /^Rejeitar boleto/ })).not.toBeInTheDocument()
  })

  it('sispag:executar vê Confirmar e Rejeitar', async () => {
    permissoes = ['sispag:ver', 'sispag:executar']
    const dlg = await abrir()
    expect(within(dlg).getByRole('button', { name: /^Confirmar boleto/ })).toBeEnabled()
    expect(within(dlg).getByRole('button', { name: /^Rejeitar boleto/ })).toBeInTheDocument()
  })

  it('lista truncada (total > recebidas): aviso visível, nunca silencioso', async () => {
    permissoes = ['sispag:ver']
    jest.requireMock('@/lib/sispag').fetchTodasSugestoesBoleto.mockResolvedValue({
      sugestoes: [sugestao],
      total: 2500,
      pagina: 1,
      tamanho: 2000,
      contagem: {},
    })
    await act(async () => {
      render(<SispagPage />)
    })
    expect(await screen.findByText(/mostrando as 1 primeiras de/i)).toBeInTheDocument()
    expect(screen.getByText(/mostrando as 1 primeiras de/i)).toHaveTextContent('2500')
  })

  it('lista completa: nenhum aviso de truncamento', async () => {
    permissoes = ['sispag:ver']
    await act(async () => {
      render(<SispagPage />)
    })
    await screen.findByRole('button', { name: 'sugestão disponível' })
    expect(screen.queryByText(/mostrando as .* primeiras de/i)).not.toBeInTheDocument()
  })

  it('filtro por situação do boleto: botões com a contagem do servidor; selecionar filtra a lista', async () => {
    permissoes = ['sispag:ver']
    const outro = { ...titulo, docCod: '7777', credor: 'OUTRO CREDOR SA' } as unknown as TituloAPagar
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue({ ...painel, titulos: [titulo, outro] })
    const desfecho = (docCod: string, situacao: string) => ({
      filCod: 1,
      docCod,
      titCod: '1',
      valorTitulo: 4815.33,
      vencimentoTitulo: '2026-09-24',
      dataDebito: '2026-09-24',
      situacao,
      candidatos: [],
      totalCandidatos: 0,
      motivo: 'm',
      avisoVenceAntes: 'NENHUM',
      diasVencidoNoDebito: 0,
    })
    lib.fetchTodasSugestoesBoleto.mockResolvedValue({
      sugestoes: [],
      titulos: [desfecho('5046', 'SO_FRACA'), desfecho('7777', 'SEM_CANDIDATO')],
      totalTitulos: 2,
      contagemSituacao: { SO_FRACA: 1, SEM_CANDIDATO: 1 },
      total: 0,
      pagina: 1,
      tamanho: 2000,
      contagem: {},
    })
    await act(async () => {
      render(<SispagPage />)
    })
    const grupo = await screen.findByRole('group', { name: 'Situação do boleto do título' })
    const fraca = within(grupo).getByRole('button', {
      name: 'ver candidato (sem confirmação) (1)',
    })
    expect(within(grupo).getByRole('button', { name: 'sem boleto no pool (1)' })).toBeInTheDocument()
    expect(screen.getAllByText('OUTRO CREDOR SA', { exact: false }).length).toBeGreaterThan(0)
    await userEvent.click(fraca)
    expect(fraca).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('OUTRO CREDOR SA', { exact: false })).not.toBeInTheDocument()
    expect(screen.getAllByText('ADP BRASIL LTDA', { exact: false }).length).toBeGreaterThan(0)
  })

  it('truncamento por título: mostra o aviso com totalTitulos', async () => {
    permissoes = ['sispag:ver']
    jest.requireMock('@/lib/sispag').fetchTodasSugestoesBoleto.mockResolvedValue({
      sugestoes: [],
      titulos: [],
      totalTitulos: 2500,
      contagemSituacao: {},
      total: 0,
      pagina: 1,
      tamanho: 2000,
      contagem: {},
    })
    await act(async () => {
      render(<SispagPage />)
    })
    expect(await screen.findByText(/mostrando as 0 primeiras de/i)).toHaveTextContent('2500')
  })

  it('falha ao ler as sugestões não derruba a aba de títulos', async () => {
    permissoes = ['sispag:ver']
    jest.requireMock('@/lib/sispag').fetchTodasSugestoesBoleto.mockRejectedValue(new Error('x'))
    await act(async () => {
      render(<SispagPage />)
    })
    expect(screen.getAllByText('ADP BRASIL LTDA', { exact: false }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'sugestão disponível' })).not.toBeInTheDocument()
  })

  it('coluna "Nº doc" ao lado de Documento, com o nº do documento do título', async () => {
    permissoes = ['sispag:ver']
    jest
      .requireMock('@/lib/sispag')
      .fetchSispagPainel.mockResolvedValue({ ...painel, titulos: [{ ...titulo, numeroDocumento: '25349' }] })
    await act(async () => {
      render(<SispagPage />)
    })
    const doc = await screen.findByRole('columnheader', { name: 'Documento' })
    const cabecalhos = screen.getAllByRole('columnheader').map((c) => c.textContent)
    expect(cabecalhos[cabecalhos.indexOf(doc.textContent) + 1]).toBe('Nº doc')
    expect(screen.getByRole('cell', { name: '25349' })).toBeInTheDocument()
  })

  it('gaveta não modal: com ela aberta, outro título da tabela troca o conteúdo e a linha ativa', async () => {
    permissoes = ['sispag:ver']
    const outro = {
      ...titulo,
      docCod: '7777',
      credor: 'OUTRO CREDOR SA',
      numeroDocumento: '25349',
    } as unknown as TituloAPagar
    const lib = jest.requireMock('@/lib/sispag')
    lib.fetchSispagPainel.mockResolvedValue({ ...painel, titulos: [titulo, outro] })
    lib.fetchTodasSugestoesBoleto.mockResolvedValue({
      sugestoes: [sugestao, { ...sugestao, docCod: '7777' }],
      total: 2,
      pagina: 1,
      tamanho: 100,
      contagem: {},
    })
    await act(async () => {
      render(<SispagPage />)
    })
    const [primeiro, segundo] = await screen.findAllByRole('button', { name: 'sugestão disponível' })
    await userEvent.click(primeiro)
    expect(await screen.findByRole('dialog', { name: /5046\/1/ })).toHaveTextContent('nº documento —')
    const linhaDe = (credor: string) => screen.getByText(credor, { selector: 'span' }).closest('tr')
    expect(linhaDe('ADP BRASIL LTDA')).toHaveAttribute('aria-current', 'true')

    // A tabela segue acessível (não aria-hidden) e clicável com a gaveta aberta.
    await userEvent.click(segundo)
    const dlg = await screen.findByRole('dialog', { name: /7777\/1/ })
    expect(dlg).toHaveTextContent('nº documento 25349')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(linhaDe('OUTRO CREDOR SA')).toHaveAttribute('aria-current', 'true')
    expect(linhaDe('ADP BRASIL LTDA')).not.toHaveAttribute('aria-current')

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(linhaDe('OUTRO CREDOR SA')).not.toHaveAttribute('aria-current')
  })

    it('emissores confirmados: botão abre a lista (sispag:ver)', async () => {
    permissoes = ['sispag:ver']
    await act(async () => {
      render(<SispagPage />)
    })
    await userEvent.click(
      await screen.findByRole('button', { name: /emissores de boleto confirmados/ }),
    )
    expect(await screen.findByText('Nenhum emissor confirmado')).toBeInTheDocument()
  })
})

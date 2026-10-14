/**
 * Painel da sugestão de boleto (ADR-0068): evidência com deltas com sinal, tiers, gating por
 * permissão (esconder, R11), cópia auditada e cada código de erro do envelope.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SugestaoBoleto } from '@/lib/sispag'
import {
  anularConfirmacaoBoleto,
  AutorizacaoApiError,
  confirmarSugestaoBoleto,
  copiarLinhaSugestao,
  rejeitarSugestaoBoleto,
  revogarConfirmacaoEmissor,
} from '@/lib/sispag'
import { SugestaoBoletoPainel } from './SugestaoBoletoPainel'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    confirmarSugestaoBoleto: jest.fn(),
    rejeitarSugestaoBoleto: jest.fn(),
    copiarLinhaSugestao: jest.fn(),
    revogarConfirmacaoEmissor: jest.fn(),
    anularConfirmacaoBoleto: jest.fn(),
  }
})

const confirmar = confirmarSugestaoBoleto as jest.Mock
const rejeitar = rejeitarSugestaoBoleto as jest.Mock
const copiar = copiarLinhaSugestao as jest.Mock
const revogar = revogarConfirmacaoEmissor as jest.Mock
const anular = anularConfirmacaoBoleto as jest.Mock

// Valor de teste sintético: nunca uma linha digitável real.
const LINHA_FAKE = 'LINHA-DE-TESTE-0000'

const sugestao = (over: Partial<SugestaoBoleto> = {}): SugestaoBoleto => ({
  filCod: 1,
  docCod: '5046',
  titCod: '1',
  credor: 'ADP BRASIL LTDA',
  valorTitulo: 100,
  vencimentoTitulo: '2026-10-20',
  dataDebito: '2026-10-20',
  ddcCod: 152,
  ditCod: 7,
  numeroBoleto: '001532761',
  valorBoleto: 100.01,
  vencimentoBoleto: '2026-10-22',
  emissor: { banco: '237', layout: 'BRADESCO_237', mascarado: '237 / 2656 / ***2740' },
  avaliacao: {
    resultado: 'FORTE',
    deltaValor: 0.01,
    deltaPercentual: 0.01,
    deltaDias: 2,
    sinais: ['VALOR_ATE_5_CENTAVOS', 'DIAS_DEPOIS'],
    confirmavel: true,
  },
  estado: 'SUGERIDA',
  confirmavel: true,
  ...over,
})

const onDecidido = jest.fn()

const renderPainel = (
  lista: SugestaoBoleto[],
  p: { executar?: boolean; copiar?: boolean; defasado?: number } = {},
) =>
  render(
    <SugestaoBoletoPainel
      sugestoes={lista}
      podeExecutar={p.executar ?? true}
      podeCopiar={p.copiar ?? true}
      ddaDefasadoHoras={p.defasado}
      onDecidido={onDecidido}
    />,
  )

const erroApi = (status: number, code: string, message: string) =>
  new AutorizacaoApiError(message, status, code)

beforeEach(() => {
  jest.clearAllMocks()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: jest.fn().mockResolvedValue(undefined) },
  })
})

describe('SugestaoBoletoPainel — evidência', () => {
  it('mostra o boleto, os deltas com sinal, os sinais em português e o emissor mascarado', () => {
    renderPainel([sugestao()])
    expect(screen.getByText('sugestão forte')).toBeInTheDocument()
    expect(screen.getByText('R$ +0,01')).toBeInTheDocument()
    expect(screen.getByText('+0,0 %')).toBeInTheDocument()
    expect(screen.getByText('+2 dias')).toBeInTheDocument()
    expect(screen.getByText(/valor difere em até R\$ 0,05/)).toBeInTheDocument()
    expect(screen.getByText('vence depois do título')).toBeInTheDocument()
    expect(screen.getByText(/emissor 237 \/ 2656 \/ \*\*\*2740/)).toBeInTheDocument()
    expect(screen.getByText(/não grava nada no Conexos/)).toBeInTheDocument()
  })

  it('ATENCAO destaca a diferença e não usa o texto de sugestão forte', () => {
    renderPainel([
      sugestao({
        avaliacao: {
          ...sugestao().avaliacao,
          resultado: 'ATENCAO',
          deltaValor: 3.2,
          deltaPercentual: 1.6,
        },
      }),
    ])
    expect(screen.getByText('atenção')).toBeInTheDocument()
    expect(screen.queryByText('sugestão forte')).not.toBeInTheDocument()
    expect(screen.getByText('R$ +3,20').className).toMatch(/text-warning/)
    expect(screen.getByRole('button', { name: /^Confirmar boleto/ })).toBeEnabled()
  })

  it('VENCIDO_INFORMATIVO é só informativo: Confirmar desabilitado com o motivo, sem Rejeitar', () => {
    renderPainel([
      sugestao({
        confirmavel: false,
        motivo: 'Boleto vence antes da data de débito.',
        avaliacao: {
          ...sugestao().avaliacao,
          resultado: 'VENCIDO_INFORMATIVO',
          confirmavel: false,
        },
      }),
    ])
    expect(screen.getByText('vencido · só informativo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Confirmar boleto/ })).toBeDisabled()
    expect(screen.getByText(/Boleto vence antes da data de débito/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rejeitar boleto/ })).not.toBeInTheDocument()
  })

  it('mostra o aviso de DDA defasado só quando informado', () => {
    const { rerender } = renderPainel([sugestao()])
    expect(screen.queryByText(/não é atualizado há/)).not.toBeInTheDocument()
    rerender(
      <SugestaoBoletoPainel
        sugestoes={[sugestao()]}
        podeExecutar
        podeCopiar
        ddaDefasadoHoras={30}
        onDecidido={onDecidido}
      />,
    )
    expect(screen.getByText(/não é atualizado há 30 h/)).toBeInTheDocument()
  })

  it('confirmada: informa que ainda não está associada no ERP e oferece revogar o par', () => {
    renderPainel([sugestao({ estado: 'CONFIRMADA', confirmacaoEmissorId: 'par-1' })])
    expect(screen.getByText(/ainda não associado no ERP/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Revogar confirmação do boleto/ })).toBeInTheDocument()
  })
})

describe('SugestaoBoletoPainel — permissões', () => {
  it('sispag:ver sem executar: vê e copia; Confirmar, Rejeitar e Revogar somem', () => {
    renderPainel([sugestao({ confirmacaoEmissorId: 'par-1' })], { executar: false, copiar: true })
    expect(screen.getByRole('button', { name: /Copiar linha digitável/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Rejeitar boleto/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Revogar confirmação do boleto/ })).not.toBeInTheDocument()
  })

  it('sem sispag:ver: nem copiar', () => {
    renderPainel([sugestao()], { executar: false, copiar: false })
    expect(screen.queryByRole('button', { name: /Copiar/ })).not.toBeInTheDocument()
  })

  it('executar vê as quatro ações', () => {
    renderPainel([sugestao({ confirmacaoEmissorId: 'par-1' })])
    for (const nome of [
      /^Confirmar boleto/,
      /^Rejeitar boleto/,
      /Copiar linha digitável/,
      /^Revogar confirmação do boleto/,
    ])
      expect(screen.getByRole('button', { name: nome })).toBeInTheDocument()
  })
})

describe('SugestaoBoletoPainel — confirmar', () => {
  it('confirma com a chave do título/boleto, anuncia o resultado e relê a lista', async () => {
    confirmar.mockResolvedValue({ criada: true, decisao: {} })
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /^Confirmar boleto/ }))
    expect(confirmar).toHaveBeenCalledWith({
      filCod: 1,
      docCod: '5046',
      titCod: '1',
      ddcCod: 152,
      ditCod: 7,
    })
    expect(await screen.findByText(/Nada foi gravado no Conexos/)).toBeInTheDocument()
    expect(onDecidido).toHaveBeenCalled()
  })

  it.each([
    [409, 'SUGESTAO_BOLETO_INDISPONIVEL', 'O boleto deixou de estar livre.', true],
    [409, 'BOLETO_JA_SUGERIDO_A_OUTRO_TITULO', 'Boleto já confirmado a outro título.', true],
    [422, 'BOLETO_VENCIDO_NAO_CONFIRMAVEL', 'Boleto vencido não pode ser confirmado.', false],
    [429, 'MUITAS_DECISOES', 'Muitas decisões em pouco tempo.', false],
  ])('%s %s: mostra a mensagem do envelope', async (status, code, msg, relê) => {
    confirmar.mockRejectedValue(erroApi(status as number, code as string, msg as string))
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /^Confirmar boleto/ }))
    expect(await screen.findByRole('status')).toHaveTextContent(msg as string)
    // Sugestão velha (409) relê a lista; o resto não.
    expect(onDecidido).toHaveBeenCalledTimes(relê ? 1 : 0)
  })
})

describe('SugestaoBoletoPainel — rejeitar', () => {
  it('exige motivo, envia, anuncia e relê', async () => {
    rejeitar.mockResolvedValue({ criada: true, decisao: {} })
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /^Rejeitar boleto/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rejeitar' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('Informe o motivo.')
    expect(rejeitar).not.toHaveBeenCalled()
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'outro credor')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rejeitar' }))
    await waitFor(() =>
      expect(rejeitar).toHaveBeenCalledWith(
        { filCod: 1, docCod: '5046', titCod: '1', ddcCod: 152, ditCod: 7 },
        'outro credor',
      ),
    )
    expect(await screen.findByText('Sugestão rejeitada para este título.')).toBeInTheDocument()
    expect(onDecidido).toHaveBeenCalled()
  })

  it('422 de motivo do servidor aparece no diálogo, que continua aberto', async () => {
    rejeitar.mockRejectedValue(
      erroApi(422, 'CONFIRMACAO_EMISSOR_MOTIVO_OBRIGATORIO', 'Informe o motivo da decisão.'),
    )
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /^Rejeitar boleto/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'x')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Rejeitar' }))
    expect(await within(dlg).findByText('Informe o motivo da decisão.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('SugestaoBoletoPainel — copiar linha', () => {
  it('chama o endpoint auditado e SÓ ENTÃO escreve na área de transferência', async () => {
    copiar.mockResolvedValue(LINHA_FAKE)
    renderPainel([sugestao()], { executar: false })
    await userEvent.click(screen.getByRole('button', { name: /Copiar linha digitável/ }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINHA_FAKE))
    expect(copiar).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Linha digitável copiada/)).toBeInTheDocument()
    // A linha nunca vai para a tela.
    expect(screen.queryByText(LINHA_FAKE)).not.toBeInTheDocument()
  })

  it('503 COPIA_LINHA_SEM_TRILHA: nada é copiado e nada é exposto', async () => {
    copiar.mockRejectedValue(
      erroApi(503, 'COPIA_LINHA_SEM_TRILHA', 'Não foi possível registrar a cópia. Tente de novo.'),
    )
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /Copiar linha digitável/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível registrar a cópia')
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('429: mensagem do envelope, nada copiado', async () => {
    copiar.mockRejectedValue(erroApi(429, 'MUITAS_DECISOES', 'Muitas cópias em pouco tempo.'))
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /Copiar linha digitável/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Muitas cópias em pouco tempo.')
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('área de transferência indisponível: avisa que a cópia ficou registrada', async () => {
    copiar.mockResolvedValue(LINHA_FAKE)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: jest.fn().mockRejectedValue(new Error('negado')) },
    })
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /Copiar linha digitável/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('área de transferência')
  })
})

describe('SugestaoBoletoPainel — revogar', () => {
  it('revoga o par com motivo e relê; 404 aparece como mensagem', async () => {
    revogar.mockRejectedValueOnce(
      erroApi(404, 'CONFIRMACAO_EMISSOR_NAO_ENCONTRADA', 'Confirmação não encontrada.'),
    )
    renderPainel([sugestao({ confirmacaoEmissorId: 'par-1' })])
    await userEvent.click(screen.getByRole('button', { name: /^Revogar confirmação do boleto/ }))
    let dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'conta trocada')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Revogar' }))
    expect(await within(dlg).findByText('Confirmação não encontrada.')).toBeInTheDocument()

    revogar.mockResolvedValueOnce({})
    await userEvent.click(within(dlg).getByRole('button', { name: 'Revogar' }))
    await waitFor(() => expect(revogar).toHaveBeenLastCalledWith('par-1', 'conta trocada'))
    expect(await screen.findByText('Confirmação do emissor revogada.')).toBeInTheDocument()
    expect(onDecidido).toHaveBeenCalled()
    dlg = screen.queryByRole('dialog') as HTMLElement
    expect(dlg).toBeNull()
  })
})

describe('SugestaoBoletoPainel — anular confirmação (I15l)', () => {
  it('só executar vê o botão, e só na confirmada; o nome cita o número do boleto', () => {
    const { unmount } = renderPainel([sugestao({ estado: 'CONFIRMADA' })])
    expect(
      screen.getByRole('button', { name: 'Anular confirmação do boleto 001532761' }),
    ).toBeInTheDocument()
    unmount()
    renderPainel([sugestao({ estado: 'CONFIRMADA' })], { executar: false })
    expect(screen.queryByRole('button', { name: /^Anular confirmação/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Anular confirmação/ })).toBeNull()
  })

  it('sugestão não confirmada não oferece anular', () => {
    renderPainel([sugestao()])
    expect(screen.queryByRole('button', { name: /^Anular confirmação/ })).not.toBeInTheDocument()
  })

  it('exige motivo de 10 caracteres, anula pelo título, anuncia na região única e relê', async () => {
    anular.mockResolvedValue({ anulada: true, decisao: {} })
    renderPainel([sugestao({ estado: 'CONFIRMADA' })])
    await userEvent.click(screen.getByRole('button', { name: /^Anular confirmação do boleto/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'curto')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular confirmação' }))
    expect(within(dlg).getByRole('alert')).toHaveTextContent('pelo menos 10 caracteres')
    expect(anular).not.toHaveBeenCalled()
    await userEvent.clear(within(dlg).getByLabelText('Motivo'))
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'boleto de outro credor')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular confirmação' }))
    await waitFor(() =>
      expect(anular).toHaveBeenCalledWith(
        { filCod: 1, docCod: '5046', titCod: '1' },
        'boleto de outro credor',
      ),
    )
    const regiao = await screen.findByRole('status')
    expect(regiao).toHaveTextContent('Confirmação anulada')
    expect(onDecidido).toHaveBeenCalled()
  })

  it('item vinculado em lote vivo: o diálogo avisa que NÃO desfaz no Conexos e manda retirar o título (I17l)', async () => {
    render(
      <SugestaoBoletoPainel
        sugestoes={[sugestao({ estado: 'CONFIRMADA' })]}
        podeExecutar
        podeCopiar
        itemVinculadoEmLoteVivo
        onDecidido={onDecidido}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /^Anular confirmação do boleto/ }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).toHaveTextContent(/NÃO desfaz isso no Conexos/)
    expect(dlg).toHaveTextContent(/retire o título do lote/)
    // Sem botão "desfazer vínculo": não existe no escopo.
    expect(within(dlg).queryByRole('button', { name: /desfazer/i })).not.toBeInTheDocument()
  })

  it('sem vínculo, o diálogo mantém o texto de sempre', async () => {
    renderPainel([sugestao({ estado: 'CONFIRMADA' })])
    await userEvent.click(screen.getByRole('button', { name: /^Anular confirmação do boleto/ }))
    const dlg = await screen.findByRole('dialog')
    expect(dlg).not.toHaveTextContent(/NÃO desfaz/)
  })

  it('erro do servidor aparece no diálogo, que continua aberto', async () => {
    anular.mockRejectedValue(
      erroApi(409, 'DECISAO_NAO_CONFIRMADA', 'Este título não tem boleto confirmado para anular.'),
    )
    renderPainel([sugestao({ estado: 'CONFIRMADA' })])
    await userEvent.click(screen.getByRole('button', { name: /^Anular confirmação do boleto/ }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Motivo'), 'confirmação errada')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Anular confirmação' }))
    expect(
      await within(dlg).findByText('Este título não tem boleto confirmado para anular.'),
    ).toBeInTheDocument()
  })

  it('confirmação órfã: aviso claro em português, sem Confirmar nem Copiar, com Anular', () => {
    renderPainel([
      sugestao({
        estado: 'CONFIRMADA',
        orfa: true,
        motivoOrfa: 'O boleto confirmado saiu do pool DDA (arquivo cancelado ou removido).',
        confirmavel: false,
        avaliacao: { ...sugestao().avaliacao, confirmavel: false },
      }),
    ])
    expect(screen.getByText('confirmação órfã')).toBeInTheDocument()
    expect(screen.getByText(/saiu do pool DDA/)).toBeInTheDocument()
    expect(screen.getByText(/o título e o boleto ficam presos/)).toBeInTheDocument()
    expect(screen.queryByText(/ainda não associado no ERP/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Confirmar boleto/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copiar linha/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Anular confirmação do boleto/ })).toBeEnabled()
  })
})

describe('SugestaoBoletoPainel — acessibilidade', () => {
  const duas = () => [
    sugestao({ confirmacaoEmissorId: 'par-1' }),
    sugestao({ ddcCod: 153, ditCod: 8, numeroBoleto: '163987000', confirmacaoEmissorId: 'par-2' }),
  ]

  it('os botões repetidos têm nomes únicos e citam o número do boleto', () => {
    renderPainel(duas())
    const nomes = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(new Set(nomes).size).toBe(nomes.length)
    expect(screen.getByRole('button', { name: 'Confirmar boleto 163987000' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rejeitar boleto 001532761' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copiar linha digitável do boleto 163987000' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Revogar confirmação do boleto 001532761' }),
    ).toBeInTheDocument()
  })

  it.each([
    ['CONHECIDO', /text-success-foreground/],
    ['FORTE', /text-success-foreground/],
    ['ATENCAO', /text-warning-foreground/],
    ['VENCIDO_INFORMATIVO', /text-warning-foreground/],
    ['SEM_RELACAO', /text-muted-foreground/],
  ] as const)('tier %s tem o tom explícito', (resultado, esperado) => {
    renderPainel([sugestao({ avaliacao: { ...sugestao().avaliacao, resultado } })])
    const rotulos = {
      CONHECIDO: 'sugestão forte · emissor conhecido',
      FORTE: 'sugestão forte',
      ATENCAO: 'atenção',
      VENCIDO_INFORMATIVO: 'vencido · só informativo',
      SEM_RELACAO: 'sem relação com o título',
    }
    const badge = screen.getByText(rotulos[resultado])
    expect(badge.className).toMatch(esperado)
    expect(badge.className).not.toMatch(/(^|\s)text-(warning|success)(\s|$)/)
    if (resultado === 'SEM_RELACAO') expect(badge.className).not.toMatch(/success/)
  })

  it('Confirmar desabilitado é descrito pelo motivo', () => {
    renderPainel([
      sugestao({
        confirmavel: false,
        motivo: 'Boleto vence antes da data de débito.',
        avaliacao: { ...sugestao().avaliacao, confirmavel: false },
      }),
    ])
    const botao = screen.getByRole('button', { name: /^Confirmar boleto/ })
    expect(botao).toHaveAccessibleDescription(/Boleto vence antes da data de débito/)
  })

  it('um erro é anunciado por uma única região role=status, sem alert aninhado', async () => {
    confirmar.mockRejectedValue(erroApi(429, 'MUITAS_DECISOES', 'Muitas decisões.'))
    renderPainel([sugestao()])
    await userEvent.click(screen.getByRole('button', { name: /^Confirmar boleto/ }))
    expect(await screen.findByRole('status')).toHaveTextContent('Muitas decisões.')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

/**
 * `/perfil` (ADR-0058): seções independentes, "não foi possível verificar" ≠ "sem acesso", KPIs por
 * frente com gate `<frente>:ver`, histórico com filtros e cursor.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Atividade, LinhaHistorico, PaginaHistorico, Perfil } from '@/lib/api/perfil'

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ username: 'ana.souza', devBypass: false }),
}))

let permissoes: {
  carregando: boolean
  falhou: boolean
  tem: (p: string) => boolean
  recarregar: jest.Mock
  papel?: { id: number; nome: string }
}
jest.mock('@/lib/auth/PermissoesProvider', () => ({ usePermissoes: () => permissoes }))

const getPerfil = jest.fn<Promise<Perfil>, []>()
const getAtividade = jest.fn<Promise<Atividade>, [unknown]>()
const getHistorico = jest.fn<Promise<PaginaHistorico>, [unknown]>()
jest.mock('@/lib/api/perfil', () => {
  const real = jest.requireActual('@/lib/api/perfil')
  return {
    ...real,
    getPerfil: () => getPerfil(),
    getAtividade: (q: unknown) => getAtividade(q),
    getHistorico: (q: unknown) => getHistorico(q),
  }
})

import PerfilPage from '@/app/perfil/page'

const PERFIL: Perfil = {
  username: 'ana.souza',
  email: null,
  ativo: true,
  membroDesde: '2026-08-01T12:00:00.000Z',
  criadoPor: 'admin',
  papel: { id: 2, nome: 'Operador', descricao: null },
  conexos: { vinculado: false, conexosUsername: null },
  permissoes: [
    { codigo: 'permutas:executar', efetiva: true, origem: 'papel' },
    { codigo: 'permutas:ver', efetiva: true, origem: 'implicada', implicadaPor: 'permutas:executar' },
    {
      codigo: 'metricas:ver',
      efetiva: true,
      origem: 'concedida',
      por: 'admin',
      em: '2026-09-01T10:00:00.000Z',
    },
    {
      codigo: 'sispag:ver',
      efetiva: false,
      origem: 'revogada',
      por: 'gestor',
      em: '2026-09-02T10:00:00.000Z',
    },
  ],
}

const zeros = {
  permutas: { concluidas: 0, parciais: 0, valorBaixado: 0, aguardandoBordero: 0, comErro: 0 },
  sispag: {
    lotesFinalizados: 0,
    remessasGeradas: 0,
    valorRemessado: 0,
    valorAgendado: 0,
    valorPagoConfirmado: 0,
    retornosConciliados: 0,
    comErro: 0,
  },
  recebimentos: { concluidas: 0, valor: 0, comErro: 0 },
}

const ATIVIDADE: Atividade = {
  periodo: { tipo: 'semana', inicio: '2026-09-25T21:00:00.000Z', fim: '2026-10-01T15:00:00.000Z' },
  periodoAnterior: { inicio: '2026-09-17T03:00:00.000Z', fim: '2026-09-25T21:00:00.000Z' },
  permutas: {
    atual: { concluidas: 5, parciais: 2, valorBaixado: 12345.67, aguardandoBordero: 3, comErro: 1 },
    anterior: { ...zeros.permutas, concluidas: 2 },
  },
  sispag: {
    atual: {
      lotesFinalizados: 1,
      remessasGeradas: 1,
      valorRemessado: 1000,
      valorAgendado: 800,
      valorPagoConfirmado: 500,
      retornosConciliados: 1,
      comErro: 2,
    },
    anterior: { ...zeros.sispag, lotesFinalizados: 3 },
  },
  recebimentos: {
    atual: { concluidas: 4, valor: 900, comErro: 0 },
    anterior: { ...zeros.recebimentos, concluidas: 4 },
  },
}

const linha = (over: Partial<LinhaHistorico> = {}): LinhaHistorico => ({
  em: new Date(Date.now() - 2 * 3600_000).toISOString(),
  frente: 'permutas',
  acao: 'baixa_permuta',
  alvoTipo: 'adiantamento',
  alvoId: 'ADTO-123',
  valor: 1500,
  status: 'sucesso',
  fonte: 'permuta_execucao',
  fonteId: '1',
  detalhe: {},
  ...over,
})

const comPermissoes = (lista: string[], extra: Partial<typeof permissoes> = {}) => {
  permissoes = {
    carregando: false,
    falhou: false,
    tem: (p: string) => lista.includes(p),
    recarregar: jest.fn(),
    papel: { id: 2, nome: 'Operador' },
    ...extra,
  }
}

const secao = (nome: RegExp) => screen.getByRole('region', { name: nome })

beforeEach(() => {
  window.localStorage.clear()
  comPermissoes(['permutas:ver', 'sispag:ver', 'recebimentos:ver'])
  getPerfil.mockReset().mockResolvedValue(PERFIL)
  getAtividade.mockReset().mockResolvedValue(ATIVIDADE)
  getHistorico.mockReset().mockResolvedValue({ itens: [linha()] })
})

describe('/perfil — estrutura', () => {
  it('cards na ordem Identidade, Permissões, Minha atividade, Histórico, Segurança (#senha)', async () => {
    render(<PerfilPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Meu perfil' })).toBeInTheDocument()
    const nomes = screen.getAllByRole('region').map((r) => r.getAttribute('aria-labelledby'))
    expect(nomes).toEqual([
      'perfil-identidade',
      'perfil-permissoes',
      'perfil-atividade',
      'perfil-historico',
      'perfil-seguranca',
    ])
    expect(document.getElementById('senha')).not.toBeNull()
    await screen.findByText('ana.souza', { selector: '[data-campo="username"]' })
  })

  it('cada seção tem skeleton próprio enquanto carrega', () => {
    getPerfil.mockReturnValue(new Promise(() => undefined))
    getAtividade.mockReturnValue(new Promise(() => undefined))
    getHistorico.mockReturnValue(new Promise(() => undefined))
    render(<PerfilPage />)
    for (const nome of [/identidade/i, /permissões/i, /minha atividade/i, /histórico/i]) {
      expect(within(secao(nome)).getAllByTestId('skeleton').length).toBeGreaterThan(0)
    }
  })

  it('falha do histórico não derruba a Identidade (erros independentes)', async () => {
    getHistorico.mockRejectedValue(new Error('HTTP 500'))
    render(<PerfilPage />)
    expect(await within(secao(/histórico/i)).findByText(/não foi possível carregar/i)).toBeInTheDocument()
    expect(within(secao(/histórico/i)).getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument()
    expect(await within(secao(/identidade/i)).findByText('Operador')).toBeInTheDocument()
  })

  it('permissões que falharam: "não foi possível verificar" + recarregar, nunca "sem acesso"', async () => {
    comPermissoes([], { falhou: true })
    render(<PerfilPage />)
    for (const nome of [/permissões/i, /minha atividade/i]) {
      const s = secao(nome)
      expect(within(s).getByText(/não foi possível verificar/i)).toBeInTheDocument()
      expect(within(s).queryByText(/sem acesso/i)).not.toBeInTheDocument()
    }
    const botoes = screen.getAllByRole('button', { name: /recarregar/i })
    await userEvent.setup().click(botoes[0])
    expect(permissoes.recarregar).toHaveBeenCalled()
    expect(getAtividade).not.toHaveBeenCalled()
  })
})

describe('/perfil — Identidade', () => {
  it('e-mail nulo = "não cadastrado"; sem vínculo = aviso do robô CLONEX; sem link de gestão', async () => {
    render(<PerfilPage />)
    const s = secao(/identidade/i)
    expect(await within(s).findByText('não cadastrado')).toBeInTheDocument()
    expect(within(s).getByText(/robô CLONEX/)).toBeInTheDocument()
    expect(within(s).queryByRole('link', { name: /usuários/i })).not.toBeInTheDocument()
    expect(within(s).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('com usuarios:gerenciar aparece o link para /usuarios; com vínculo, sem aviso', async () => {
    comPermissoes(['usuarios:gerenciar'])
    getPerfil.mockResolvedValue({
      ...PERFIL,
      email: 'ana@columbia.com.br',
      conexos: { vinculado: true, conexosUsername: 'ANA_SOUZA' },
    })
    render(<PerfilPage />)
    const s = secao(/identidade/i)
    expect(await within(s).findByText('ana@columbia.com.br')).toBeInTheDocument()
    expect(within(s).getByText('ANA_SOUZA')).toBeInTheDocument()
    expect(within(s).queryByText(/robô CLONEX/)).not.toBeInTheDocument()
    expect(within(s).getByRole('link', { name: /gerenciar usuários/i })).toHaveAttribute('href', '/usuarios')
  })
})

describe('/perfil — Permissões', () => {
  it('agrupa por módulo e mostra a origem de cada uma', async () => {
    render(<PerfilPage />)
    const s = secao(/permissões/i)
    expect(await within(s).findByText(/pelo papel/i)).toBeInTheDocument()
    expect(within(s).getByText(/implicada por executar/i)).toBeInTheDocument()
    expect(within(s).getByText(/concedida por admin/i)).toBeInTheDocument()
    expect(within(s).getByText(/revogada por gestor/i)).toBeInTheDocument()
    expect(within(s).getByText('Permutas')).toBeInTheDocument()
  })
})

describe('/perfil — Minha atividade', () => {
  it('tiles só para frentes com <frente>:ver', async () => {
    comPermissoes(['permutas:ver'])
    render(<PerfilPage />)
    const s = secao(/minha atividade/i)
    expect(await within(s).findByText('Permutas concluídas')).toBeInTheDocument()
    expect(within(s).queryByText(/remessas geradas/i)).not.toBeInTheDocument()
    expect(within(s).queryByText(/adiantamentos concluídos/i)).not.toBeInTheDocument()
  })

  it('Permutas: principal, R$ e os três secundários; comparação ↑/↓ com texto', async () => {
    render(<PerfilPage />)
    const s = secao(/minha atividade/i)
    expect(await within(s).findByText('2 parciais')).toBeInTheDocument()
    expect(within(s).getByText('3 aguardando borderô finalizado')).toBeInTheDocument()
    expect(within(s).getByRole('button', { name: '1 com erro em Permutas' })).toBeInTheDocument()
    expect(within(s).getAllByText(/R\$\s*12\.345,67/).length).toBeGreaterThan(0)
    expect(within(s).getByText(/aumento de 3 em relação ao período anterior/i)).toBeInTheDocument()
    expect(within(s).getByText(/queda de 2 em relação ao período anterior/i)).toBeInTheDocument()
    expect(within(s).getByText(/igual ao período anterior/i)).toBeInTheDocument()
  })

  it('SISPAG nunca usa "pago" sem "confirmado"', async () => {
    render(<PerfilPage />)
    const s = secao(/minha atividade/i)
    await within(s).findByText(/remessas geradas/i)
    const texto = s.textContent ?? ''
    const ocorrencias = texto.match(/pago(?! confirmado)/gi) ?? []
    expect(ocorrencias).toEqual([])
    expect(texto).toMatch(/pago confirmado/i)
  })

  it('semana rotulada "desde sex 18:00"', async () => {
    render(<PerfilPage />)
    expect(within(secao(/minha atividade/i)).getByRole('button', { name: /esta semana/i })).toHaveTextContent(
      /desde sex 18:00/,
    )
  })

  it('período persistido em localStorage', async () => {
    const user = userEvent.setup()
    render(<PerfilPage />)
    await user.click(within(secao(/minha atividade/i)).getByRole('button', { name: /este mês/i }))
    await waitFor(() => expect(getAtividade).toHaveBeenLastCalledWith({ periodo: 'mes' }))
    expect(window.localStorage.getItem('perfil.atividade.periodo')).toContain('mes')
  })

  it('localStorage que lança não quebra a página', async () => {
    const get = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const user = userEvent.setup()
    render(<PerfilPage />)
    await user.click(within(secao(/minha atividade/i)).getByRole('button', { name: /hoje/i }))
    await waitFor(() => expect(getAtividade).toHaveBeenLastCalledWith({ periodo: 'hoje' }))
    get.mockRestore()
    set.mockRestore()
  })

  it('"N com erro" filtra o histórico por status=erro e pela frente', async () => {
    const user = userEvent.setup()
    render(<PerfilPage />)
    const botao = await within(secao(/minha atividade/i)).findByRole('button', {
      name: '2 com erro em SISPAG',
    })
    await user.click(botao)
    await waitFor(() =>
      expect(getHistorico).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'erro', frente: 'sispag' }),
      ),
    )
  })
})

describe('/perfil — Histórico', () => {
  it('linha: tempo relativo com absoluto no title, id copiável, link só com <frente>:ver', async () => {
    render(<PerfilPage />)
    const s = secao(/histórico/i)
    const tempo = (await within(s).findAllByText(/há 2 horas/))[0]
    expect(tempo.closest('time')?.getAttribute('title')).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    expect(within(s).getAllByText('ADTO-123')[0]).toHaveClass('select-all')
    expect(within(s).getAllByRole('link', { name: /abrir permutas/i })[0]).toHaveAttribute(
      'href',
      '/permutas',
    )
  })

  it('sem permutas:ver o link some, a linha continua', async () => {
    comPermissoes(['sispag:ver'])
    render(<PerfilPage />)
    const s = secao(/histórico/i)
    expect((await within(s).findAllByText('ADTO-123')).length).toBeGreaterThan(0)
    expect(within(s).queryByRole('link', { name: /abrir permutas/i })).not.toBeInTheDocument()
  })

  it('"Carregar mais" usa o cursor opaco e some quando não há próximo', async () => {
    getHistorico
      .mockResolvedValueOnce({ itens: [linha()], proximoCursor: 'CUR1' })
      .mockResolvedValueOnce({ itens: [linha({ fonteId: '2', alvoId: 'ADTO-456' })] })
    const user = userEvent.setup()
    render(<PerfilPage />)
    const s = secao(/histórico/i)
    await user.click(await within(s).findByRole('button', { name: /carregar mais/i }))
    await waitFor(() =>
      expect(getHistorico).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'CUR1' })),
    )
    expect((await within(s).findAllByText('ADTO-456')).length).toBeGreaterThan(0)
    expect(within(s).queryByRole('button', { name: /carregar mais/i })).not.toBeInTheDocument()
  })

  it('estado vazio', async () => {
    getHistorico.mockResolvedValue({ itens: [] })
    render(<PerfilPage />)
    expect(await within(secao(/histórico/i)).findByText(/nenhuma ação/i)).toBeInTheDocument()
  })

  it('badge "parcial" e "assinado no ERP como X" quando difere do vínculo', async () => {
    getHistorico.mockResolvedValue({
      itens: [linha({ detalhe: { parcial: true, conexosUsername: 'ROBO_CLONEX' } })],
    })
    render(<PerfilPage />)
    const s = secao(/histórico/i)
    expect((await within(s).findAllByText('parcial')).length).toBeGreaterThan(0)
    expect(within(s).getAllByText(/assinado no ERP como ROBO_CLONEX/).length).toBeGreaterThan(0)
  })

  it('mudar o filtro de status reinicia o cursor', async () => {
    getHistorico.mockResolvedValue({ itens: [linha()], proximoCursor: 'CUR1' })
    const user = userEvent.setup()
    render(<PerfilPage />)
    const s = secao(/histórico/i)
    await within(s).findByRole('button', { name: /carregar mais/i })
    await user.click(within(s).getByRole('combobox', { name: /status/i }))
    await user.click(await screen.findByRole('option', { name: 'Erro' }))
    await waitFor(() =>
      expect(getHistorico).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'erro' })),
    )
    const ultima = getHistorico.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(ultima.cursor).toBeUndefined()
  })
})

// Silencia o aviso de act() de efeitos que resolvem depois do fim do teste.
afterEach(async () => {
  await act(async () => undefined)
})

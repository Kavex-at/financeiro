/**
 * Gaveta do título depois de "Confirmar e renegociar" (ADR-0074): o ajuste roda em segundo plano
 * no servidor; a gaveta relê o ledger a cada 2 s até uma etapa final, avisa a tela (que relê o
 * painel e leva a gaveta ao título novo) e, sem fim em ~60 s, para e diz que segue em andamento.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  AjusteCentavos,
  DesfechoTituloBoleto,
  EstadoAjustesCentavos,
  IrmaoConjunto,
  ModoAjusteCentavos,
  ResultadoConjunto,
  SugestaoBoleto,
} from '@/lib/sispag'
import {
  confirmarEmConjunto,
  confirmarSugestaoBoleto,
  fetchAjustesCentavos,
  fetchBoletosDdaDoTitulo,
  fetchIrmaosConjunto,
} from '@/lib/sispag'
import {
  BoletosDoTituloDialog,
  INTERVALO_ACOMPANHAMENTO_MS,
  TENTATIVAS_ACOMPANHAMENTO,
} from './BoletosDoTituloDialog'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return {
    ...real,
    confirmarEmConjunto: jest.fn(),
    confirmarSugestaoBoleto: jest.fn(),
    fetchAjustesCentavos: jest.fn(),
    fetchBoletosDdaDoTitulo: jest.fn(),
    fetchIrmaosConjunto: jest.fn(),
  }
})

const confirmar = confirmarSugestaoBoleto as jest.Mock
const ajustes = fetchAjustesCentavos as jest.Mock
const boletos = fetchBoletosDdaDoTitulo as jest.Mock
const irmaos = fetchIrmaosConjunto as jest.Mock
const emConjunto = confirmarEmConjunto as jest.Mock

const titulo = {
  filCod: 1,
  docCod: '41027',
  titCod: '1',
  valor: 647.56,
  vencimento: '2026-10-30',
}

const sugestao: SugestaoBoleto = {
  filCod: 1,
  docCod: '41027',
  titCod: '1',
  valorTitulo: 647.56,
  vencimentoTitulo: '2026-10-30',
  dataDebito: '2026-10-30',
  ddcCod: 10,
  ditCod: 1,
  numeroBoleto: '25444',
  valorBoleto: 647.57,
  vencimentoBoleto: '2026-10-30',
  avaliacao: {
    resultado: 'FORTE',
    deltaValor: 0.01,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: ['VALOR_ATE_5_CENTAVOS', 'MESMO_DIA'],
    confirmavel: true,
  },
  estado: 'SUGERIDA',
  confirmavel: true,
}

const ajuste = (over: Partial<AjusteCentavos>): AjusteCentavos => ({
  id: 'exec-1',
  filCod: 1,
  docCod: '41027',
  titCodOrigem: '1',
  decisaoId: 'dec-1',
  etapa: 'pendente',
  tentativas: 1,
  ...over,
})

let ledger: AjusteCentavos[] = []
let modo: ModoAjusteCentavos = 'on'
const estado = (): EstadoAjustesCentavos => ({ modo, avisos: [], ajustes: ledger })

const avancar = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

const confirmarERenegociar = async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
  // O modo da filial (`on`) chega pela leitura do ledger; só então o par "renegocia".
  await waitFor(() =>
    expect(screen.getByTestId('texto-confirmar')).toHaveTextContent('renegocia o título'),
  )
  await user.click(await screen.findByRole('button', { name: 'Confirmar boleto 25444' }))
  const dialogo = await screen.findByRole('dialog', { name: 'Confirmar e renegociar no Conexos' })
  await user.click(within(dialogo).getByRole('button', { name: 'Confirmar e renegociar' }))
  await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
}

describe('BoletosDoTituloDialog — acompanhamento do ajuste de centavos', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    ledger = []
    modo = 'on'
    irmaos.mockReset()
    emConjunto.mockReset()
    confirmar.mockReset().mockResolvedValue(undefined)
    ajustes.mockReset().mockImplementation(async () => estado())
    boletos.mockReset().mockResolvedValue({ doTitulo: [], mesmoValor: [] })
  })
  afterEach(() => jest.useRealTimers())

  it('relê o ledger até concluir e avisa a tela com o título novo', async () => {
    const onDecidido = jest.fn()
    const onAjusteFinalizado = jest.fn()
    render(
      <BoletosDoTituloDialog
        titulo={titulo}
        onClose={jest.fn()}
        sugestoes={[sugestao]}
        podeExecutar
        onDecidido={onDecidido}
        onAjusteFinalizado={onAjusteFinalizado}
      />,
    )
    await confirmarERenegociar()
    expect(onDecidido).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByTestId('acompanhamento-ajuste')).toHaveTextContent(
        'Ajustando o título no Conexos',
      ),
    )

    ledger = [ajuste({ etapa: 'renegociacao_criada' })]
    await avancar(INTERVALO_ACOMPANHAMENTO_MS)
    expect(onAjusteFinalizado).not.toHaveBeenCalled()

    ledger = [ajuste({ etapa: 'concluido', titCodNovo: '2', valorBoletoCentavos: 64757 })]
    await avancar(INTERVALO_ACOMPANHAMENTO_MS)
    await waitFor(() =>
      expect(onAjusteFinalizado).toHaveBeenCalledWith(
        expect.objectContaining({ etapa: 'concluido', titCodNovo: '2' }),
      ),
    )
    expect(
      screen.getByTestId('acompanhamento-ajuste').textContent?.replace(/\s/g, ' '),
    ).toContain('Título renegociado no Conexos: 41027/1 → 41027/2 · R$ 647,57')

    // Acabou: nenhuma releitura nova do ledger.
    const chamadas = ajustes.mock.calls.length
    await avancar(INTERVALO_ACOMPANHAMENTO_MS * 3)
    expect(ajustes.mock.calls.length).toBe(chamadas)
  })

  it('sem fim em ~60 s: para e diz que o ajuste segue em andamento', async () => {
    const onAjusteFinalizado = jest.fn()
    render(
      <BoletosDoTituloDialog
        titulo={titulo}
        onClose={jest.fn()}
        sugestoes={[sugestao]}
        podeExecutar
        onAjusteFinalizado={onAjusteFinalizado}
      />,
    )
    await confirmarERenegociar()
    ledger = [ajuste({ etapa: 'pendente' })]
    await avancar(INTERVALO_ACOMPANHAMENTO_MS * TENTATIVAS_ACOMPANHAMENTO)
    expect(screen.getByTestId('acompanhamento-ajuste')).toHaveTextContent(
      'ainda está em andamento',
    )
    expect(onAjusteFinalizado).not.toHaveBeenCalled()
    const chamadas = ajustes.mock.calls.length
    await avancar(INTERVALO_ACOMPANHAMENTO_MS * 3)
    expect(ajustes.mock.calls.length).toBe(chamadas)
  })

  it('trocar de título cancela o acompanhamento', async () => {
    const { rerender } = render(
      <BoletosDoTituloDialog
        titulo={titulo}
        onClose={jest.fn()}
        sugestoes={[sugestao]}
        podeExecutar
      />,
    )
    await confirmarERenegociar()
    rerender(
      <BoletosDoTituloDialog
        titulo={{ ...titulo, docCod: '999' }}
        onClose={jest.fn()}
        sugestoes={[{ ...sugestao, docCod: '999' }]}
        podeExecutar
      />,
    )
    await avancar(0)
    const chamadas = ajustes.mock.calls.length
    await avancar(INTERVALO_ACOMPANHAMENTO_MS * 3)
    expect(ajustes.mock.calls.length).toBe(chamadas)
    expect(screen.getByTestId('acompanhamento-ajuste')).toBeEmptyDOMElement()
  })
})

/** Confirmação em conjunto (I15t, ADR-0080) que inclui o próprio título da gaveta. */
describe('BoletosDoTituloDialog — ajuste do próprio título confirmado em conjunto', () => {
  const desfecho: DesfechoTituloBoleto = {
    filCod: 1,
    docCod: '41027',
    titCod: '1',
    valorTitulo: 647.56,
    vencimentoTitulo: '2026-10-30',
    dataDebito: '2026-10-30',
    situacao: 'SEM_CANDIDATO',
    candidatos: [],
    totalCandidatos: 0,
    motivo: 'sem boleto',
    avisoVenceAntes: 'NENHUM',
    diasVencidoNoDebito: 0,
  }

  const linha = (docCod: string, over: Partial<IrmaoConjunto> = {}): IrmaoConjunto => ({
    filCod: 1,
    docCod,
    titCod: '1',
    ddcCod: 10,
    ditCod: Number(docCod),
    origem: false,
    numeroDocumento: '25444',
    numeroBoleto: '25444',
    valorTitulo: 647.56,
    vencimentoTitulo: '2026-10-30',
    valorBoleto: 647.57,
    vencimentoBoleto: '2026-10-30',
    deltaValor: 0.01,
    deltaDias: 0,
    tier: 'FORTE',
    avisos: [],
    ajusteAutomatico: true,
    ...over,
  })

  const resultadoDe = (linhas: IrmaoConjunto[]): ResultadoConjunto => ({
    conjuntoId: 'cj-1',
    resultados: linhas.map((l) => ({
      chave: {
        filCod: l.filCod,
        docCod: l.docCod,
        titCod: l.titCod,
        ddcCod: l.ddcCod,
        ditCod: l.ditCod,
      },
      status: 'CONFIRMADA' as const,
    })),
    confirmadas: linhas.length,
    recusadas: 0,
  })

  beforeEach(() => {
    jest.useFakeTimers()
    ledger = []
    modo = 'on'
    confirmar.mockReset()
    ajustes.mockReset().mockImplementation(async () => estado())
    boletos.mockReset().mockResolvedValue({ doTitulo: [], mesmoValor: [] })
  })
  afterEach(() => jest.useRealTimers())

  const montar = async (origem: IrmaoConjunto) => {
    const irmao = linha('41030')
    const lista = [origem, irmao]
    irmaos.mockReset().mockResolvedValue({
      origem: { filCod: 1, docCod: '41027', titCod: '1' },
      irmaos: lista,
      maximo: 30,
    })
    emConjunto.mockReset().mockResolvedValue(resultadoDe(lista))
    const onAjusteFinalizado = jest.fn()
    render(
      <BoletosDoTituloDialog
        titulo={titulo}
        onClose={jest.fn()}
        desfecho={desfecho}
        podeExecutar
        onAjusteFinalizado={onAjusteFinalizado}
      />,
    )
    // O modo da filial chega pela leitura do ledger antes da confirmação.
    await waitFor(() => expect(ajustes).toHaveBeenCalled())
    await avancar(0)
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    await user.click(await screen.findByRole('checkbox', { name: 'Marcar o título 41027/1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Marcar o título 41030/1' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar selecionados (2)' }))
    const dialogo = await screen.findByRole('dialog', { name: /de uma vez/ })
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar 2 títulos' }))
    await waitFor(() => expect(emConjunto).toHaveBeenCalledTimes(1))
    await avancar(0)
    return { onAjusteFinalizado }
  }

  it('com ajuste automático no próprio título: acompanha e leva ao título novo', async () => {
    const { onAjusteFinalizado } = await montar(linha('41027', { origem: true }))
    await waitFor(() =>
      expect(screen.getByTestId('acompanhamento-ajuste')).toHaveTextContent(
        'Ajustando o título no Conexos',
      ),
    )
    ledger = [ajuste({ etapa: 'concluido', titCodNovo: '2', valorBoletoCentavos: 64757 })]
    await avancar(INTERVALO_ACOMPANHAMENTO_MS)
    await waitFor(() =>
      expect(onAjusteFinalizado).toHaveBeenCalledWith(
        expect.objectContaining({ etapa: 'concluido', titCodNovo: '2' }),
      ),
    )
  })

  it('sem ajuste automático no próprio título: não acompanha', async () => {
    const { onAjusteFinalizado } = await montar(
      linha('41027', { origem: true, ajusteAutomatico: false }),
    )
    const chamadas = ajustes.mock.calls.length
    await avancar(INTERVALO_ACOMPANHAMENTO_MS * 3)
    expect(ajustes.mock.calls.length).toBe(chamadas)
    expect(screen.getByTestId('acompanhamento-ajuste')).toBeEmptyDOMElement()
    expect(onAjusteFinalizado).not.toHaveBeenCalled()
  })

  it('modo shadow: não acompanha, mesmo com ajuste automático na linha', async () => {
    modo = 'shadow'
    const { onAjusteFinalizado } = await montar(linha('41027', { origem: true }))
    const chamadas = ajustes.mock.calls.length
    await avancar(INTERVALO_ACOMPANHAMENTO_MS * 3)
    expect(ajustes.mock.calls.length).toBe(chamadas)
    expect(screen.getByTestId('acompanhamento-ajuste')).toBeEmptyDOMElement()
    expect(onAjusteFinalizado).not.toHaveBeenCalled()
  })
})

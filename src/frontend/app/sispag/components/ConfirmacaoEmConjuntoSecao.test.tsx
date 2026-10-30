/**
 * Confirmação em conjunto de títulos irmãos na gaveta (I15t, ADR-0080): nada vem marcado, cada linha
 * mostra título, nº doc, nº boleto e as diferenças; o resultado volta por linha.
 */

import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { IrmaoConjunto, IrmaosConjunto, ResultadoConjunto } from '@/lib/sispag'
import { ConfirmacaoEmConjuntoSecao, resumoDaSelecao } from './ConfirmacaoEmConjuntoSecao'

jest.mock('@/lib/http', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/auth/token', () => ({ withAuthHeaders: jest.fn(async () => ({})) }))
import { apiFetch } from '@/lib/http'

const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>
const resp = (corpo: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => corpo }) as unknown as Response

const ORIGEM = { filCod: 2, docCod: '40100', titCod: '1' }

const irmao = (docCod: string, over: Partial<IrmaoConjunto> = {}): IrmaoConjunto => ({
  filCod: 2,
  docCod,
  titCod: '1',
  ddcCod: 900,
  ditCod: Number(docCod),
  origem: false,
  numeroDocumento: `25${docCod.slice(-3)}`,
  numeroBoleto: `25${docCod.slice(-3)}`,
  valorTitulo: 647.56,
  vencimentoTitulo: '2026-10-27',
  valorBoleto: 647.57,
  vencimentoBoleto: '2026-10-27',
  deltaValor: 0.01,
  deltaDias: 0,
  tier: 'FORTE',
  avisos: [],
  ajusteAutomatico: true,
  ...over,
})

const LISTA: IrmaosConjunto = {
  origem: ORIGEM,
  maximo: 30,
  irmaos: [
    irmao('40100', { origem: true, numeroDocumento: '25037', numeroBoleto: '25037' }),
    irmao('40107', {
      numeroDocumento: '25041',
      numeroBoleto: '25041',
      avisos: ['ESCOLHIDO_SO_PELO_NUMERO'],
    }),
    irmao('40111', {
      vencimentoBoleto: '2026-10-28',
      deltaDias: 1,
      avisos: ['FAIXA_AJUSTE_MANUAL'],
      ajusteAutomatico: false,
    }),
  ],
}

/** Roteia o backend: GET dos irmãos e POST do conjunto. */
const backend = (opcoes: { lista?: IrmaosConjunto; resultado?: ResultadoConjunto; erroPost?: [number, unknown] }) => {
  let lista = opcoes.lista ?? LISTA
  mockApiFetch.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/titulo/irmaos')) return resp(lista)
    if (u.includes('/confirmar-em-conjunto')) {
      if (opcoes.erroPost) return resp(opcoes.erroPost[1], opcoes.erroPost[0])
      return resp(opcoes.resultado)
    }
    throw new Error(`inesperado: ${u} ${init?.method ?? 'GET'}`)
  })
  return {
    trocarLista: (l: IrmaosConjunto) => {
      lista = l
    },
  }
}

const corpoDoPost = () => {
  const call = mockApiFetch.mock.calls.find((c) => String(c[0]).includes('/confirmar-em-conjunto'))
  return JSON.parse(String(call?.[1]?.body)) as { origem: unknown; itens: Array<{ docCod: string }> }
}

describe('ConfirmacaoEmConjuntoSecao', () => {
  beforeEach(() => mockApiFetch.mockReset())

  it('lista os irmãos com título, nº doc, nº boleto e diferenças; nada vem marcado', async () => {
    backend({})
    render(<ConfirmacaoEmConjuntoSecao origem={ORIGEM} podeExecutar />)
    expect(
      await screen.findByText('Outros títulos deste fornecedor com número confiável'),
    ).toBeInTheDocument()
    const caixas = screen.getAllByRole('checkbox')
    expect(caixas).toHaveLength(3)
    expect(caixas.every((c) => c.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(screen.getByText('este título')).toBeInTheDocument()
    expect(screen.getByText(/nº doc 25041/)).toBeInTheDocument()
    expect(screen.getByText('nº 25041')).toBeInTheDocument()
    expect(screen.getAllByText('R$ +0,01').length).toBeGreaterThan(0)
    expect(screen.getByText('+1 dia')).toBeInTheDocument()
    expect(screen.getByText('só pelo número')).toBeInTheDocument()
    expect(screen.getByText('ajuste manual')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar selecionados (0)' })).toBeDisabled()
  })

  it('sem sispag:executar: só a lista, sem caixas nem botão', async () => {
    backend({})
    render(<ConfirmacaoEmConjuntoSecao origem={ORIGEM} podeExecutar={false} />)
    await screen.findByText('Outros títulos deste fornecedor com número confiável')
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Confirmar selecionados/ })).not.toBeInTheDocument()
  })

  it('só este título elegível: a seção não aparece', async () => {
    backend({ lista: { ...LISTA, irmaos: [LISTA.irmaos[0] as IrmaoConjunto] } })
    const { container } = render(<ConfirmacaoEmConjuntoSecao origem={ORIGEM} podeExecutar />)
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('resumo antes de confirmar, envia só as marcadas e mostra o resultado por linha', async () => {
    const user = userEvent.setup()
    const t = backend({
      resultado: {
        conjuntoId: 'c-1',
        confirmadas: 1,
        recusadas: 1,
        resultados: [
          { chave: { ...ORIGEM, docCod: '40107', ddcCod: 900, ditCod: 40107 }, status: 'CONFIRMADA' },
          {
            chave: { ...ORIGEM, docCod: '40111', ddcCod: 900, ditCod: 40111 },
            status: 'RECUSADA',
            motivo: 'O boleto deste título não é confirmável agora.',
          },
        ],
      },
    })
    const onDecidido = jest.fn()
    const onConfirmados = jest.fn()
    render(
      <ConfirmacaoEmConjuntoSecao
        origem={ORIGEM}
        podeExecutar
        onConfirmados={onConfirmados}
        onDecidido={onDecidido}
      />,
    )
    await user.click(await screen.findByRole('checkbox', { name: 'Marcar o título 40107/1' }))
    await user.click(screen.getByRole('checkbox', { name: 'Marcar o título 40111/1' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar selecionados (2)' }))

    const dialogo = await screen.findByRole('dialog')
    expect(within(dialogo).getByText('Confirmar 2 títulos de uma vez')).toBeInTheDocument()
    expect(within(dialogo).getByText(/1 título precisa de ajuste manual/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/1 título foi escolhido só/)).toBeInTheDocument()
    expect(within(dialogo).getByText(/1 título terá o ajuste automático/)).toBeInTheDocument()

    t.trocarLista({ ...LISTA, irmaos: [LISTA.irmaos[0] as IrmaoConjunto, LISTA.irmaos[2] as IrmaoConjunto] })
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar 2 títulos' }))

    expect(corpoDoPost().origem).toEqual(ORIGEM)
    expect(corpoDoPost().itens.map((i) => i.docCod)).toEqual(['40107', '40111'])
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('1 título confirmado, 1 recusado.')
    expect(status).toHaveTextContent('40111/1')
    expect(status).toHaveTextContent('O boleto deste título não é confirmável agora.')
    expect(onDecidido).toHaveBeenCalledTimes(1)
    // Só a linha recém-confirmada segue para quem acompanha o ajuste; a recusada fica de fora.
    expect(onConfirmados).toHaveBeenCalledTimes(1)
    expect(onConfirmados.mock.calls[0][0].map((l: IrmaoConjunto) => l.docCod)).toEqual(['40107'])
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Marcar o título 40107/1' })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: 'Confirmar selecionados (0)' })).toBeDisabled()
  })

  it('erro do servidor (422) fica no diálogo, que continua aberto', async () => {
    const user = userEvent.setup()
    backend({
      erroPost: [
        422,
        {
          error: 'Confirme no máximo 30 títulos de uma vez (31 marcados). Nada foi confirmado.',
          code: 'CONFIRMACAO_CONJUNTO_ACIMA_DO_LIMITE',
          retryable: false,
        },
      ],
    })
    render(<ConfirmacaoEmConjuntoSecao origem={ORIGEM} podeExecutar />)
    await user.click(await screen.findByRole('checkbox', { name: 'Marcar o título 40107/1' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar selecionados (1)' }))
    const dialogo = await screen.findByRole('dialog')
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar 1 título' }))
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/no máximo 30/)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('no teto, as caixas desmarcadas ficam desabilitadas', async () => {
    const user = userEvent.setup()
    backend({ lista: { ...LISTA, maximo: 1 } })
    render(<ConfirmacaoEmConjuntoSecao origem={ORIGEM} podeExecutar />)
    await user.click(await screen.findByRole('checkbox', { name: 'Marcar o título 40107/1' }))
    expect(screen.getByRole('checkbox', { name: 'Marcar o título 40111/1' })).toBeDisabled()
    expect(screen.getByText('Limite de 1 títulos por vez.')).toBeInTheDocument()
  })
})

describe('resumoDaSelecao', () => {
  it('conta ajuste automático, manual e escolhidos só pelo número', () => {
    expect(resumoDaSelecao(LISTA.irmaos)).toEqual({
      total: 3,
      ajusteAutomatico: 2,
      ajusteManual: 1,
      soPeloNumero: 1,
    })
  })
})

/**
 * Confirmar um par que renegocia o título no Conexos (ADR-0074): diálogo explícito antes, cópia
 * que não diz "não grava nada no Conexos" e o aviso de que a renegociação começou. Em `shadow`,
 * o fluxo segue como antes.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ModoAjusteCentavos, SugestaoBoleto } from '@/lib/sispag'
import { confirmarSugestaoBoleto } from '@/lib/sispag'
import { SugestaoBoletoPainel } from './SugestaoBoletoPainel'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, confirmarSugestaoBoleto: jest.fn() }
})

const confirmar = confirmarSugestaoBoleto as jest.Mock

const sugestao = (over: Partial<SugestaoBoleto['avaliacao']> = {}): SugestaoBoleto => ({
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
    ...over,
  },
  estado: 'SUGERIDA',
  confirmavel: true,
})

const renderPainel = (s: SugestaoBoleto, modo: ModoAjusteCentavos) => {
  const onDecidido = jest.fn()
  const onRenegociacaoIniciada = jest.fn()
  render(
    <SugestaoBoletoPainel
      sugestoes={[s]}
      podeExecutar
      podeCopiar={false}
      modoAjusteCentavos={modo}
      onDecidido={onDecidido}
      onRenegociacaoIniciada={onRenegociacaoIniciada}
    />,
  )
  return { onDecidido, onRenegociacaoIniciada }
}

describe('SugestaoBoletoPainel — confirmar e renegociar', () => {
  beforeEach(() => confirmar.mockReset().mockResolvedValue(undefined))

  it('modo on, Δ R$ 0,01 no mesmo dia: pede confirmação explícita antes de gravar', async () => {
    const { onDecidido, onRenegociacaoIniciada } = renderPainel(sugestao(), 'on')
    expect(screen.getByTestId('texto-confirmar')).toHaveTextContent(
      'o sistema renegocia o título no Conexos',
    )
    expect(screen.getByTestId('texto-confirmar')).not.toHaveTextContent('não grava nada')

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar boleto 25444' }))
    expect(confirmar).not.toHaveBeenCalled()
    const dialogo = await screen.findByRole('dialog', { name: 'Confirmar e renegociar no Conexos' })
    const texto = dialogo.textContent?.replace(/\s/g, ' ') ?? ''
    expect(texto).toContain('o título 41027/1 de R$ 647,56 é substituído por uma nova parcela de R$ 647,57')
    expect(texto).toContain('mesmo vencimento')
    expect(texto).toContain('O título original sai da carteira')

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Confirmar e renegociar' }))
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText('Boleto confirmado. Renegociando o título no Conexos…'),
    ).toBeInTheDocument()
    expect(onRenegociacaoIniciada).toHaveBeenCalledWith(expect.objectContaining({ titCod: '1' }))
    expect(onDecidido).toHaveBeenCalled()
  })

  it('"Voltar" no diálogo não confirma', async () => {
    renderPainel(sugestao(), 'on')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar boleto 25444' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar' }))
    expect(confirmar).not.toHaveBeenCalled()
  })

  it('shadow: confirma direto e mantém "não grava nada no Conexos"', async () => {
    const { onRenegociacaoIniciada } = renderPainel(sugestao(), 'shadow')
    expect(screen.getByTestId('texto-confirmar')).toHaveTextContent('não grava nada no Conexos')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar boleto 25444' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
    expect(
      await screen.findByText('Boleto confirmado para este título. Nada foi gravado no Conexos.'),
    ).toBeInTheDocument()
    expect(onRenegociacaoIniciada).not.toHaveBeenCalled()
  })

  it('vencimento diferente (+2 dias): sem diálogo de renegociação', async () => {
    renderPainel(sugestao({ deltaDias: 2, sinais: ['VALOR_ATE_5_CENTAVOS', 'DIAS_DEPOIS'] }), 'on')
    expect(screen.getByTestId('texto-confirmar')).toHaveTextContent('não grava nada no Conexos')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar boleto 25444' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
  })

  it('Δ R$ 0,06: sem diálogo de renegociação', async () => {
    renderPainel(sugestao({ deltaValor: 0.06 }), 'on')
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar boleto 25444' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
  })

  it('renegociação + reconhecimento: os dois diálogos, encadeados, antes de gravar', async () => {
    // Combinação sintética (o vence-antes real tem Δdias < 0): garante o encadeamento defensivo.
    const { onRenegociacaoIniciada } = renderPainel(
      sugestao({ sinais: ['VALOR_ATE_5_CENTAVOS', 'VENCE_ANTES_DO_TITULO'] }),
      'on',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar boleto 25444' }))
    const renegociar = await screen.findByRole('dialog', {
      name: 'Confirmar e renegociar no Conexos',
    })
    await userEvent.click(within(renegociar).getByRole('button', { name: 'Confirmar e renegociar' }))
    expect(confirmar).not.toHaveBeenCalled()
    const reconhecer = await screen.findByRole('dialog', { name: 'Boleto vence antes do título' })
    await userEvent.click(within(reconhecer).getByRole('checkbox'))
    await userEvent.click(within(reconhecer).getByRole('button', { name: 'Confirmar' }))
    await waitFor(() =>
      expect(confirmar).toHaveBeenCalledWith(expect.anything(), ['VENCE_ANTES_DO_TITULO']),
    )
    expect(
      await screen.findByText('Boleto confirmado. Renegociando o título no Conexos…'),
    ).toBeInTheDocument()
    expect(onRenegociacaoIniciada).toHaveBeenCalled()
  })
})

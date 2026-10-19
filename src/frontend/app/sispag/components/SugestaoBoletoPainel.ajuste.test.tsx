/**
 * Ajuste de centavos no painel da sugestão (ADR-0073): estado do ajuste, "tentar de novo" só para
 * `sispag:executar` e estados retomáveis, 409 com a mensagem do servidor e a decisão transferida
 * com o autor humano original.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AjusteCentavos, SugestaoBoleto } from '@/lib/sispag'
import { AutorizacaoApiError, tentarAjusteCentavos } from '@/lib/sispag'
import { SugestaoBoletoPainel } from './SugestaoBoletoPainel'

jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, tentarAjusteCentavos: jest.fn() }
})

const tentar = tentarAjusteCentavos as jest.Mock

const confirmada = (over: Partial<SugestaoBoleto> = {}): SugestaoBoleto => ({
  filCod: 2,
  docCod: '536',
  titCod: '1',
  credor: 'NELSON',
  valorTitulo: 462.49,
  vencimentoTitulo: '2026-10-30',
  dataDebito: '2026-10-30',
  ddcCod: 10,
  ditCod: 1,
  numeroBoleto: '12294',
  valorBoleto: 462.5,
  vencimentoBoleto: '2026-10-30',
  avaliacao: {
    resultado: 'CONHECIDO',
    deltaValor: 0.01,
    deltaPercentual: 0,
    deltaDias: 0,
    sinais: [],
    confirmavel: false,
  },
  estado: 'CONFIRMADA',
  confirmavel: false,
  ...over,
})

const ajuste = (over: Partial<AjusteCentavos> = {}): AjusteCentavos => ({
  id: 'exec-1',
  filCod: 2,
  docCod: '536',
  titCodOrigem: '1',
  decisaoId: 'dec-1',
  etapa: 'cancelado',
  tentativas: 1,
  ...over,
})

const renderPainel = (p: {
  sugestao?: SugestaoBoleto
  ajuste?: AjusteCentavos
  modo?: 'off' | 'shadow' | 'on'
  executar?: boolean
}) =>
  render(
    <SugestaoBoletoPainel
      sugestoes={[p.sugestao ?? confirmada()]}
      podeExecutar={p.executar ?? true}
      podeCopiar
      onDecidido={jest.fn()}
      ajusteCentavos={p.ajuste}
      modoAjusteCentavos={p.modo ?? 'on'}
    />,
  )

afterEach(() => jest.clearAllMocks())

describe('SugestaoBoletoPainel — ajuste de centavos (ADR-0073)', () => {
  it('modo off ⇒ selo "ajuste desligado", sem botão', () => {
    renderPainel({ modo: 'off' })
    expect(screen.getByTestId('selo-ajuste-desligado')).toHaveTextContent(
      'diferença de centavos — ajuste desligado',
    )
    expect(screen.queryByRole('button', { name: /Tentar de novo o ajuste/ })).toBeNull()
  })

  it('estado retomável + sispag:executar ⇒ "tentar de novo", desabilitado durante a chamada', async () => {
    let resolver: (v: unknown) => void = () => undefined
    tentar.mockReturnValue(new Promise((r) => (resolver = r)))
    renderPainel({})
    const botao = screen.getByRole('button', { name: /Tentar de novo o ajuste/ })
    await userEvent.click(botao)
    expect(botao).toBeDisabled()
    expect(tentar).toHaveBeenCalledWith({ filCod: 2, docCod: '536', titCod: '1' })
    resolver({ resultado: 'executado', modo: 'on', etapa: 'concluido' })
    expect(await screen.findByText(/Ajuste de centavos concluído/)).toBeInTheDocument()
  })

  it('409 ⇒ mostra a userMessage do servidor', async () => {
    tentar.mockRejectedValue(
      new AutorizacaoApiError(
        'O título 536/1 não pode ter os centavos ajustados: a diferença passa de R$ 0,05.',
        409,
        'AJUSTE_CENTAVOS_INELEGIVEL',
      ),
    )
    renderPainel({})
    await userEvent.click(screen.getByRole('button', { name: /Tentar de novo o ajuste/ }))
    expect(await screen.findByText(/a diferença passa de R\$ 0,05/)).toBeInTheDocument()
  })

  it('só sispag:ver, ou estado não retomável ⇒ sem botão', () => {
    renderPainel({ executar: false })
    expect(screen.queryByRole('button', { name: /Tentar de novo o ajuste/ })).toBeNull()
    renderPainel({ ajuste: ajuste({ etapa: 'cancelado' }) })
    expect(screen.queryByRole('button', { name: /Tentar de novo o ajuste/ })).toBeNull()
  })

  it('aguardando aprovação manual não é retomável pela plataforma', () => {
    renderPainel({ ajuste: ajuste({ etapa: 'aguardando_aprovacao_manual' }) })
    expect(screen.getByTestId('selo-ajuste-aviso')).toHaveTextContent(/aprovação/)
    expect(screen.queryByRole('button', { name: /Tentar de novo o ajuste/ })).toBeNull()
  })

  it('decisão transferida ⇒ autor humano original e a marca "transferida pelo sistema" (M1)', () => {
    renderPainel({
      sugestao: confirmada({ titCod: '2', decididoPor: 'ana', transferidaPor: 'sistema' }),
      ajuste: ajuste({ etapa: 'concluido', titCodOrigem: '1', titCodNovo: '2' }),
    })
    expect(screen.getByText(/confirmado por ana/)).toBeInTheDocument()
    expect(screen.getByText(/transferida pelo sistema/)).toBeInTheDocument()
  })

  it('nenhum código de barras completo na tela', () => {
    const { container } = renderPainel({
      ajuste: ajuste({ etapa: 'indeterminado', codigoMascarado: '34191…9000' }),
    })
    expect(container.textContent ?? '').not.toMatch(/\d{20,}/)
  })
})

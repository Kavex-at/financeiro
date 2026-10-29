import { fireEvent, render, screen } from '@testing-library/react'
import { FormaPagamentoBadge } from './FormaPagamentoBadge'
import type { ResumoDesfecho } from './sugestaoBoleto'

const resumo = (over: Partial<ResumoDesfecho> = {}): ResumoDesfecho => ({
  situacao: 'UNICA_SEGURA',
  avisoVenceAntes: 'NENHUM',
  total: 1,
  ...over,
})

describe('FormaPagamentoBadge', () => {
  it('BOLETO com DDA', () => {
    render(<FormaPagamentoBadge titulo={{ formaPagamentoConexos: 6, temBoleto: true }} />)
    expect(screen.getByText('boleto com DDA')).toBeInTheDocument()
  })

  it('BOLETO sem DDA — o caso que sai sem código de barras', () => {
    render(<FormaPagamentoBadge titulo={{ formaPagamentoConexos: 6, temBoleto: false }} />)
    expect(screen.getByText('boleto sem DDA')).toBeInTheDocument()
    expect(screen.getByText(/valor ou vencimento do boleto difere do título/)).toBeInTheDocument()
    expect(screen.getByText('boleto sem DDA').className).toMatch(/text-warning-foreground/)
  })

  it('outra forma com DDA associado mostra o rótulo e anuncia o DDA', () => {
    render(<FormaPagamentoBadge titulo={{ formaPagamentoConexos: 10, temBoleto: true }} />)
    expect(screen.getByText('transação automática')).toBeInTheDocument()
    expect(screen.getByText('com boleto DDA')).toBeInTheDocument()
  })

  it('sem forma no Conexos e sem DDA', () => {
    render(<FormaPagamentoBadge titulo={{}} />)
    expect(screen.getByText('sem forma no Conexos')).toBeInTheDocument()
    expect(screen.queryByText('com boleto DDA')).not.toBeInTheDocument()
  })

  it('sem forma no Conexos COM DDA: marca de DDA, não o verde de "boleto com DDA"', () => {
    render(<FormaPagamentoBadge titulo={{ temBoleto: true }} />)
    expect(screen.getByText('sem forma no Conexos')).toBeInTheDocument()
    expect(screen.getByText('com boleto DDA')).toBeInTheDocument()
    expect(screen.queryByText('boleto com DDA')).not.toBeInTheDocument()
  })

  it('boleto sem DDA com sugestão: link que abre a sugestão', () => {
    const abrir = jest.fn()
    render(
      <FormaPagamentoBadge
        titulo={{ formaPagamentoConexos: 6, temBoleto: false }}
        sugestao={resumo()}
        onAbrirSugestao={abrir}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'sugestão disponível' }))
    expect(abrir).toHaveBeenCalled()
  })

  it('confirmada: rótulo "boleto confirmado"; com DDA, nada é mostrado', () => {
    const { rerender } = render(
      <FormaPagamentoBadge
        titulo={{ formaPagamentoConexos: 6, temBoleto: false }}
        sugestao={resumo({ situacao: 'CONFIRMADA' })}
        onAbrirSugestao={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'boleto confirmado' })).toBeInTheDocument()
    rerender(
      <FormaPagamentoBadge
        titulo={{ formaPagamentoConexos: 6, temBoleto: true }}
        sugestao={resumo({ situacao: 'CONFIRMADA' })}
        onAbrirSugestao={() => undefined}
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('confirmação órfã (ERP já sinalizou o título): link "confirmação a revisar" mesmo com DDA', () => {
    const abrir = jest.fn()
    render(
      <FormaPagamentoBadge
        titulo={{ formaPagamentoConexos: 6, temBoleto: true }}
        sugestao={resumo({ situacao: 'ORFA' })}
        onAbrirSugestao={abrir}
      />,
    )
    expect(screen.getByText('boleto com DDA')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'confirmação a revisar' }))
    expect(abrir).toHaveBeenCalled()
  })

  describe('situação do título (ADR-0072)', () => {
    const boletoSemDda = { formaPagamentoConexos: 6, temBoleto: false }
    const render1 = (r: ResumoDesfecho, abrir = jest.fn()) => {
      render(<FormaPagamentoBadge titulo={boletoSemDda} sugestao={r} onAbrirSugestao={abrir} />)
      return abrir
    }

    it.each([
      ['UNICA_SEGURA', 'sugestão disponível'],
      ['SO_ATENCAO', 'ver boleto sugerido'],
      ['AMBIGUA', 'mais de um boleto possível'],
      ['SO_FRACA', 'ver candidato (sem confirmação)'],
      ['DISPUTADA', 'boleto reservado a outro título'],
      ['SO_VENCIDA', 'ver boleto vencido'],
    ] as const)('%s → botão "%s"', (situacao, rotulo) => {
      const abrir = render1(resumo({ situacao, total: 2 }))
      fireEvent.click(screen.getByRole('button', { name: rotulo }))
      expect(abrir).toHaveBeenCalled()
    })

    it('SEM_CANDIDATO não é botão: só o texto "sem boleto no pool"', () => {
      render1(resumo({ situacao: 'SEM_CANDIDATO', total: 0 }))
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.getByText('sem boleto no pool')).toBeInTheDocument()
    })

    it('fraco nunca usa "sugestão disponível" nem o verde de ação', () => {
      render1(resumo({ situacao: 'SO_FRACA' }))
      expect(screen.queryByText('sugestão disponível')).not.toBeInTheDocument()
      const link = screen.getByRole('button', { name: 'ver candidato (sem confirmação)' })
      expect(link.className).toMatch(/text-muted-foreground|text-warning-foreground/)
      expect(link.className).not.toMatch(/success/)
    })

    it('chip de aviso: ícone + texto + sr-only (a cor nunca é o único canal)', () => {
      render1(resumo({ situacao: 'SO_VENCIDA', avisoVenceAntes: 'CRITICO' }))
      expect(screen.getByText('boleto já vencido no débito')).toBeInTheDocument()
      expect(screen.getByText(/vence antes da data de débito prevista/)).toHaveClass('sr-only')
    })

    it('aviso de atenção (caso B) e sem aviso quando NENHUM', () => {
      const { unmount } = render(
        <FormaPagamentoBadge
          titulo={boletoSemDda}
          sugestao={resumo({ situacao: 'SO_ATENCAO', avisoVenceAntes: 'ATENCAO' })}
          onAbrirSugestao={() => undefined}
        />,
      )
      expect(screen.getByText('boleto vence antes do título')).toBeInTheDocument()
      unmount()
      render(
        <FormaPagamentoBadge
          titulo={boletoSemDda}
          sugestao={resumo()}
          onAbrirSugestao={() => undefined}
        />,
      )
      expect(screen.queryByText(/vence antes do título/)).not.toBeInTheDocument()
    })
  })

  describe('grupo sugerido (I21v)', () => {
    const grupo = {
      ddcCod: 165,
      ditCod: 24398,
      numeroBoleto: '129818',
      nTitulos: 2,
      valorBoletoCentavos: 2636985,
      confirmavel: true,
    }

    it('GRUPO_SUGERIDO: o rótulo e "Ver grupo" abrem a gaveta do título', () => {
      const verGrupo = jest.fn()
      const abrir = jest.fn()
      render(
        <FormaPagamentoBadge
          titulo={{ formaPagamentoConexos: 6, temBoleto: false }}
          sugestao={resumo({ situacao: 'GRUPO_SUGERIDO', total: 0, grupoSugerido: grupo })}
          onAbrirSugestao={abrir}
          onVerGrupo={verGrupo}
        />,
      )
      // I21v: o rótulo abre a gaveta (onde o grupo se confirma) e "Ver grupo" também.
      fireEvent.click(screen.getByRole('button', { name: 'em grupo sugerido' }))
      expect(abrir).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: /Ver grupo/ }))
      expect(verGrupo).toHaveBeenCalledWith(grupo)
    })

    it('1:1 forte com ponteiro: mantém o rótulo do 1:1 e ganha o "Ver grupo"', () => {
      const verGrupo = jest.fn()
      render(
        <FormaPagamentoBadge
          titulo={{ formaPagamentoConexos: 6, temBoleto: false }}
          sugestao={resumo({ situacao: 'UNICA_SEGURA', grupoSugerido: grupo })}
          onAbrirSugestao={jest.fn()}
          onVerGrupo={verGrupo}
        />,
      )
      expect(screen.getByRole('button', { name: 'sugestão disponível' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Ver grupo/ }))
      expect(verGrupo).toHaveBeenCalledWith(grupo)
    })

    it('sem o ponteiro, nenhum "Ver grupo"', () => {
      render(
        <FormaPagamentoBadge
          titulo={{ formaPagamentoConexos: 6, temBoleto: false }}
          sugestao={resumo()}
          onAbrirSugestao={jest.fn()}
          onVerGrupo={jest.fn()}
        />,
      )
      expect(screen.queryByRole('button', { name: /Ver grupo/ })).not.toBeInTheDocument()
    })
  })
})

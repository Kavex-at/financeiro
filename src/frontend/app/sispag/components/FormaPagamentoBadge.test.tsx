import { fireEvent, render, screen } from '@testing-library/react'
import { FormaPagamentoBadge } from './FormaPagamentoBadge'

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
        sugestao="DISPONIVEL"
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
        sugestao="CONFIRMADA"
        onAbrirSugestao={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: 'boleto confirmado' })).toBeInTheDocument()
    rerender(
      <FormaPagamentoBadge
        titulo={{ formaPagamentoConexos: 6, temBoleto: true }}
        sugestao="CONFIRMADA"
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
        sugestao="ORFA"
        onAbrirSugestao={abrir}
      />,
    )
    expect(screen.getByText('boleto com DDA')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'confirmação a revisar' }))
    expect(abrir).toHaveBeenCalled()
  })
})

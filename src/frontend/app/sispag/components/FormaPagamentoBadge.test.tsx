import { render, screen } from '@testing-library/react'
import { FormaPagamentoBadge } from './FormaPagamentoBadge'

describe('FormaPagamentoBadge', () => {
  it('BOLETO com DDA', () => {
    render(<FormaPagamentoBadge titulo={{ formaPagamentoConexos: 6, temBoleto: true }} />)
    expect(screen.getByText('boleto com DDA')).toBeInTheDocument()
  })

  it('BOLETO sem DDA — o caso que sai sem código de barras', () => {
    render(<FormaPagamentoBadge titulo={{ formaPagamentoConexos: 6, temBoleto: false }} />)
    expect(screen.getByText('boleto sem DDA')).toHaveAttribute(
      'title',
      expect.stringContaining('sem boleto DDA'),
    )
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
})

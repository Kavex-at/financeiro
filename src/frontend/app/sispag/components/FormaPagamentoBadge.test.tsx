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

  it('forma não lida e sem DDA → "—"', () => {
    render(<FormaPagamentoBadge titulo={{}} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

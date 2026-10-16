import { render, screen } from '@testing-library/react'
import { DiferencaBadge } from './CandidatosBoletoDialog'

describe('DiferencaBadge — aviso de vencimento antes do título (ADR-0072)', () => {
  it('Δ < 0 traz ícone, o texto e uma explicação para leitor de tela', () => {
    render(<DiferencaBadge dias={-2} />)
    expect(screen.getByText('-2 dias')).toBeInTheDocument()
    expect(screen.getByText('vence antes do título')).toBeInTheDocument()
    expect(screen.getByText(/confirme no portal do banco/)).toHaveClass('sr-only')
  })

  it('Δ ≥ 0 não tem o aviso', () => {
    const { rerender } = render(<DiferencaBadge dias={0} />)
    expect(screen.queryByText(/vence antes do título/)).not.toBeInTheDocument()
    rerender(<DiferencaBadge dias={3} />)
    expect(screen.getByText('+3 dias')).toBeInTheDocument()
    expect(screen.queryByText(/vence antes do título/)).not.toBeInTheDocument()
  })
})

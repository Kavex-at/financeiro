import { render, screen } from '@testing-library/react'
import {
  AgingBadge,
  MatchClassificacaoBadge,
  NdeStatusBadge,
  RecebimentoStatusBadge,
  TransacaoStatusBadge,
} from '@/app/recebimentos/components/status-badges'

describe('status badges (Frente IV)', () => {
  it('TransacaoStatusBadge mostra texto (nunca só cor)', () => {
    render(<TransacaoStatusBadge status="manual" />)
    expect(screen.getByText('fila manual')).toBeInTheDocument()
  })

  it('RecebimentoStatusBadge mostra o rótulo do ciclo de vida', () => {
    render(<RecebimentoStatusBadge status="executado" />)
    expect(screen.getByText('executado')).toBeInTheDocument()
  })

  it('MatchClassificacaoBadge mostra travessão quando ausente', () => {
    render(<MatchClassificacaoBadge classificacao={undefined} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('NdeStatusBadge rotula pendente', () => {
    render(<NdeStatusBadge status="pendente" />)
    expect(screen.getByText('pendente')).toBeInTheDocument()
  })

  it('AgingBadge escala por dias e mostra travessão sem valor', () => {
    const { rerender } = render(<AgingBadge dias={1} />)
    expect(screen.getByText('1d na fila')).toBeInTheDocument()
    rerender(<AgingBadge dias={undefined} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

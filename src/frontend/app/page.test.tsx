import { render, screen } from '@testing-library/react'
import HomePage from '@/app/page'

// O card de admin depende do AuthProvider (contexto + fetch). Ele não é o objeto
// deste teste; stubar mantém o foco no card da Frente IV.
jest.mock('@/components/home/AdminHomeCard', () => ({
  AdminHomeCard: () => null,
}))

/**
 * Home (`/`) — o card da Frente IV. Estes testes existem por causa de um bug de
 * produção: a frente ficava com o botão apagado ("Indisponível em produção")
 * porque a flag `NEXT_PUBLIC_RECEBIMENTOS_ENABLED` só ligava em `NEXT_PUBLIC_ENV=local`,
 * e um build da Vercel nunca é "local". A flag foi removida (ADR-0028) — aqui se
 * fixa que ela não volte.
 */
describe('HomePage — card da Gestão de Adiantamentos', () => {
  const orig = { ...process.env }
  afterEach(() => {
    process.env.NEXT_PUBLIC_ENV = orig.NEXT_PUBLIC_ENV
    process.env.NEXT_PUBLIC_RECEBIMENTOS_ENABLED = orig.NEXT_PUBLIC_RECEBIMENTOS_ENABLED
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = orig.NEXT_PUBLIC_SISPAG_ENABLED
  })

  /**
   * Reproduz um build deployado: sem flag e fora de `local`.
   *
   * O SISPAG é ligado de propósito. Ele tem o MESMO botão "Indisponível em
   * produção" e continua gated — deixá-lo desligado faria as asserções abaixo
   * passarem/falharem por causa do card errado.
   */
  const renderComoProducao = () => {
    process.env.NEXT_PUBLIC_ENV = 'production'
    delete process.env.NEXT_PUBLIC_RECEBIMENTOS_ENABLED
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    render(<HomePage />)
  }

  it('em produção o acesso é um link HABILITADO para /recebimentos', () => {
    renderComoProducao()

    const link = screen.getByRole('link', { name: /Abrir Gestão de Adiantamentos/i })
    expect(link).toHaveAttribute('href', '/recebimentos')
    // `asChild` renderiza um <a> de verdade: se virasse <button disabled>, não
    // haveria role="link" e o getByRole acima já falharia.
    expect(link).not.toHaveAttribute('aria-disabled')
  })

  it('em produção NÃO existe botão desabilitado nem selo "Indisponível"', () => {
    renderComoProducao()

    // Com o SISPAG ligado, qualquer "Indisponível" restante só poderia vir da
    // Frente IV — que é exatamente o que não pode mais existir.
    expect(screen.queryByText(/Indisponível em produção/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Indisponível$/i)).not.toBeInTheDocument()
  })

  it('o card usa o nome novo, não mais "Recebimentos"', () => {
    renderComoProducao()

    expect(screen.getByText('Gestão de Adiantamentos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Painel de Recebimentos/i })).not.toBeInTheDocument()
  })
})

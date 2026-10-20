import { render, screen } from '@testing-library/react'
import { AjusteCentavosSelo } from './AjusteCentavosSelo'

describe('AjusteCentavosSelo (ADR-0074)', () => {
  it('sem selo, nada é renderizado', () => {
    const { container } = render(<AjusteCentavosSelo selo={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['simulacao', 'em_curso', 'concluido', 'aviso'] as const)(
    'tipo %s vira região de status com o texto',
    (tipo) => {
      render(<AjusteCentavosSelo selo={{ tipo, texto: `texto ${tipo}`, retomavel: false }} />)
      const selo = screen.getByTestId(`selo-ajuste-${tipo}`)
      expect(selo).toHaveAttribute('role', 'status')
      expect(selo).toHaveTextContent(`texto ${tipo}`)
    },
  )
})

import { render, screen } from '@testing-library/react'
import { Avatar, iniciais } from '@/components/ui/avatar'

describe('Avatar', () => {
  it.each([
    ['ana.souza', 'AS'],
    ['admin', 'AD'],
    ['maria@columbiabr.com', 'MA'],
    ['joao_pedro-silva', 'JP'],
    ['x', 'X'],
  ])('iniciais de %s → %s', (username, esperado) => {
    expect(iniciais(username)).toBe(esperado)
  })

  it('mostra as iniciais e tem aria-label com o username', () => {
    render(<Avatar username="ana.souza" />)
    const avatar = screen.getByLabelText('ana.souza')
    expect(avatar).toHaveTextContent('AS')
  })
})

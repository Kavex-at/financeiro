import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const Menu = ({ onSelect = () => undefined }: { onSelect?: () => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger>Abrir</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuLabel>Conta</DropdownMenuLabel>
      <DropdownMenuItem onSelect={onSelect}>Item um</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem>Item dois</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
)

describe('DropdownMenu', () => {
  it('fechado não mostra itens; clique abre com role=menu e itens role=menuitem', async () => {
    const user = userEvent.setup()
    render(<Menu />)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
    expect(screen.getByRole('separator')).toBeInTheDocument()
  })

  it('abre pelo teclado (Enter) e seleciona um item', async () => {
    const user = userEvent.setup()
    const onSelect = jest.fn()
    render(<Menu onSelect={onSelect} />)
    screen.getByRole('button', { name: 'Abrir' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Item um' }))
    expect(onSelect).toHaveBeenCalled()
  })

  it('itens têm foco visível (classe de focus do DS)', async () => {
    const user = userEvent.setup()
    render(<Menu />)
    await user.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(screen.getByRole('menuitem', { name: 'Item um' }).className).toMatch(/focus:bg-accent/)
  })
})

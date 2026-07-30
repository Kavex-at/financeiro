import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'

const options: ComboboxOption[] = [
  { value: '676', label: 'BELLIZ INDUSTRIA, COMERCIO', hint: '24 processos' },
  { value: '5', label: 'COLUMBIA TRADING S/A', hint: '21 processos' },
  { value: '480', label: '2S INOVACOES TECNOLOGICAS', hint: '18 processos' },
]

/** Wrapper controlado — o Combobox é stateless quanto ao valor. */
function Harness({ onChange }: { onChange?: (v: string | null) => void }) {
  const [value, setValue] = React.useState<string | null>(null)
  return (
    <Combobox
      options={options}
      value={value}
      onChange={(v) => {
        setValue(v)
        onChange?.(v)
      }}
      aria-label="Cliente"
      placeholder="Escolha o cliente…"
    />
  )
}

describe('Combobox', () => {
  it('mostra o placeholder e abre a listbox', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const trigger = screen.getByLabelText('Cliente')
    expect(trigger).toHaveTextContent('Escolha o cliente…')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('filtra por texto digitado', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByLabelText('Cliente'))
    await user.type(await screen.findByLabelText('Buscar opções'), 'columbia')

    expect(screen.getByText('COLUMBIA TRADING S/A')).toBeInTheDocument()
    expect(screen.queryByText('BELLIZ INDUSTRIA, COMERCIO')).not.toBeInTheDocument()
  })

  it('seleciona e reflete no gatilho', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByLabelText('Cliente'))
    await user.click(await screen.findByText('COLUMBIA TRADING S/A'))

    expect(onChange).toHaveBeenCalledWith('5')
    expect(screen.getByLabelText('Cliente')).toHaveTextContent('COLUMBIA TRADING S/A')
  })

  it('exibe o hint ao lado do rótulo', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByLabelText('Cliente'))
    expect(await screen.findByText('24 processos')).toBeInTheDocument()
  })

  it('mostra a mensagem de vazio quando a busca não acha nada', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByLabelText('Cliente'))
    await user.type(await screen.findByLabelText('Buscar opções'), 'zzzzz')
    expect(screen.getByText('Nada encontrado.')).toBeInTheDocument()
  })

  it('escolhe com Enter após navegar com as setas', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()
    render(<Harness onChange={onChange} />)

    await user.click(screen.getByLabelText('Cliente'))
    const busca = await screen.findByLabelText('Buscar opções')
    await user.type(busca, '{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('5')
  })

  it('limpa a busca ao fechar — reabrir não mostra lista podada sem explicação', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByLabelText('Cliente'))
    await user.type(await screen.findByLabelText('Buscar opções'), 'columbia')
    await user.click(await screen.findByText('COLUMBIA TRADING S/A'))

    await user.click(screen.getByLabelText('Cliente'))
    expect(await screen.findByText('BELLIZ INDUSTRIA, COMERCIO')).toBeInTheDocument()
  })

  it('respeita disabled', () => {
    render(
      <Combobox options={options} value={null} onChange={jest.fn()} disabled aria-label="Cliente" />,
    )
    expect(screen.getByLabelText('Cliente')).toBeDisabled()
  })
})

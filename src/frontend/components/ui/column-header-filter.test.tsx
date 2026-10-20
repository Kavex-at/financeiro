import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Table, TableHeader, TableRow } from '@/components/ui/table'
import {
  ColumnHeaderFilter,
  FiltroFaixaNumerica,
  FiltroMultipla,
  FiltroPeriodo,
  FiltroTexto,
} from './column-header-filter'

function Cabecalho(props: Partial<React.ComponentProps<typeof ColumnHeaderFilter>> = {}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <ColumnHeaderFilter
            label="Valor"
            direcao={null}
            onOrdenar={jest.fn()}
            ativo={false}
            onLimpar={jest.fn()}
            {...props}
          >
            <p>conteúdo do filtro</p>
          </ColumnHeaderFilter>
        </TableRow>
      </TableHeader>
    </Table>
  )
}

describe('ColumnHeaderFilter', () => {
  it('expõe a ordenação em aria-sort', () => {
    const { rerender } = render(<Cabecalho direcao={null} />)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
    rerender(<Cabecalho direcao={1} />)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
    rerender(<Cabecalho direcao={-1} />)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
  })

  it('clicar no nome ordena crescente; já crescente, inverte', async () => {
    const onOrdenar = jest.fn()
    const { rerender } = render(<Cabecalho onOrdenar={onOrdenar} direcao={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Valor' }))
    expect(onOrdenar).toHaveBeenLastCalledWith(1)
    rerender(<Cabecalho onOrdenar={onOrdenar} direcao={1} />)
    await userEvent.click(screen.getByRole('button', { name: 'Ordenar por Valor' }))
    expect(onOrdenar).toHaveBeenLastCalledWith(-1)
  })

  it('o funil marca aria-pressed quando há filtro e abre o popover com o filtro e as ordens', async () => {
    render(<Cabecalho ativo rotulosOrdem={['Menor primeiro', 'Maior primeiro']} resumo="3 resultado(s)" />)
    const funil = screen.getByRole('button', { name: 'Filtrar Valor' })
    expect(funil).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(funil)
    expect(await screen.findByText('conteúdo do filtro')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Menor primeiro/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Maior primeiro/ })).toBeInTheDocument()
    expect(screen.getByText('3 resultado(s)')).toBeInTheDocument()
  })

  it('"Limpar filtro" só vale com filtro ativo', async () => {
    const onLimpar = jest.fn()
    const { rerender } = render(<Cabecalho ativo={false} onLimpar={onLimpar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar Valor' }))
    expect(await screen.findByRole('button', { name: 'Limpar filtro' })).toBeDisabled()
    rerender(<Cabecalho ativo onLimpar={onLimpar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }))
    expect(onLimpar).toHaveBeenCalledTimes(1)
  })

  it('a ordem dentro do popover pede a direção escolhida', async () => {
    const onOrdenar = jest.fn()
    render(<Cabecalho onOrdenar={onOrdenar} rotulosOrdem={['Menor primeiro', 'Maior primeiro']} />)
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar Valor' }))
    await userEvent.click(await screen.findByRole('button', { name: /Maior primeiro/ }))
    expect(onOrdenar).toHaveBeenCalledWith(-1)
  })
})

describe('conteúdos de filtro', () => {
  it('FiltroTexto devolve o que se digita', async () => {
    const onChange = jest.fn()
    render(<FiltroTexto label="Credor" valor="" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Filtrar Credor por texto'), 'a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('FiltroFaixaNumerica separa mínimo e máximo', async () => {
    const onChange = jest.fn()
    render(<FiltroFaixaNumerica label="Valor" min="" max="50" onChange={onChange} />)
    await userEvent.type(screen.getByLabelText('Valor: valor mínimo'), '1')
    expect(onChange).toHaveBeenCalledWith({ min: '1', max: '50' })
  })

  it('FiltroPeriodo limita um lado pelo outro', () => {
    render(<FiltroPeriodo label="Vencimento" de="2026-10-01" ate="2026-10-31" onChange={jest.fn()} />)
    expect(screen.getByLabelText('Vencimento: de')).toHaveAttribute('max', '2026-10-31')
    expect(screen.getByLabelText('Vencimento: até')).toHaveAttribute('min', '2026-10-01')
  })

  it('FiltroMultipla marca, desmarca e mostra a contagem', async () => {
    const onChange = jest.fn()
    const opcoes = [
      { valor: 1, rotulo: 'Filial 1', total: 4 },
      { valor: 7, rotulo: 'Filial 7', total: 2 },
    ]
    const { rerender } = render(
      <FiltroMultipla label="Filial" opcoes={opcoes} selecionadas={[]} onChange={onChange} />,
    )
    expect(screen.getByText('4')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Filial 7/ }))
    expect(onChange).toHaveBeenLastCalledWith([7])
    rerender(<FiltroMultipla label="Filial" opcoes={opcoes} selecionadas={[7]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Filial 7/ }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('FiltroMultipla sem opções diz que não há', () => {
    render(<FiltroMultipla label="Filial" opcoes={[]} selecionadas={[]} onChange={jest.fn()} />)
    expect(screen.getByText(/Nenhuma opção/)).toBeInTheDocument()
  })
})

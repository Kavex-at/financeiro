import { act, render, renderHook, screen } from '@testing-library/react'
import { FiltroBarra, useTabelaFiltro } from './tabela-filtro'

interface Linha {
  id: string
  fil?: number
  datas: (string | undefined)[]
  boletos: boolean[]
}

const linhas: Linha[] = [
  { id: 'a', fil: 1, datas: ['2026-10-01'], boletos: [true] },
  { id: 'b', fil: 1, datas: ['2026-10-10'], boletos: [false] },
  { id: 'c', fil: 2, datas: ['2026-10-05', '2026-11-20'], boletos: [true, false] },
  { id: 'd', fil: 2, datas: [undefined], boletos: [] },
]

const ids = (xs: Linha[]) => xs.map((x) => x.id)

// Estável, como o hook pede (os acessores entram nas deps do memo).
const EXTRAS = { getDatas: (x: Linha) => x.datas, getBoleto: (x: Linha) => x.boletos }

const comExtras = () =>
  renderHook(() => useTabelaFiltro(linhas, (x) => x.fil, (x) => x.id, 20, EXTRAS))

describe('useTabelaFiltro — sem extras (Permutas)', () => {
  it('mantém filial + busca + paginação e não expõe data/boleto', () => {
    const { result } = renderHook(() =>
      useTabelaFiltro(linhas, (x) => x.fil, (x) => x.id, 2),
    )
    expect(result.current.total).toBe(4)
    expect(result.current.totalPaginas).toBe(2)
    expect(result.current.setDataDe).toBeUndefined()
    expect(result.current.setBoleto).toBeUndefined()
    act(() => result.current.setFilial('2'))
    expect(ids(result.current.slice)).toEqual(['c', 'd'])
  })
})

describe('useTabelaFiltro — intervalo de datas', () => {
  it('passa quando QUALQUER data cai no intervalo (inclusivo)', () => {
    const { result } = comExtras()
    act(() => {
      result.current.setDataDe?.('2026-10-05')
      result.current.setDataAte?.('2026-10-10')
    })
    expect(ids(result.current.slice)).toEqual(['b', 'c'])
  })

  it('aceita só o início ou só o fim', () => {
    const { result } = comExtras()
    act(() => result.current.setDataDe?.('2026-10-06'))
    expect(ids(result.current.slice)).toEqual(['b', 'c'])
    act(() => {
      result.current.setDataDe?.('')
      result.current.setDataAte?.('2026-10-01')
    })
    expect(ids(result.current.slice)).toEqual(['a'])
  })

  it('tira o item sem data quando há intervalo ativo', () => {
    const { result } = comExtras()
    expect(ids(result.current.slice)).toContain('d')
    act(() => result.current.setDataAte?.('2099-12-31'))
    expect(ids(result.current.slice)).not.toContain('d')
  })

  it('trocar a data volta à página 1', () => {
    const { result } = renderHook(() =>
      useTabelaFiltro(linhas, (x) => x.fil, (x) => x.id, 1, { getDatas: (x) => x.datas }),
    )
    act(() => result.current.setPagina(3))
    expect(result.current.paginaAtual).toBe(3)
    act(() => result.current.setDataDe?.('2026-10-01'))
    expect(result.current.paginaAtual).toBe(1)
  })
})

describe('useTabelaFiltro — boleto', () => {
  it('"com" = algum item com boleto; "sem" = algum item sem boleto (misto nos dois)', () => {
    const { result } = comExtras()
    act(() => result.current.setBoleto?.('com'))
    expect(ids(result.current.slice)).toEqual(['a', 'c'])
    act(() => result.current.setBoleto?.('sem'))
    expect(ids(result.current.slice)).toEqual(['b', 'c'])
  })

  it('conta por chip depois dos outros filtros e antes do de boleto', () => {
    const { result } = comExtras()
    act(() => {
      result.current.setFilial('1')
      result.current.setBoleto?.('com')
    })
    expect(result.current.contagemBoleto).toEqual({ todos: 2, com: 1, sem: 1 })
  })

  it('limparFiltros zera filial, busca, datas e boleto', () => {
    const { result } = comExtras()
    act(() => {
      result.current.setFilial('1')
      result.current.setBusca('a')
      result.current.setDataDe?.('2026-10-01')
      result.current.setBoleto?.('sem')
    })
    expect(result.current.total).toBe(0)
    act(() => result.current.limparFiltros())
    expect(result.current.total).toBe(4)
    expect(result.current.dataDe).toBe('')
    expect(result.current.boleto).toBe('todos')
  })
})

describe('FiltroBarra', () => {
  it('sem as props opt-in não mostra data nem boleto', () => {
    const { result } = comExtras()
    render(<FiltroBarra aba={result.current} buscaPlaceholder="Buscar" />)
    expect(screen.queryByText(/de\/até/)).toBeNull()
    expect(screen.queryByRole('group', { name: 'Boleto' })).toBeNull()
  })

  it('com rotuloData e filtroBoleto mostra o rótulo contextual e os chips', () => {
    const { result } = comExtras()
    render(
      <FiltroBarra
        aba={result.current}
        buscaPlaceholder="Buscar"
        rotuloData="Vencimento"
        filtroBoleto
      />,
    )
    expect(screen.getByText('Vencimento de/até')).toBeInTheDocument()
    expect(screen.getByLabelText('Vencimento de')).toBeInTheDocument()
    expect(screen.getByLabelText('Vencimento até')).toBeInTheDocument()
    const grupo = screen.getByRole('group', { name: 'Boleto' })
    expect(grupo).toHaveTextContent('Todos (4)')
    expect(grupo).toHaveTextContent('Boleto (2)')
    expect(grupo).toHaveTextContent('Sem boleto (2)')
  })
})

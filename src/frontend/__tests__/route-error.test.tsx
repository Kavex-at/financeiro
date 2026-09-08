/**
 * `app/error.tsx` — o boundary de rota do App Router.
 *
 * O que importa aqui não é o texto: é que a tela de erro **oferece saída**. Antes da moldura, uma
 * página quebrada deixava o usuário com o botão voltar do navegador e nada mais; um boundary que
 * só diz "algo deu errado" reproduz o mesmo beco sem saída.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import RouteError from '@/app/error'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

describe('app/error.tsx', () => {
  let consoleError: jest.SpyInstance

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('anuncia a falha como alert para leitor de tela', () => {
    render(<RouteError error={new Error('falhou')} reset={jest.fn()} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('"Tentar de novo" chama o reset do App Router', () => {
    const reset = jest.fn()
    render(<RouteError error={new Error('falhou')} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: /tentar de novo/i }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('oferece saída para a home — a tela quebrada não pode ser um beco sem saída', () => {
    render(<RouteError error={new Error('falhou')} reset={jest.fn()} />)

    expect(screen.getByRole('link', { name: /voltar ao início/i })).toHaveAttribute('href', '/')
  })

  it('mostra o digest quando existe — é o fio até o stack real no log do servidor', () => {
    const error = Object.assign(new Error('falhou'), { digest: 'abc123' })
    render(<RouteError error={error} reset={jest.fn()} />)

    expect(screen.getByText(/abc123/)).toBeInTheDocument()
  })

  it('omite a linha de suporte quando não há digest, em vez de mostrar rótulo vazio', () => {
    render(<RouteError error={new Error('falhou')} reset={jest.fn()} />)

    expect(screen.queryByText(/código para o suporte/i)).not.toBeInTheDocument()
  })

  it('loga o erro — um boundary mudo esconde o defeito do dev também', () => {
    const error = new Error('resposta incompleta do ERP')
    render(<RouteError error={error} reset={jest.fn()} />)

    expect(consoleError).toHaveBeenCalledWith('[app/error] falha de render na rota:', error)
  })
})

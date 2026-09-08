/**
 * `app/global-error.tsx` — a rede de segurança de baixo de tudo.
 *
 * Só entra em cena quando o **layout raiz** falha, ou seja, quando a própria moldura quebrou. Por
 * isso não pode depender de nada que o layout traga: nem do `globals.css`, nem de componente do
 * design system. O que estes testes travam é essa autossuficiência.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import GlobalError from '@/app/global-error'

describe('app/global-error.tsx', () => {
  let consoleError: jest.SpyInstance

  beforeEach(() => {
    // `<html>`/`<body>` dentro do container do RTL produz aviso de aninhamento do React. É
    // esperado: em produção este componente SUBSTITUI o documento, não é montado dentro dele.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('anuncia a falha como alert para leitor de tela', () => {
    render(<GlobalError error={new Error('layout falhou')} reset={jest.fn()} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('"Tentar de novo" chama o reset', () => {
    const reset = jest.fn()
    render(<GlobalError error={new Error('layout falhou')} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: /tentar de novo/i }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('mostra o digest quando existe, e o omite quando não', () => {
    const { unmount } = render(
      <GlobalError
        error={Object.assign(new Error('x'), { digest: 'deadbeef' })}
        reset={jest.fn()}
      />,
    )
    expect(screen.getByText(/deadbeef/)).toBeInTheDocument()
    unmount()

    render(<GlobalError error={new Error('x')} reset={jest.fn()} />)
    expect(screen.queryByText(/código para o suporte/i)).not.toBeInTheDocument()
  })

  it('não importa nada do design system — precisa funcionar sem o layout', () => {
    // O teste é sobre os IMPORTS do arquivo, não sobre o render: um `import` de `@/components/ui/*`
    // traria de volta a dependência do `globals.css` que este componente existe para não ter.
    // (Só as linhas de import — a prosa do docstring cita ambos de propósito.)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fonte: string = require('node:fs').readFileSync('app/global-error.tsx', 'utf-8')
    const imports = fonte.split('\n').filter((linha) => linha.startsWith('import '))

    expect(imports).not.toHaveLength(0)
    expect(imports.filter((linha) => linha.includes('@/components/'))).toEqual([])
    expect(imports.filter((linha) => linha.includes('.css'))).toEqual([])
  })

  it('loga a falha do layout raiz', () => {
    const error = new Error('layout falhou')
    render(<GlobalError error={error} reset={jest.fn()} />)

    expect(consoleError).toHaveBeenCalledWith(
      '[app/global-error] falha de render no layout raiz:',
      error,
    )
  })
})

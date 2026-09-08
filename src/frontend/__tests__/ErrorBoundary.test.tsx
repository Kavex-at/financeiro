/**
 * `ErrorBoundary` — a contenção que a moldura passou a exigir.
 *
 * O que estes testes travam é a propriedade que motivou o componente: quando a navegação quebra, a
 * **página continua na tela**. Antes da moldura o `AppShell` tinha 47 linhas sem lógica e o raio de
 * alcance de um defeito ali era ~0%; depois, é 100% das rotas autenticadas.
 */
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/** Componente que estoura no render — a única forma de acionar um boundary de verdade. */
const Explode = ({ mensagem = 'boom' }: { mensagem?: string }) => {
  throw new Error(mensagem)
}

describe('ErrorBoundary', () => {
  let consoleError: jest.SpyInstance

  beforeEach(() => {
    // O React loga o erro por conta própria além do nosso `componentDidCatch`; sem o silêncio o
    // output do teste vira um stack trace que parece falha.
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleError.mockRestore()
  })

  it('renderiza os filhos normalmente quando nada falha', () => {
    render(
      <ErrorBoundary boundaryName="Teste">
        <p>conteúdo intacto</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('conteúdo intacto')).toBeInTheDocument()
  })

  it('some com a subárvore quebrada em vez de propagar o throw', () => {
    expect(() =>
      render(
        <ErrorBoundary boundaryName="Teste">
          <Explode />
        </ErrorBoundary>,
      ),
    ).not.toThrow()
  })

  it('renderiza o fallback quando ele é fornecido', () => {
    render(
      <ErrorBoundary boundaryName="Teste" fallback={<p>moldura sem navegação</p>}>
        <Explode />
      </ErrorBoundary>,
    )

    expect(screen.getByText('moldura sem navegação')).toBeInTheDocument()
  })

  it('preserva o que está FORA da fronteira — é o ponto do componente', () => {
    render(
      <div>
        <p>o conteúdo da página</p>
        <ErrorBoundary boundaryName="AppNavigation">
          <Explode />
        </ErrorBoundary>
      </div>,
    )

    expect(screen.getByText('o conteúdo da página')).toBeInTheDocument()
  })

  it('loga com o nome da fronteira — "algo quebrou" não localiza nada', () => {
    render(
      <ErrorBoundary boundaryName="AppNavigation">
        <Explode mensagem="useAppNavGroups falhou" />
      </ErrorBoundary>,
    )

    const nossoLog = consoleError.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('[ErrorBoundary:AppNavigation]'),
    )

    expect(nossoLog).toBeDefined()
    expect((nossoLog?.[1] as Error).message).toBe('useAppNavGroups falhou')
  })
})

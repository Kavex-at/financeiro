/**
 * Guard de página (ADR-0053): sem a permissão, a página mostra SÓ "Você não tem acesso a esta área."
 * com link para a home — sem redirecionar e sem disparar as chamadas de dados da página.
 */
import { render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { AcessoNegado } from '@/components/auth/AcessoNegado'
import { ExigePermissao } from '@/components/auth/ExigePermissao'
import type { Permissao } from '@/lib/permissoes'

const permissoesMock = jest.fn<{ carregando: boolean; tem: (p: Permissao) => boolean }, []>()
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => permissoesMock(),
}))

const replaceMock = jest.fn()
const pushMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}))

/** Simula uma página que busca dados ao montar. */
const carregarDados = jest.fn()
function PaginaComDados() {
  useEffect(() => {
    carregarDados()
  }, [])
  return <h1>Conteúdo da página</h1>
}

const renderGuard = () =>
  render(
    <ExigePermissao permissao="sispag:ver">
      <PaginaComDados />
    </ExigePermissao>,
  )

describe('ExigePermissao', () => {
  beforeEach(() => {
    permissoesMock.mockReset()
    carregarDados.mockReset()
    replaceMock.mockReset()
    pushMock.mockReset()
  })

  it('sem a permissão: só o estado vazio, com link para a home, sem redirecionar nem buscar dados', () => {
    permissoesMock.mockReturnValue({ carregando: false, tem: () => false })
    renderGuard()

    expect(screen.getByText('Você não tem acesso a esta área.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar para o início/i })).toHaveAttribute('href', '/')
    expect(screen.queryByText('Conteúdo da página')).not.toBeInTheDocument()
    expect(carregarDados).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('com a permissão: a página renderiza como hoje', () => {
    permissoesMock.mockReturnValue({ carregando: false, tem: (p) => p === 'sispag:ver' })
    renderGuard()

    expect(screen.getByText('Conteúdo da página')).toBeInTheDocument()
    expect(carregarDados).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Você não tem acesso a esta área.')).not.toBeInTheDocument()
  })

  it('enquanto carrega: o carregamento padrão, nunca o "sem acesso" (sem pisca), e sem buscar dados', () => {
    permissoesMock.mockReturnValue({ carregando: true, tem: () => false })
    renderGuard()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('Você não tem acesso a esta área.')).not.toBeInTheDocument()
    expect(carregarDados).not.toHaveBeenCalled()
  })
})

describe('AcessoNegado', () => {
  it('texto em português, ícone decorativo escondido do leitor de tela, tokens semânticos', () => {
    const { container } = render(<AcessoNegado />)
    expect(screen.getByRole('heading', { name: 'Você não tem acesso a esta área.' })).toBeInTheDocument()
    const icone = container.querySelector('svg')
    expect(icone).toHaveAttribute('aria-hidden', 'true')
    // Sem cor crua (hex, rgb ou paleta fixa do Tailwind): só tokens semânticos.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(|(slate|gray|zinc|red|blue)-\d{2,3}/i)
  })
})

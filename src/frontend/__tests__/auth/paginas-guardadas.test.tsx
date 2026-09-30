/**
 * Cada página de módulo exige o `:ver` do módulo (ADR-0053, Task 14). Sem ele: só o estado vazio
 * "Você não tem acesso a esta área.", sem redirecionar e sem nenhuma chamada de dados.
 */
import { render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { Permissao } from '@/lib/permissoes'

const permissoesMock = jest.fn<{ carregando: boolean; tem: (p: Permissao) => boolean }, []>()
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => permissoesMock(),
}))

jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ username: 'maria@columbiabr.com', token: 't', devBypass: false }),
}))

const replaceMock = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn(), refresh: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

const PAGINAS: Array<[string, Permissao, () => Promise<{ default: ComponentType }>]> = [
  ['/permutas', 'permutas:ver', () => import('@/app/permutas/page')],
  ['/permutas/borderos', 'permutas:ver', () => import('@/app/permutas/borderos/page')],
  ['/permutas/clientes-filtro', 'permutas:ver', () => import('@/app/permutas/clientes-filtro/page')],
  ['/sispag', 'sispag:ver', () => import('@/app/sispag/page')],
  ['/recebimentos', 'recebimentos:ver', () => import('@/app/recebimentos/page')],
  ['/metricas', 'metricas:ver', () => import('@/app/metricas/page')],
  ['/usuarios', 'usuarios:gerenciar', () => import('@/app/usuarios/page')],
]

describe('guard de página por permissão', () => {
  const fetchMock = jest.fn()
  const envOriginal = process.env.NEXT_PUBLIC_SISPAG_ENABLED

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    global.fetch = fetchMock as unknown as typeof fetch
    replaceMock.mockReset()
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = envOriginal
  })

  it.each(PAGINAS)('%s sem %s: só "sem acesso", sem fetch nem redirecionamento', async (_rota, exigida, carregar) => {
    permissoesMock.mockReturnValue({ carregando: false, tem: (p) => p !== exigida })
    const { default: Pagina } = await carregar()
    render(<Pagina />)

    expect(screen.getByText('Você não tem acesso a esta área.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Voltar para o início/i })).toHaveAttribute('href', '/')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it.each(PAGINAS)('%s enquanto as permissões carregam: carregamento, nunca "sem acesso"', async (_rota, _exigida, carregar) => {
    permissoesMock.mockReturnValue({ carregando: true, tem: () => false })
    const { default: Pagina } = await carregar()
    render(<Pagina />)

    expect(screen.queryByText('Você não tem acesso a esta área.')).not.toBeInTheDocument()
    expect(screen.getByTestId('permissoes-carregando')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('SISPAG desligado por flag: continua mostrando "SISPAG indisponível" antes do guard', async () => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'false'
    permissoesMock.mockReturnValue({ carregando: false, tem: () => false })
    const { default: Pagina } = await import('@/app/sispag/page')
    render(<Pagina />)

    expect(screen.getByText('SISPAG indisponível')).toBeInTheDocument()
    expect(screen.queryByText('Você não tem acesso a esta área.')).not.toBeInTheDocument()
  })
})

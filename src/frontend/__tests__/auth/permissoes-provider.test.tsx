/**
 * `usePermissoes` (ADR-0053) — a fonte única do front para esconder nav, cards, páginas e botões.
 * Substitui o antigo hook de admin por papel. Esconder é ergonomia; o gate real é o servidor (I2).
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { PermissoesProvider, usePermissoes } from '@/lib/auth/PermissoesProvider'
import { CATALOGO_PERMISSOES, type MinhasPermissoes, type Permissao } from '@/lib/permissoes'

const authMock = jest.fn<{ token: string | null; devBypass: boolean }, []>()
const roleMock = jest.fn<string | null, []>()
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => authMock(),
  useRole: () => roleMock(),
}))

const fetchMock = jest.fn<Promise<MinhasPermissoes>, []>()
jest.mock('@/lib/permissoes', () => {
  const real = jest.requireActual('@/lib/permissoes')
  return { ...real, fetchMinhasPermissoes: () => fetchMock() }
})

function Probe() {
  const { carregando, tem } = usePermissoes()
  const lista = CATALOGO_PERMISSOES.filter((p) => tem(p))
  return (
    <div>
      <span data-testid="carregando">{String(carregando)}</span>
      <span data-testid="permissoes">{lista.join(',')}</span>
    </div>
  )
}

const renderProvider = () =>
  render(
    <PermissoesProvider>
      <Probe />
    </PermissoesProvider>,
  )

const resposta = (permissoes: Permissao[]): MinhasPermissoes => ({
  permissoes: new Set(permissoes),
  papel: { id: 2, nome: 'Consulta' },
  legado: false,
})

describe('PermissoesProvider / usePermissoes', () => {
  beforeEach(() => {
    authMock.mockReset().mockReturnValue({ token: 'tok-1', devBypass: false })
    roleMock.mockReset().mockReturnValue('admin')
    fetchMock.mockReset()
  })

  it('busca /me/permissoes e expõe tem(p) com o que o servidor devolveu', async () => {
    fetchMock.mockResolvedValue(resposta(['permutas:ver', 'metricas:ver']))
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('permissoes')).toHaveTextContent('permutas:ver,metricas:ver'),
    )
    expect(screen.getByTestId('carregando')).toHaveTextContent('false')
  })

  it('enquanto a resposta não chega: carregando = true e tem() = false (nada pisca)', async () => {
    let resolver: (v: MinhasPermissoes) => void = () => undefined
    fetchMock.mockReturnValue(new Promise((r) => (resolver = r)))
    renderProvider()
    expect(screen.getByTestId('carregando')).toHaveTextContent('true')
    expect(screen.getByTestId('permissoes')).toHaveTextContent('')

    await act(async () => resolver(resposta(['sispag:ver'])))
    expect(screen.getByTestId('carregando')).toHaveTextContent('false')
    expect(screen.getByTestId('permissoes')).toHaveTextContent('sispag:ver')
  })

  it('busca UMA vez por sessão: re-renderizar (navegar) não refaz a consulta', async () => {
    fetchMock.mockResolvedValue(resposta(['sispag:ver']))
    const { rerender } = renderProvider()
    await waitFor(() => expect(screen.getByTestId('carregando')).toHaveTextContent('false'))
    rerender(
      <PermissoesProvider>
        <Probe />
      </PermissoesProvider>,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refaz a consulta quando o token muda (login / troca de usuário)', async () => {
    fetchMock.mockResolvedValueOnce(resposta(['sispag:ver']))
    const { rerender } = renderProvider()
    await waitFor(() => expect(screen.getByTestId('permissoes')).toHaveTextContent('sispag:ver'))

    authMock.mockReturnValue({ token: 'tok-2', devBypass: false })
    fetchMock.mockResolvedValueOnce(resposta(['permutas:ver']))
    rerender(
      <PermissoesProvider>
        <Probe />
      </PermissoesProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('permissoes')).toHaveTextContent('permutas:ver'))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('erro: conjunto vazio (fail-closed), sem quebrar a tela', async () => {
    fetchMock.mockRejectedValue(new Error('HTTP 503'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('carregando')).toHaveTextContent('false'))
    expect(screen.getByTestId('permissoes')).toHaveTextContent('')
  })

  it('DEV_AUTH_BYPASS (D1): catálogo inteiro, sem consultar o backend', () => {
    authMock.mockReturnValue({ token: null, devBypass: true })
    renderProvider()
    expect(screen.getByTestId('permissoes')).toHaveTextContent(CATALOGO_PERMISSOES.join(','))
    expect(screen.getByTestId('carregando')).toHaveTextContent('false')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sem token: nada, e sem consulta', () => {
    authMock.mockReturnValue({ token: null, devBypass: false })
    renderProvider()
    expect(screen.getByTestId('permissoes')).toHaveTextContent('')
    expect(screen.getByTestId('carregando')).toHaveTextContent('false')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('D4 — backend antigo (resposta só com { operacao })', () => {
    it('role admin: catálogo inteiro, com operacao:ver conforme a chave', async () => {
      fetchMock.mockResolvedValue({ permissoes: new Set(), legado: true, operacaoLegado: false })
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('carregando')).toHaveTextContent('false'))
      const texto = screen.getByTestId('permissoes').textContent ?? ''
      expect(texto).toContain('usuarios:gerenciar')
      expect(texto).toContain('sispag:executar')
      expect(texto).not.toContain('operacao:ver')
    })

    it('role admin + operacao: true: inclui operacao:ver', async () => {
      fetchMock.mockResolvedValue({ permissoes: new Set(), legado: true, operacaoLegado: true })
      renderProvider()
      await waitFor(() =>
        expect(screen.getByTestId('permissoes')).toHaveTextContent(CATALOGO_PERMISSOES.join(',')),
      )
    })

    it('role não-admin: só operacao:ver se a chave vier true', async () => {
      roleMock.mockReturnValue('operador')
      fetchMock.mockResolvedValue({ permissoes: new Set(), legado: true, operacaoLegado: true })
      renderProvider()
      await waitFor(() => expect(screen.getByTestId('permissoes')).toHaveTextContent('operacao:ver'))
      expect(screen.getByTestId('permissoes').textContent).toBe('operacao:ver')
    })
  })

  it('fora do provider: erro explícito (o provider mora no layout raiz)', () => {
    const erro = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow(/PermissoesProvider/)
    erro.mockRestore()
  })
})

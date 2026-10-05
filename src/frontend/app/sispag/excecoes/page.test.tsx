/**
 * Página de exceções de destino (ADR-0060): guard por `sispag:excecao`, flag desligada só
 * explica, filtro por estado e o bloqueio de "Aprovar" para quem cadastrou.
 */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { ExcecaoDestinoResumo } from '@/lib/sispag'

let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({
    carregando: false,
    falhou: false,
    recarregar: jest.fn(),
    tem: (p: Permissao) => permissoes.includes(p),
  }),
}))
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ username: 'ana' }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, getRecursos: jest.fn(), listarExcecoes: jest.fn() }
})

import { getRecursos, listarExcecoes } from '@/lib/sispag'
import ExcecoesDestinoPage from './page'

const exc = (over: Partial<ExcecaoDestinoResumo> = {}): ExcecaoDestinoResumo => ({
  id: 'E1',
  pesCod: '7001',
  filCod: 1,
  tipo: 'CONTA',
  destinoMascarado: 'banco 237 · ag. 1234 · cc ****7766-1',
  titularDocumentoMascarado: '***.444.777-**',
  estado: 'PENDENTE',
  origem: 'MANUAL',
  justificativa: 'j',
  cadastradoPor: 'ana',
  cadastradoEm: '2026-10-05T12:00:00.000Z',
  versao: 1,
  ...over,
})

const ligado = { tedEnabled: true, excecaoDestinoEnabled: true, pixEnabled: true }

beforeEach(() => {
  jest.clearAllMocks()
  permissoes = [...CATALOGO_PERMISSOES]
  ;(getRecursos as jest.Mock).mockResolvedValue(ligado)
  ;(listarExcecoes as jest.Mock).mockResolvedValue([exc()])
})

describe('/sispag/excecoes', () => {
  it('sem sispag:excecao: acesso negado e nada é buscado', async () => {
    permissoes = ['sispag:ver']
    render(<ExcecoesDestinoPage />)
    expect(await screen.findByText(/não tem acesso/i)).toBeInTheDocument()
    expect(listarExcecoes).not.toHaveBeenCalled()
  })

  it('flag desligada: só explica, sem lista nem botão de cadastro', async () => {
    ;(getRecursos as jest.Mock).mockResolvedValue({ ...ligado, excecaoDestinoEnabled: false })
    render(<ExcecoesDestinoPage />)
    expect(await screen.findByText('Exceção de destino não habilitada')).toBeInTheDocument()
    expect(listarExcecoes).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /cadastrar exceção/i })).not.toBeInTheDocument()
  })

  it('abre filtrada em PENDENTE e lista só máscaras', async () => {
    render(<ExcecoesDestinoPage />)
    expect(await screen.findByText('banco 237 · ag. 1234 · cc ****7766-1')).toBeInTheDocument()
    expect(listarExcecoes).toHaveBeenCalledWith({ estado: 'PENDENTE' })
    expect(screen.getByRole('button', { name: 'Pendente' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('trocar o filtro refaz a busca com o estado (e "Todas" sem estado)', async () => {
    const user = userEvent.setup()
    render(<ExcecoesDestinoPage />)
    await screen.findByText('banco 237 · ag. 1234 · cc ****7766-1')
    await user.click(screen.getByRole('button', { name: 'Aprovada' }))
    await waitFor(() => expect(listarExcecoes).toHaveBeenLastCalledWith({ estado: 'APROVADA' }))
    await user.click(screen.getByRole('button', { name: 'Todas' }))
    await waitFor(() => expect(listarExcecoes).toHaveBeenLastCalledWith({}))
  })

  it('a exceção cadastrada pelo usuário logado tem "Aprovar" desabilitado; a de outra pessoa, não', async () => {
    ;(listarExcecoes as jest.Mock).mockResolvedValue([
      exc({ id: 'A', pesCod: '7001', cadastradoPor: 'ana' }),
      exc({ id: 'B', pesCod: '7002', cadastradoPor: 'bia' }),
    ])
    render(<ExcecoesDestinoPage />)
    expect(await screen.findByRole('button', { name: /aprovar exceção do favorecido 7001/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /aprovar exceção do favorecido 7002/i })).toBeEnabled()
  })

  it('lista vazia explica o que fazer', async () => {
    ;(listarExcecoes as jest.Mock).mockResolvedValue([])
    render(<ExcecoesDestinoPage />)
    expect(await screen.findByText('Nenhuma exceção neste filtro')).toBeInTheDocument()
  })

  it('erro de carga aparece como alerta, sem derrubar a página', async () => {
    ;(listarExcecoes as jest.Mock).mockRejectedValue(new Error('API 500'))
    render(<ExcecoesDestinoPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('API 500')
  })

  it('"Cadastrar exceção" abre o diálogo', async () => {
    const user = userEvent.setup()
    render(<ExcecoesDestinoPage />)
    await screen.findByText('banco 237 · ag. 1234 · cc ****7766-1')
    await user.click(screen.getByRole('button', { name: /^cadastrar exceção$/i }))
    expect(screen.getByRole('dialog', { name: 'Cadastrar exceção de destino' })).toBeInTheDocument()
  })
})

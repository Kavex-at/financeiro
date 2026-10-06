/** Fila de pendências de cadastro (ADR-0063, I13k): guard por `sispag:cadastro`, sem resolver manual. */

import { render, screen, waitFor } from '@testing-library/react'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'
import type { PendenciaCadastro } from '@/lib/sispag'

let permissoes: Permissao[] = [...CATALOGO_PERMISSOES]
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({
    carregando: false,
    falhou: false,
    recarregar: jest.fn(),
    tem: (p: Permissao) => permissoes.includes(p),
  }),
}))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, fetchPendenciasCadastro: jest.fn() }
})

import { fetchPendenciasCadastro } from '@/lib/sispag'
import PendenciasCadastroPage from './page'

const pendencia: PendenciaCadastro = {
  id: 'P1',
  pesCod: '90001',
  filCod: 4,
  credor: 'FORNECEDOR A',
  tipo: 'CHAVE_PIX',
  estado: 'ABERTA',
  abertaEm: '2026-10-05T10:00:00.000Z',
  comExcecaoAprovada: true,
  origens: [
    {
      loteId: 'L1',
      filCod: 4,
      docCod: '6173',
      titCod: '1',
      desfecho: 'RETIRADO',
      registradaEm: '2026-10-05T10:00:00.000Z',
    },
  ],
}

beforeEach(() => {
  jest.clearAllMocks()
  permissoes = [...CATALOGO_PERMISSOES]
  ;(fetchPendenciasCadastro as jest.Mock).mockResolvedValue([pendencia])
})

describe('/sispag/pendencias-cadastro', () => {
  it('sem sispag:cadastro: acesso negado e nada é buscado', async () => {
    permissoes = ['sispag:ver', 'sispag:executar']
    render(<PendenciasCadastroPage />)
    expect(await screen.findByText(/sem permissão|acesso/i)).toBeInTheDocument()
    expect(fetchPendenciasCadastro).not.toHaveBeenCalled()
  })

  it('com sispag:cadastro: lista favorecido, o que falta e os títulos de origem', async () => {
    permissoes = ['sispag:cadastro']
    render(<PendenciasCadastroPage />)
    expect(await screen.findByText('FORNECEDOR A')).toBeInTheDocument()
    expect(screen.getByText('chave PIX')).toBeInTheDocument()
    expect(screen.getByText(/6173\/1 · retirado do lote/)).toBeInTheDocument()
    expect(screen.getByText('paga por exceção')).toBeInTheDocument()
  })

  it('não existe ação manual de resolver', async () => {
    render(<PendenciasCadastroPage />)
    await waitFor(() => expect(fetchPendenciasCadastro).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /resolver|concluir|fechar/i })).toBeNull()
  })

  it('fila vazia explica', async () => {
    ;(fetchPendenciasCadastro as jest.Mock).mockResolvedValue([])
    render(<PendenciasCadastroPage />)
    expect(await screen.findByText('Nenhuma pendência de cadastro')).toBeInTheDocument()
  })

  it('erro de leitura aparece em português', async () => {
    ;(fetchPendenciasCadastro as jest.Mock).mockRejectedValue(
      new Error('Falha ao carregar as pendências (HTTP 500).'),
    )
    render(<PendenciasCadastroPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Falha ao carregar/)
  })
})

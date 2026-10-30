/**
 * Coluna "Fornecedor" da aba "Boletos DDA" (ADR-0081): o nome aprendido da conta do beneficiário
 * nas barras, com o selo "provável" quando foi só inferido. O backend decide o nome; a tela só
 * mostra — e nunca inventa um quando ele não veio.
 */

import { render, screen, within } from '@testing-library/react'
import { CATALOGO_PERMISSOES } from '@/lib/permissoes'
import type { BoletoDda, BoletosDdaResposta } from '@/lib/sispag'
import { BoletosDdaTab } from './BoletosDdaTab'

jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({
    carregando: false,
    tem: (p: string) => (CATALOGO_PERMISSOES as readonly string[]).includes(p),
  }),
}))
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }))
jest.mock('@/lib/sispag', () => {
  const real = jest.requireActual('@/lib/sispag')
  return { ...real, fetchBoletosDda: jest.fn(), sincronizarBoletosDda: jest.fn() }
})
jest.mock('./ddaDefasado', () => ({ horasDdaDefasado: jest.fn(() => undefined) }))

import { fetchBoletosDda } from '@/lib/sispag'

const mockFetch = fetchBoletosDda as jest.MockedFunction<typeof fetchBoletosDda>

const livre = (ditCod: number, over: Partial<BoletoDda> = {}): BoletoDda => ({
  ddcCod: 152,
  ditCod,
  numero: `NUM${ditCod}`,
  valor: 100,
  vencimento: '2026-11-05',
  vencido: false,
  bancoEmissor: '237',
  arquivos: 1,
  situacao: 'SEM_TITULO',
  candidatos: [],
  ...over,
})

const resposta = (boletos: BoletoDda[]): BoletosDdaResposta => ({
  boletos,
  total: boletos.length,
  pagina: 1,
  tamanho: 20,
  contagem: {
    todas: boletos.length,
    VINCULADO: 0,
    CANDIDATO: 0,
    AMBIGUO: 0,
    SEM_TITULO: boletos.length,
    FORA_JANELA: 0,
    TITULO_SAIU_CARTEIRA: 0,
    emGrupo: 0,
  },
  filiais: [],
  regraCandidato: 'regra',
})

beforeEach(() => mockFetch.mockReset())

describe('BoletosDdaTab — coluna Fornecedor (ADR-0081)', () => {
  it('mostra o nome; "provável" só quando foi inferido; sem fornecedor fica "—"', async () => {
    mockFetch.mockResolvedValue(
      resposta([
        livre(1, { fornecedor: { pesCod: '10', nome: 'ACME VINCULADA LTDA', origem: 'VINCULADO' } }),
        livre(2, { fornecedor: { pesCod: '20', nome: 'BETA CONFIRMADA SA', origem: 'CONFIRMADO' } }),
        livre(3, { fornecedor: { pesCod: '30', nome: 'GAMA INFERIDA ME', origem: 'INFERIDO' } }),
        livre(4),
      ]),
    )
    render(<BoletosDdaTab />)

    expect(await screen.findByRole('columnheader', { name: 'Fornecedor' })).toBeInTheDocument()
    const linha = (numero: string) => screen.getByText(numero).closest('tr') as HTMLElement

    expect(within(linha('NUM1')).getByText('ACME VINCULADA LTDA')).toBeInTheDocument()
    expect(within(linha('NUM1')).queryByText('provável')).not.toBeInTheDocument()
    expect(within(linha('NUM2')).getByText('BETA CONFIRMADA SA')).toBeInTheDocument()
    expect(within(linha('NUM2')).queryByText('provável')).not.toBeInTheDocument()
    expect(within(linha('NUM3')).getByText('GAMA INFERIDA ME')).toBeInTheDocument()
    expect(within(linha('NUM3')).getByText('provável')).toBeInTheDocument()
    expect(within(linha('NUM4')).queryByText('provável')).not.toBeInTheDocument()
  })
})

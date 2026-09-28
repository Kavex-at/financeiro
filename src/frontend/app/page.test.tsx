import { render, screen } from '@testing-library/react'
import HomePage from '@/app/page'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'

// ADR-0053: cada card aparece pela permissão, lida de `usePermissoes`. Por padrão, o Administrador
// (as nove) — o que todo usuário tem no dia do deploy.
const permissoesMock = jest.fn<{ carregando: boolean; tem: (p: Permissao) => boolean }, []>()
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => permissoesMock(),
}))
const com = (...lista: Permissao[]) => ({
  carregando: false,
  tem: (p: Permissao) => lista.includes(p),
})

beforeEach(() => {
  permissoesMock.mockReset().mockReturnValue(com(...CATALOGO_PERMISSOES))
})

/**
 * Home (`/`) — o card da Frente IV. Estes testes existem por causa de um bug de
 * produção: a frente ficava com o botão apagado ("Indisponível em produção")
 * porque a flag `NEXT_PUBLIC_RECEBIMENTOS_ENABLED` só ligava em `NEXT_PUBLIC_ENV=local`,
 * e um build da Vercel nunca é "local". A flag foi removida (ADR-0028) — aqui se
 * fixa que ela não volte.
 */
describe('HomePage — card da Gestão de Adiantamentos', () => {
  const orig = { ...process.env }
  afterEach(() => {
    process.env.NEXT_PUBLIC_ENV = orig.NEXT_PUBLIC_ENV
    process.env.NEXT_PUBLIC_RECEBIMENTOS_ENABLED = orig.NEXT_PUBLIC_RECEBIMENTOS_ENABLED
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = orig.NEXT_PUBLIC_SISPAG_ENABLED
  })

  /**
   * Reproduz um build deployado: sem flag e fora de `local`.
   *
   * O SISPAG é ligado de propósito. Ele tem o MESMO botão "Indisponível em
   * produção" e continua gated — deixá-lo desligado faria as asserções abaixo
   * passarem/falharem por causa do card errado.
   */
  const renderComoProducao = () => {
    process.env.NEXT_PUBLIC_ENV = 'production'
    delete process.env.NEXT_PUBLIC_RECEBIMENTOS_ENABLED
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
    render(<HomePage />)
  }

  it('em produção o acesso é um link HABILITADO para /recebimentos', () => {
    renderComoProducao()

    const link = screen.getByRole('link', { name: /Abrir Gestão de Adiantamentos/i })
    expect(link).toHaveAttribute('href', '/recebimentos')
    // `asChild` renderiza um <a> de verdade: se virasse <button disabled>, não
    // haveria role="link" e o getByRole acima já falharia.
    expect(link).not.toHaveAttribute('aria-disabled')
  })

  it('em produção NÃO existe botão desabilitado nem selo "Indisponível"', () => {
    renderComoProducao()

    // Com o SISPAG ligado, qualquer "Indisponível" restante só poderia vir da
    // Frente IV — que é exatamente o que não pode mais existir.
    expect(screen.queryByText(/Indisponível em produção/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Indisponível$/i)).not.toBeInTheDocument()
  })

  it('o card usa o nome novo, não mais "Recebimentos"', () => {
    renderComoProducao()

    expect(screen.getByText('Gestão de Adiantamentos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Painel de Recebimentos/i })).not.toBeInTheDocument()
  })
})

describe('HomePage — cards pela permissão (ADR-0053)', () => {
  const orig = process.env.NEXT_PUBLIC_SISPAG_ENABLED
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
  })
  afterAll(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = orig
  })

  it.each<[string, Permissao, RegExp]>([
    ['Permutas', 'permutas:ver', /Abrir Gestão de Permutas/i],
    ['SISPAG', 'sispag:ver', /Abrir Painel SISPAG/i],
    ['Adiantamentos', 'recebimentos:ver', /Abrir Gestão de Adiantamentos/i],
    ['Operação', 'operacao:ver', /Abrir Painel de Operação/i],
    ['Usuários', 'usuarios:gerenciar', /Gerenciar usuários/i],
  ])('card %s: aparece com %s e some sem ela', (_nome, permissao, link) => {
    permissoesMock.mockReturnValue(com(permissao))
    const { unmount } = render(<HomePage />)
    expect(screen.getByRole('link', { name: link })).toBeInTheDocument()
    unmount()

    permissoesMock.mockReturnValue(com(...CATALOGO_PERMISSOES.filter((p) => p !== permissao)))
    render(<HomePage />)
    expect(screen.queryByRole('link', { name: link })).not.toBeInTheDocument()
  })

  it('o esmaecimento do SISPAG por flag continua como está (com sispag:ver)', () => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'false'
    render(<HomePage />)
    expect(screen.getByText(/Indisponível em produção/i)).toBeInTheDocument()
  })

  it('enquanto as permissões carregam, nenhum card condicionado aparece', () => {
    permissoesMock.mockReturnValue({ carregando: true, tem: () => true })
    render(<HomePage />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

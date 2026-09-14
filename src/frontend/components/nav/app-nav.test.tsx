/**
 * Modelo de navegação do Financeiro — a regra de visibilidade.
 *
 * Cada item da sidebar herda o recorte que já governava o card equivalente na home. Estes testes
 * fixam o recorte item a item e, sobretudo, fixam que ele se expressa por AUSÊNCIA: o design system
 * (`docs/design-system/feedback.md`) proíbe usar `disabled` para permissão.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { buildAppNavGroups, useAppNavGroups } from '@/components/nav/app-nav'
import type { SidebarGroup, SidebarItem } from '@/components/ui/sidebar'

const fetchPermissoesMock = jest.fn()
jest.mock('@/lib/operacao', () => ({
  fetchPermissoes: () => fetchPermissoesMock(),
}))

const isAdminMock = jest.fn<boolean, []>()
jest.mock('@/lib/auth/AuthProvider', () => ({
  useIsAdmin: () => isAdminMock(),
}))

const visiveis = (groups: SidebarGroup[]): string[] =>
  groups.flatMap((g) => g.items).filter((i) => !i.hidden).map((i) => i.label)

const todos = (groups: SidebarGroup[]): SidebarItem[] => groups.flatMap((g) => g.items)

describe('buildAppNavGroups', () => {
  const tudoLiberado = { sispagEnabled: true, isAdmin: true, operacaoEnabled: true }

  it('separa Frentes de Plataforma', () => {
    const groups = buildAppNavGroups(tudoLiberado)
    expect(groups.map((g) => g.label)).toEqual(['Frentes', 'Plataforma'])
    expect(visiveis([groups[0]])).toEqual(['Permutas', 'SISPAG', 'Adiantamentos'])
    expect(visiveis([groups[1]])).toEqual(['Operação', 'Métricas', 'Usuários'])
  })

  it('aponta para as rotas reais, incluindo as sub-rotas de Permutas', () => {
    const groups = buildAppNavGroups(tudoLiberado)
    const hrefs = todos(groups).flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)])

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/permutas',
        '/permutas/borderos',
        '/permutas/clientes-filtro',
        '/sispag',
        '/recebimentos',
        '/operacao',
        '/metricas',
        '/usuarios',
      ]),
    )
  })

  it('Métricas aparece para qualquer usuário autenticado — a rota só exige login', () => {
    const groups = buildAppNavGroups({ sispagEnabled: false, isAdmin: false, operacaoEnabled: false })
    expect(visiveis(groups)).toContain('Métricas')
  })

  it('esconde SISPAG quando a flag está desligada', () => {
    const groups = buildAppNavGroups({ ...tudoLiberado, sispagEnabled: false })
    expect(visiveis(groups)).not.toContain('SISPAG')
  })

  it('esconde Usuários para quem não é admin', () => {
    const groups = buildAppNavGroups({ ...tudoLiberado, isAdmin: false })
    expect(visiveis(groups)).not.toContain('Usuários')
  })

  it('esconde Operação para quem está fora do allow-list', () => {
    const groups = buildAppNavGroups({ ...tudoLiberado, operacaoEnabled: false })
    expect(visiveis(groups)).not.toContain('Operação')
  })

  it('nunca usa disabled para expressar permissão', () => {
    const groups = buildAppNavGroups({
      sispagEnabled: false,
      isAdmin: false,
      operacaoEnabled: false,
    })
    expect(todos(groups).some((i) => i.disabled)).toBe(false)
    expect(todos(groups).filter((i) => i.hidden).map((i) => i.label).sort()).toEqual([
      'Operação',
      'SISPAG',
      'Usuários',
    ])
  })
})

function Probe() {
  const groups = useAppNavGroups()
  return (
    <ul>
      {visiveis(groups).map((label) => (
        <li key={label}>{label}</li>
      ))}
    </ul>
  )
}

describe('useAppNavGroups', () => {
  const envOriginal = process.env.NEXT_PUBLIC_SISPAG_ENABLED

  beforeEach(() => {
    fetchPermissoesMock.mockReset()
    isAdminMock.mockReset().mockReturnValue(true)
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = envOriginal
  })

  it('mostra Operação quando o backend confirma a permissão', async () => {
    fetchPermissoesMock.mockResolvedValue({ operacao: true })
    render(<Probe />)
    expect(await screen.findByText('Operação')).toBeInTheDocument()
  })

  it('falha fechada: consulta de permissão rejeitada mantém Operação escondida', async () => {
    fetchPermissoesMock.mockRejectedValue(new Error('HTTP 500'))
    render(<Probe />)

    await waitFor(() => expect(fetchPermissoesMock).toHaveBeenCalled())
    expect(screen.queryByText('Operação')).not.toBeInTheDocument()
    // O resto da navegação continua de pé — a falha é local ao item.
    expect(screen.getByText('Permutas')).toBeInTheDocument()
  })

  it('respeita a flag do SISPAG lida do ambiente', async () => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'false'
    fetchPermissoesMock.mockResolvedValue({ operacao: false })
    render(<Probe />)

    await waitFor(() => expect(fetchPermissoesMock).toHaveBeenCalled())
    expect(screen.queryByText('SISPAG')).not.toBeInTheDocument()
  })

  it('esconde Usuários para não-admin', async () => {
    isAdminMock.mockReturnValue(false)
    fetchPermissoesMock.mockResolvedValue({ operacao: false })
    render(<Probe />)

    await waitFor(() => expect(fetchPermissoesMock).toHaveBeenCalled())
    expect(screen.queryByText('Usuários')).not.toBeInTheDocument()
  })
})

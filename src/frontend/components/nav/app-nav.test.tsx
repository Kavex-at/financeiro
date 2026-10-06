/**
 * Modelo de navegação do Financeiro — a regra de visibilidade (ADR-0053).
 *
 * Cada item aparece pela permissão correspondente, lida de `/me/permissoes` via `usePermissoes`.
 * Estes testes fixam o recorte item a item e, sobretudo, fixam que ele se expressa por AUSÊNCIA: o
 * design system (`docs/design-system/feedback.md`) proíbe usar `disabled` para permissão.
 */
import { render, screen } from '@testing-library/react'
import { buildAppNavGroups, useAppNavGroups } from '@/components/nav/app-nav'
import type { SidebarGroup, SidebarItem } from '@/components/ui/sidebar'
import { CATALOGO_PERMISSOES, type Permissao } from '@/lib/permissoes'

const permissoesMock = jest.fn<{ carregando: boolean; tem: (p: Permissao) => boolean }, []>()
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => permissoesMock(),
}))

const visiveis = (groups: SidebarGroup[]): string[] =>
  groups.flatMap((g) => g.items).filter((i) => !i.hidden).map((i) => i.label)

const todos = (groups: SidebarGroup[]): SidebarItem[] => groups.flatMap((g) => g.items)

const com =
  (...lista: Permissao[]) =>
  (p: Permissao): boolean =>
    lista.includes(p)
const tudo = com(...CATALOGO_PERMISSOES)
const nada = com()

describe('buildAppNavGroups', () => {
  it('separa Frentes de Plataforma', () => {
    const groups = buildAppNavGroups({ sispagEnabled: true, tem: tudo })
    expect(groups.map((g) => g.label)).toEqual(['Frentes', 'Plataforma'])
    expect(visiveis([groups[0]])).toEqual(['Permutas', 'SISPAG', 'Pendências de cadastro', 'Adiantamentos'])
    expect(visiveis([groups[1]])).toEqual(['Operação', 'Métricas', 'Usuários'])
  })

  it('aponta para as rotas reais, incluindo as sub-rotas de Permutas', () => {
    const groups = buildAppNavGroups({ sispagEnabled: true, tem: tudo })
    const hrefs = todos(groups).flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)])

    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/permutas',
        '/permutas/borderos',
        '/permutas/clientes-filtro',
        '/sispag',
        '/sispag/pendencias-cadastro',
        '/recebimentos',
        '/operacao',
        '/metricas',
        '/usuarios',
      ]),
    )
  })

  it.each<[string, Permissao]>([
    ['Permutas', 'permutas:ver'],
    ['SISPAG', 'sispag:ver'],
    ['Pendências de cadastro', 'sispag:cadastro'],
    ['Adiantamentos', 'recebimentos:ver'],
    ['Operação', 'operacao:ver'],
    ['Métricas', 'metricas:ver'],
    ['Usuários', 'usuarios:gerenciar'],
  ])('%s aparece com %s e some sem ela', (label, permissao) => {
    expect(visiveis(buildAppNavGroups({ sispagEnabled: true, tem: com(permissao) }))).toContain(
      label,
    )
    const semEla = CATALOGO_PERMISSOES.filter((p) => p !== permissao)
    expect(
      visiveis(buildAppNavGroups({ sispagEnabled: true, tem: com(...semEla) })),
    ).not.toContain(label)
  })

  it('"executar" sozinho não mostra o item: a visibilidade é pelo :ver (o servidor manda o fecho)', () => {
    expect(
      visiveis(buildAppNavGroups({ sispagEnabled: true, tem: com('sispag:executar') })),
    ).not.toContain('SISPAG')
  })

  it('SISPAG exige a flag E a permissão', () => {
    expect(
      visiveis(buildAppNavGroups({ sispagEnabled: false, tem: tudo })),
    ).not.toContain('SISPAG')
  })

  it('nunca usa disabled para expressar permissão', () => {
    const groups = buildAppNavGroups({ sispagEnabled: false, tem: nada })
    expect(todos(groups).some((i) => i.disabled)).toBe(false)
    expect(
      todos(groups)
        .filter((i) => i.hidden)
        .map((i) => i.label)
        .sort(),
    ).toEqual(['Adiantamentos', 'Métricas', 'Operação', 'Pendências de cadastro', 'Permutas', 'SISPAG', 'Usuários'])
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
    permissoesMock.mockReset()
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'true'
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = envOriginal
  })

  it('mostra os itens das permissões que o usuário tem', () => {
    permissoesMock.mockReturnValue({ carregando: false, tem: com('permutas:ver', 'operacao:ver') })
    render(<Probe />)
    expect(screen.getByText('Permutas')).toBeInTheDocument()
    expect(screen.getByText('Operação')).toBeInTheDocument()
    expect(screen.queryByText('Usuários')).not.toBeInTheDocument()
  })

  it('enquanto carrega, nenhum item condicionado aparece (não aparece e some depois)', () => {
    permissoesMock.mockReturnValue({ carregando: true, tem: tudo })
    render(<Probe />)
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('respeita a flag do SISPAG lida do ambiente', () => {
    process.env.NEXT_PUBLIC_SISPAG_ENABLED = 'false'
    permissoesMock.mockReturnValue({ carregando: false, tem: tudo })
    render(<Probe />)
    expect(screen.queryByText('SISPAG')).not.toBeInTheDocument()
    expect(screen.getByText('Permutas')).toBeInTheDocument()
  })
})

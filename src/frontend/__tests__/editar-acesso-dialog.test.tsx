/**
 * "Editar acesso" (ADR-0053): papel + exceções de um usuário. Mostra, por permissão, o EFETIVO e a
 * origem (papel, concedida, revogada); aplica a regra do Q8 na tela (marcar executar marca ver;
 * desmarcar ver desmarca executar); 409 da guarda aparece inline e o diálogo continua aberto.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditarAcessoDialog } from '@/app/usuarios/EditarAcessoDialog'
import { CATALOGO_PERMISSOES } from '@/lib/permissoes'
import type { AppUser, PapelComPermissoes } from '@/lib/usuarios'

const toastSuccess = jest.fn()
jest.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: jest.fn() },
}))

class UsuariosApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}
const atribuirPapel = jest.fn()
const definirExcecoes = jest.fn()
jest.mock('@/lib/usuarios', () => ({
  atribuirPapel: (...a: unknown[]) => atribuirPapel(...a),
  definirExcecoes: (...a: unknown[]) => definirExcecoes(...a),
}))

const PAPEIS: PapelComPermissoes[] = [
  { id: 1, nome: 'Administrador', permissoes: [...CATALOGO_PERMISSOES] },
  { id: 2, nome: 'Consulta', permissoes: ['permutas:ver', 'sispag:ver', 'recebimentos:ver'] },
]

const alvo = (over: Partial<AppUser> = {}): AppUser => ({
  id: 7,
  username: 'maria@columbiabr.com',
  role: 'admin',
  ativo: true,
  createdAt: '2026-09-28T00:00:00.000Z',
  papel: { id: 2, nome: 'Consulta' },
  excecoes: [],
  permissoesEfetivas: ['permutas:ver', 'recebimentos:ver', 'sispag:ver'],
  ...over,
})

const onClose = jest.fn()
const onSaved = jest.fn()

const abrir = (usuario: AppUser = alvo(), souEu = false) =>
  render(
    <EditarAcessoDialog
      alvo={usuario}
      papeis={PAPEIS}
      catalogo={[...CATALOGO_PERMISSOES]}
      souEu={souEu}
      onClose={onClose}
      onSaved={onSaved}
    />,
  )

const caixa = (nome: RegExp) => screen.getByRole('checkbox', { name: nome })

/**
 * Seletor de papel do DS (Radix Select). O jsdom não abre o popover do Radix; o `<select>` nativo
 * que o Radix renderiza junto (para formulário e autofill) aciona o mesmo `onValueChange`.
 */
const escolherPapel = async (nome: string) => {
  expect(screen.getByRole('combobox', { name: 'Papel' })).toBeInTheDocument()
  const nativo = document.querySelector('select')
  const opcao = [...(nativo?.options ?? [])].find((o) => o.textContent === nome)
  if (!nativo || !opcao) throw new Error(`papel ${nome} não encontrado no seletor`)
  fireEvent.change(nativo, { target: { value: opcao.value } })
}

describe('EditarAcessoDialog', () => {
  beforeEach(() => {
    toastSuccess.mockReset()
    atribuirPapel.mockReset().mockResolvedValue({ id: 7, papel: { id: 1, nome: 'Administrador' } })
    definirExcecoes.mockReset().mockResolvedValue({ id: 7, excecoes: [], permissoesEfetivas: [] })
    onClose.mockReset()
    onSaved.mockReset()
  })

  it('mostra o catálogo agrupado por módulo, com o efetivo e a origem de cada permissão', () => {
    abrir(
      alvo({
        excecoes: [
          { permissao: 'sispag:ver', efeito: 'revogar' },
          { permissao: 'metricas:ver', efeito: 'conceder' },
        ],
      }),
    )
    for (const modulo of ['Permutas', 'SISPAG', 'Adiantamentos', 'Operação', 'Métricas', 'Usuários']) {
      expect(screen.getByRole('group', { name: modulo })).toBeInTheDocument()
    }
    expect(caixa(/Permutas — ver/)).toHaveAttribute('aria-checked', 'true')
    expect(caixa(/SISPAG — ver/)).toHaveAttribute('aria-checked', 'false')
    expect(caixa(/Métricas — ver/)).toHaveAttribute('aria-checked', 'true')
    expect(within(screen.getByRole('group', { name: 'Permutas' })).getByText('do papel')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'SISPAG' })).getByText('revogada')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Métricas' })).getByText('concedida')).toBeInTheDocument()
  })

  it('Q8: marcar "executar" marca "ver"', () => {
    abrir(alvo({ papel: { id: 2, nome: 'Consulta' } }))
    fireEvent.click(caixa(/SISPAG — ver/)) // desmarca o ver que vinha do papel
    expect(caixa(/SISPAG — ver/)).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(caixa(/SISPAG — executar/))
    expect(caixa(/SISPAG — executar/)).toHaveAttribute('aria-checked', 'true')
    expect(caixa(/SISPAG — ver/)).toHaveAttribute('aria-checked', 'true')
  })

  it('Q8: desmarcar "ver" desmarca "executar"', () => {
    abrir(alvo({ papel: { id: 1, nome: 'Administrador' } }))
    expect(caixa(/Permutas — executar/)).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(caixa(/Permutas — ver/))
    expect(caixa(/Permutas — ver/)).toHaveAttribute('aria-checked', 'false')
    expect(caixa(/Permutas — executar/)).toHaveAttribute('aria-checked', 'false')
  })

  it('salvar só exceções: chama definirExcecoes (não atribuirPapel), toast, fecha e recarrega', async () => {
    abrir()
    fireEvent.click(caixa(/Métricas — ver/)) // concede
    fireEvent.click(caixa(/SISPAG — ver/)) // revoga (vinha do papel)
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() =>
      expect(definirExcecoes).toHaveBeenCalledWith(7, [
        { permissao: 'metricas:ver', efeito: 'conceder' },
        { permissao: 'sispag:ver', efeito: 'revogar' },
      ]),
    )
    expect(atribuirPapel).not.toHaveBeenCalled()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalled()
  })

  it('"voltar ao papel" desfaz a exceção da permissão', async () => {
    abrir(alvo({ excecoes: [{ permissao: 'sispag:ver', efeito: 'revogar' }] }))
    fireEvent.click(screen.getByRole('button', { name: /Voltar SISPAG — ver ao papel/i }))
    expect(caixa(/SISPAG — ver/)).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(definirExcecoes).toHaveBeenCalledWith(7, []))
  })

  it('trocar o papel: chama atribuirPapel; exceções sem mudança não são regravadas', async () => {
    abrir()
    await escolherPapel('Administrador')
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() => expect(atribuirPapel).toHaveBeenCalledWith(7, 1))
    expect(definirExcecoes).not.toHaveBeenCalled()
  })

  it('nada mudou: salvar só fecha, sem chamadas', async () => {
    abrir()
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(atribuirPapel).not.toHaveBeenCalled()
    expect(definirExcecoes).not.toHaveBeenCalled()
  })

  it.each([
    'Não é possível remover o último usuário com permissão de gerenciar usuários.',
    'Você não pode remover a sua própria permissão de gerenciar usuários.',
  ])('409 "%s": inline no diálogo, que continua aberto', async (msg) => {
    definirExcecoes.mockRejectedValue(new UsuariosApiError(msg, 409))
    abrir(alvo({ papel: { id: 1, nome: 'Administrador' } }))
    fireEvent.click(caixa(/Usuários — gerenciar/))
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))

    const erro = await screen.findByRole('alert')
    expect(erro).toHaveTextContent(msg)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('na própria linha, avisa que remover a própria usuarios:gerenciar não é permitido', () => {
    abrir(alvo({ papel: { id: 1, nome: 'Administrador' } }), true)
    expect(
      screen.getByText(/não pode remover a sua própria permissão de gerenciar usuários/i),
    ).toBeInTheDocument()
  })

  it('acessível por teclado: cada permissão é um checkbox com rótulo em português', () => {
    abrir()
    const caixas = screen.getAllByRole('checkbox')
    expect(caixas).toHaveLength(CATALOGO_PERMISSOES.length)
    for (const c of caixas) expect(c).toHaveAccessibleName()
  })
})

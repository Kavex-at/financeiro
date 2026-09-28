/**
 * `/usuarios` (ADR-0051, ADR-0053): coluna Usuário separada de E-mail, pendência destacada,
 * "Editar e-mail" com erro inline, papel vindo do banco (com indicação de exceções), novo usuário
 * com papel escolhido (sem default), "Editar acesso" e a reversão do switch quando o backend recusa
 * a desativação (próprio acesso / último gestor).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { AppUser } from '@/lib/usuarios'

const toastSuccess = jest.fn()
const toastError = jest.fn()
jest.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}))

let eu = 'admin'
jest.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ username: eu }),
}))

// Quem chega à tela tem `usuarios:gerenciar` (o guard de página tem teste próprio).
jest.mock('@/lib/auth/PermissoesProvider', () => ({
  usePermissoes: () => ({ carregando: false, tem: () => true }),
}))

class UsuariosApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const fetchUsuarios = jest.fn()
const definirEmail = jest.fn()
const criarUsuario = jest.fn()
const setUsuarioAtivo = jest.fn()
const PAPEIS = {
  papeis: [
    { id: 1, nome: 'Administrador', permissoes: ['permutas:ver'] },
    { id: 2, nome: 'Consulta', permissoes: ['permutas:ver'] },
  ],
  catalogo: [
    'permutas:ver',
    'permutas:executar',
    'sispag:ver',
    'sispag:executar',
    'recebimentos:ver',
    'recebimentos:executar',
    'operacao:ver',
    'metricas:ver',
    'usuarios:gerenciar',
  ],
}
jest.mock('@/lib/usuarios', () => ({
  UsuariosApiError,
  listarPapeis: async () => PAPEIS,
  atribuirPapel: jest.fn(),
  definirExcecoes: jest.fn(),
  fetchUsuarios: () => fetchUsuarios(),
  fetchUsuariosMeta: async () => ({ vinculoDisponivel: false }),
  definirEmail: (...a: unknown[]) => definirEmail(...a),
  criarUsuario: (...a: unknown[]) => criarUsuario(...a),
  setUsuarioAtivo: (...a: unknown[]) => setUsuarioAtivo(...a),
  resetarSenha: jest.fn(),
  definirVinculoConexos: jest.fn(),
  removerVinculoConexos: jest.fn(),
}))

import UsuariosPage from '@/app/usuarios/page'

const usuario = (over: Partial<AppUser>): AppUser => ({
  id: 1,
  username: 'admin',
  role: 'admin',
  ativo: true,
  createdAt: '2026-07-10T12:00:00.000Z',
  ...over,
})

const LISTA: AppUser[] = [
  usuario({ id: 1, username: 'admin', email: 'ti@columbiabr.com', papel: { id: 1, nome: 'Administrador' } }),
  usuario({
    id: 2,
    username: 'b@kavex.com',
    papel: { id: 2, nome: 'Consulta' },
    excecoes: [{ permissao: 'sispag:executar', efeito: 'conceder' }],
  }),
]

const linhaDe = (texto: string): HTMLElement => {
  const linha = screen.getByText(texto).closest('tr')
  if (!linha) throw new Error(`linha de ${texto} não encontrada`)
  return linha
}

describe('UsuariosPage', () => {
  beforeEach(() => {
    eu = 'admin'
    toastSuccess.mockReset()
    toastError.mockReset()
    fetchUsuarios.mockReset().mockResolvedValue(LISTA)
    definirEmail.mockReset()
    criarUsuario.mockReset()
    setUsuarioAtivo.mockReset()
  })

  it('separa as colunas Usuário e E-mail; sem e-mail, mostra "Pendente" destacado', async () => {
    render(<UsuariosPage />)
    await screen.findByText('b@kavex.com')

    const cabecalhos = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(cabecalhos).toEqual(expect.arrayContaining(['Usuário', 'E-mail']))

    expect(within(linhaDe('admin')).getByText('ti@columbiabr.com')).toBeInTheDocument()
    const pendente = within(linhaDe('b@kavex.com')).getByText('Pendente')
    // Destaque com token de warning, e com texto (não só cor).
    expect(pendente.closest('[data-slot="badge"]')?.className).toMatch(/warning/)
  })

  it('"(você)" continua comparando o username — vale para quem logou por e-mail', async () => {
    // O AuthProvider guarda o username CANÔNICO da resposta do login, mesmo logando por e-mail.
    eu = 'admin'
    render(<UsuariosPage />)
    await screen.findByText('b@kavex.com')
    expect(within(linhaDe('admin')).getByText('(você)')).toBeInTheDocument()
    expect(within(linhaDe('b@kavex.com')).queryByText('(você)')).not.toBeInTheDocument()
  })

  it('o switch do próprio usuário continua desabilitado', async () => {
    render(<UsuariosPage />)
    await screen.findByText('b@kavex.com')
    expect(screen.getByRole('switch', { name: 'Acesso de admin' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Acesso de b@kavex.com' })).toBeEnabled()
  })

  describe('Editar e-mail', () => {
    const abrir = async (username: string) => {
      render(<UsuariosPage />)
      await screen.findByText('b@kavex.com')
      fireEvent.click(within(linhaDe(username)).getByRole('button', { name: /editar e-mail/i }))
      return screen.findByRole('dialog')
    }

    it('abre com o username como contexto somente leitura e o e-mail atual preenchido', async () => {
      const dialog = await abrir('admin')
      expect(within(dialog).getByText('admin')).toBeInTheDocument()
      const campo = within(dialog).getByLabelText('E-mail da Columbia')
      expect(campo).toHaveValue('ti@columbiabr.com')
      // Nada na tela edita username: o único campo do diálogo é o e-mail.
      expect(within(dialog).getAllByRole('textbox')).toHaveLength(1)
    })

    it('sucesso: chama definirEmail, mostra toast, fecha e recarrega a lista', async () => {
      definirEmail.mockResolvedValue(undefined)
      const dialog = await abrir('b@kavex.com')
      fireEvent.change(within(dialog).getByLabelText('E-mail da Columbia'), {
        target: { value: 'bruna@columbiabr.com' },
      })
      fireEvent.click(within(dialog).getByRole('button', { name: /salvar/i }))

      await waitFor(() => expect(definirEmail).toHaveBeenCalledWith(2, 'bruna@columbiabr.com'))
      await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(fetchUsuarios).toHaveBeenCalledTimes(2)
    })

    it.each([
      [409, 'Este e-mail já identifica outro usuário.'],
      [400, 'E-mail inválido.'],
    ])('%i: a mensagem do backend aparece inline e o diálogo continua aberto', async (status, msg) => {
      definirEmail.mockRejectedValue(new UsuariosApiError(msg, status))
      const dialog = await abrir('b@kavex.com')
      fireEvent.change(within(dialog).getByLabelText('E-mail da Columbia'), {
        target: { value: 'ti@columbiabr.com' },
      })
      fireEvent.click(within(dialog).getByRole('button', { name: /salvar/i }))

      const erro = await within(dialog).findByRole('alert')
      expect(erro).toHaveTextContent(msg)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(within(dialog).getByLabelText('E-mail da Columbia')).toHaveAttribute('aria-invalid', 'true')
      expect(toastSuccess).not.toHaveBeenCalled()
    })
  })

  describe('Novo usuário', () => {
    const abrir = async () => {
      render(<UsuariosPage />)
      await screen.findByText('b@kavex.com')
      fireEvent.click(screen.getByRole('button', { name: /novo usuário/i }))
      return screen.findByRole('dialog')
    }

    it('rótulo "E-mail da Columbia", placeholder nome@columbiabr.com, type=email, obrigatório', async () => {
      const dialog = await abrir()
      const campo = within(dialog).getByLabelText('E-mail da Columbia')
      expect(campo).toHaveAttribute('placeholder', 'nome@columbiabr.com')
      expect(campo).toHaveAttribute('type', 'email')
      expect(campo).toBeRequired()
    })

    /** Radix Select: o `<select>` nativo que ele renderiza aciona o mesmo `onValueChange`. */
    const escolherPapel = (dialog: HTMLElement, nome: string) => {
      const nativo = dialog.querySelector('select')
      const opcao = [...(nativo?.options ?? [])].find((o) => o.textContent === nome)
      if (!nativo || !opcao) throw new Error(`papel ${nome} não encontrado`)
      fireEvent.change(nativo, { target: { value: opcao.value } })
    }

    it('não restringe domínio: cria com outro domínio e envia email e papelId', async () => {
      criarUsuario.mockResolvedValue(usuario({ id: 9, username: 'x@kavex.com', email: 'x@kavex.com' }))
      const dialog = await abrir()
      fireEvent.change(within(dialog).getByLabelText('E-mail da Columbia'), {
        target: { value: 'x@kavex.com' },
      })
      fireEvent.change(within(dialog).getByLabelText(/senha/i), { target: { value: 'segredo12' } })
      escolherPapel(dialog, 'Consulta')
      fireEvent.click(within(dialog).getByRole('button', { name: /criar usuário/i }))

      await waitFor(() => expect(criarUsuario).toHaveBeenCalled())
      expect(criarUsuario.mock.calls[0][0]).toMatchObject({ email: 'x@kavex.com', papelId: 2 })
      expect(criarUsuario.mock.calls[0][0]).not.toHaveProperty('role')
    })

    it('o seletor de papel lista os papéis do banco, sem valor pré-selecionado; Criar fica bloqueado até escolher (Q3)', async () => {
      const dialog = await abrir()
      const nomes = [...(dialog.querySelector('select')?.options ?? [])]
        .map((o) => o.textContent)
        .filter(Boolean)
      expect(nomes).toEqual(['Administrador', 'Consulta'])
      expect(within(dialog).getByRole('combobox', { name: 'Papel' })).toHaveTextContent(
        /Escolha o papel/,
      )
      const criar = within(dialog).getByRole('button', { name: /criar usuário/i })
      expect(criar).toBeDisabled()
      escolherPapel(dialog, 'Administrador')
      expect(criar).toBeEnabled()
    })

    it('409 do backend aparece no diálogo, que continua aberto', async () => {
      criarUsuario.mockRejectedValue(
        new UsuariosApiError('Este e-mail já identifica outro usuário.', 409),
      )
      const dialog = await abrir()
      fireEvent.change(within(dialog).getByLabelText('E-mail da Columbia'), {
        target: { value: 'ti@columbiabr.com' },
      })
      fireEvent.change(within(dialog).getByLabelText(/senha/i), { target: { value: 'segredo12' } })
      escolherPapel(dialog, 'Administrador')
      fireEvent.click(within(dialog).getByRole('button', { name: /criar usuário/i }))

      const erro = await within(dialog).findByRole('alert')
      expect(erro).toHaveTextContent('Este e-mail já identifica outro usuário.')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('a coluna Papel mostra o papel do banco e indica exceções com texto (não só cor)', async () => {
    render(<UsuariosPage />)
    await screen.findByText('b@kavex.com')
    expect(within(linhaDe('admin')).getByText('Administrador')).toBeInTheDocument()
    expect(within(linhaDe('admin')).queryByText('com exceções')).not.toBeInTheDocument()
    expect(within(linhaDe('b@kavex.com')).getByText('Consulta')).toBeInTheDocument()
    expect(within(linhaDe('b@kavex.com')).getByText('com exceções')).toBeInTheDocument()
    expect(screen.queryByText('Operador')).not.toBeInTheDocument()
  })

  it('"Editar acesso" na linha abre o diálogo de papel e exceções daquele usuário', async () => {
    render(<UsuariosPage />)
    await screen.findByText('b@kavex.com')
    fireEvent.click(within(linhaDe('b@kavex.com')).getByRole('button', { name: /editar acesso/i }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Editar acesso')).toBeInTheDocument()
    expect(within(dialog).getByText('b@kavex.com')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(9)
  })

  it.each([
    'Você não pode desativar o próprio acesso.',
    'Não é possível remover o último usuário com permissão de gerenciar usuários.',
  ])('desativar recusado (409 "%s"): mostra a mensagem e o switch volta', async (msg) => {
    setUsuarioAtivo.mockRejectedValue(new UsuariosApiError(msg, 409))
    render(<UsuariosPage />)
    await screen.findByText('b@kavex.com')
    const sw = screen.getByRole('switch', { name: 'Acesso de b@kavex.com' })
    expect(sw).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(sw)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(msg))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Acesso de b@kavex.com' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
  })
})

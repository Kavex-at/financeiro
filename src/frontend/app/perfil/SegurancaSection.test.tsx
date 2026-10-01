/**
 * Seção Segurança (ADR-0058): pronta e DESLIGADA atrás de `SENHA_PROPRIA_HABILITADA` até o backend
 * `feat/auth-senha-propria` existir. Desligada, não chama a rede. Ligada (só no teste), mapeia
 * 204 / 400 POLITICA / 422 SENHA_ATUAL_INVALIDA / 429 / 503 — e o 422 nunca vira sessão expirada.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegurancaSection } from '@/app/perfil/SegurancaSection'
import { SENHA_PROPRIA_HABILITADA, mapearRespostaSenha } from '@/lib/perfil/senha'

jest.mock('@/lib/auth/token', () => ({
  withAuthHeaders: async () => ({ Authorization: 'Bearer t' }),
}))
const emitSessionExpired = jest.fn()
jest.mock('@/lib/auth/session-events', () => ({
  emitSessionExpired: () => emitSessionExpired(),
}))

/** Resposta mínima no formato que o `apiFetch` e o cliente leem (jsdom não tem `Response`). */
const responder = (status: number, body?: unknown) =>
  jest.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (body === undefined) throw new Error('sem corpo')
      return body
    },
  })

/** jsdom não tem `fetch`: instala o dublê no global e devolve o mock. */
const usarFetch = (impl: jest.Mock): jest.Mock => {
  global.fetch = impl as unknown as typeof fetch
  return impl
}

const preencher = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Senha atual'), 'antiga-123456')
  await user.type(screen.getByLabelText('Nova senha'), 'NovaSenha-2026x')
  await user.type(screen.getByLabelText('Confirmar nova senha'), 'NovaSenha-2026x')
  await user.click(screen.getByRole('button', { name: /alterar senha/i }))
}

afterEach(() => {
  jest.restoreAllMocks()
  emitSessionExpired.mockReset()
})

describe('SegurancaSection — desligada (padrão)', () => {
  it('a flag nasce desligada', () => {
    expect(SENHA_PROPRIA_HABILITADA).toBe(false)
  })

  it('campos e botão desabilitados, selo "em breve", âncora #senha e nenhuma chamada de rede', async () => {
    const fetchSpy = usarFetch(responder(204))
    render(<SegurancaSection />)
    expect(document.getElementById('senha')).not.toBeNull()
    expect(screen.getByText(/em breve/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Senha atual')).toBeDisabled()
    expect(screen.getByLabelText('Nova senha')).toBeDisabled()
    expect(screen.getByLabelText('Confirmar nova senha')).toBeDisabled()
    expect(screen.getByRole('button', { name: /alterar senha/i })).toBeDisabled()
    expect(screen.getByRole('list', { name: /política de senha/i })).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /alterar senha/i }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('SegurancaSection — ligada (só no teste)', () => {
  it('204 → sucesso', async () => {
    usarFetch(responder(204))
    const user = userEvent.setup()
    render(<SegurancaSection habilitada />)
    await preencher(user)
    expect(await screen.findByText(/senha alterada/i)).toBeInTheDocument()
  })

  it('400 POLITICA → checklist com o que falhou', async () => {
    usarFetch(responder(400, { codigo: 'POLITICA', falhas: ['tamanho'] }))
    const user = userEvent.setup()
    render(<SegurancaSection habilitada />)
    await preencher(user)
    expect(await screen.findByText(/não atende à política/i)).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /mínimo de 12 caracteres/i })).toHaveAttribute(
      'data-ok',
      'false',
    )
  })

  it('422 SENHA_ATUAL_INVALIDA → erro no campo, sem modal de sessão', async () => {
    usarFetch(responder(422, { codigo: 'SENHA_ATUAL_INVALIDA' }))
    const user = userEvent.setup()
    render(<SegurancaSection habilitada />)
    await preencher(user)
    expect(await screen.findByText(/senha atual não confere/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('aria-invalid', 'true')
    expect(emitSessionExpired).not.toHaveBeenCalled()
  })

  it('429 → muitas tentativas', async () => {
    usarFetch(responder(429))
    const user = userEvent.setup()
    render(<SegurancaSection habilitada />)
    await preencher(user)
    expect(await screen.findByText(/muitas tentativas/i)).toBeInTheDocument()
  })

  it('503 → não foi possível verificar', async () => {
    usarFetch(responder(503))
    const user = userEvent.setup()
    render(<SegurancaSection habilitada />)
    await preencher(user)
    await waitFor(() => expect(screen.getByText(/não foi possível verificar/i)).toBeInTheDocument())
  })
})

describe('mapearRespostaSenha', () => {
  it.each([
    [204, undefined, 'sucesso'],
    [400, { codigo: 'POLITICA' }, 'politica'],
    [422, { codigo: 'SENHA_ATUAL_INVALIDA' }, 'senha_atual_invalida'],
    [429, undefined, 'muitas_tentativas'],
    [503, undefined, 'indisponivel'],
    [500, undefined, 'indisponivel'],
  ])('%i → %s', (status, body, tipo) => {
    expect(mapearRespostaSenha(status, body).tipo).toBe(tipo)
  })
})

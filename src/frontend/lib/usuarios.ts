import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'
import type { PapelRef, Permissao } from './permissoes'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/** Efeito de uma exceção por usuário: dar além do papel, ou tirar do papel (revogar vence). */
export type EfeitoExcecao = 'conceder' | 'revogar'

/** Exceção de permissão de um usuário. */
export interface ExcecaoPermissao {
  permissao: Permissao
  efeito: EfeitoExcecao
}

/** Papel com o seu pacote de permissões. */
export interface PapelComPermissoes extends PapelRef {
  descricao?: string
  permissoes: Permissao[]
}

/** Usuário da plataforma (sem senha) — o que a tela de gestão lista. */
export interface AppUser {
  id: number
  username: string
  /** Coluna legada (passo 1). Não autoriza nada; a tela usa `papel` (ADR-0053). */
  role: string
  ativo: boolean
  /** Papel do usuário (do banco). Ausente só em backend anterior à ADR-0053. */
  papel?: PapelRef
  /** Exceções por usuário (conceder/revogar). */
  excecoes?: ExcecaoPermissao[]
  /** Permissões efetivas, calculadas no servidor. */
  permissoesEfetivas?: Permissao[]
  createdBy?: string
  createdAt: string
  /** Login Conexos vinculado (ex.: MARILYN_MUTAFCI). Ausente = sem vínculo (opera via robô). */
  conexosUsername?: string
  /** E-mail de login (ADR-0051). Ausente = pendente de cadastro. */
  email?: string
}

/** Erro de API com a mensagem do backend (ex.: 409 email duplicado). */
export class UsuariosApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'UsuariosApiError'
  }
}

/** Extrai a mensagem de erro do corpo JSON do backend; cai no status cru. */
const errorFrom = async (res: Response): Promise<UsuariosApiError> => {
  let message = `Erro ${res.status}`
  try {
    const body = await res.json()
    if (body?.error) message = body.error
  } catch {}
  return new UsuariosApiError(message, res.status)
}

/** Status do vínculo Conexos do usuário logado (para o aviso pós-login). */
export type ConexosStatus = 'ok' | 'falha' | 'ausente'

/** GET /me/conexos-status — se a credencial Conexos do usuário loga no ERP. */
export async function fetchConexosStatus(): Promise<ConexosStatus> {
  const res = await apiFetch(`${API}/me/conexos-status`, { headers: await withAuthHeaders() })
  if (!res.ok) throw await errorFrom(res)
  const body = (await res.json()) as { status: ConexosStatus }
  return body.status
}

/** GET /usuarios/meta — flags de configuração (ex.: vínculo Conexos disponível). */
export async function fetchUsuariosMeta(): Promise<{ vinculoDisponivel: boolean }> {
  const res = await apiFetch(`${API}/usuarios/meta`, { headers: await withAuthHeaders() })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as { vinculoDisponivel: boolean }
}

/** GET /usuarios — lista todos os usuários (admin). */
export async function fetchUsuarios(): Promise<AppUser[]> {
  const res = await apiFetch(`${API}/usuarios`, { headers: await withAuthHeaders() })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as AppUser[]
}

/**
 * POST /usuarios — cria um usuário (e-mail + senha + papel + vínculo Conexos opcional). O backend
 * grava `username = email`.
 */
export async function criarUsuario(input: {
  email: string
  password: string
  /** Papel escolhido na criação — obrigatório, sem default (Q3). */
  papelId: number
  conexosUsername?: string
  conexosPassword?: string
}): Promise<AppUser> {
  const res = await apiFetch(`${API}/usuarios`, {
    method: 'POST',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as AppUser
}

/** PATCH /usuarios/:id/vinculo — define o vínculo Conexos (login + senha do ERP). */
export async function definirVinculoConexos(
  id: number,
  input: { conexosUsername: string; conexosPassword: string },
): Promise<void> {
  const res = await apiFetch(`${API}/usuarios/${id}/vinculo`, {
    method: 'PATCH',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(input),
  })
  if (!res.ok) throw await errorFrom(res)
}

/** PATCH /usuarios/:id/vinculo {remover:true} — remove o vínculo (volta ao robô). */
export async function removerVinculoConexos(id: number): Promise<void> {
  const res = await apiFetch(`${API}/usuarios/${id}/vinculo`, {
    method: 'PATCH',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ remover: true }),
  })
  if (!res.ok) throw await errorFrom(res)
}

/**
 * PATCH /usuarios/:id/email — grava o e-mail de login (admin). Fora de 2xx lança
 * `UsuariosApiError` com a mensagem do backend e o status (409 = já identifica outro usuário).
 */
export async function definirEmail(id: number, email: string): Promise<void> {
  const res = await apiFetch(`${API}/usuarios/${id}/email`, {
    method: 'PATCH',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw await errorFrom(res)
}

/** PATCH /usuarios/:id/ativo — ativa/desativa o acesso. */
export async function setUsuarioAtivo(id: number, ativo: boolean): Promise<void> {
  const res = await apiFetch(`${API}/usuarios/${id}/ativo`, {
    method: 'PATCH',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ativo }),
  })
  if (!res.ok) throw await errorFrom(res)
}

/** POST /usuarios/:id/reset-senha — redefine a senha do usuário. */
export async function resetarSenha(id: number, password: string): Promise<void> {
  const res = await apiFetch(`${API}/usuarios/${id}/reset-senha`, {
    method: 'POST',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw await errorFrom(res)
}

/** GET /usuarios/papeis — papéis (com pacote) para o seletor, e o catálogo de permissões. */
export async function listarPapeis(): Promise<{
  papeis: PapelComPermissoes[]
  catalogo: Permissao[]
}> {
  const res = await apiFetch(`${API}/usuarios/papeis`, { headers: await withAuthHeaders() })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as { papeis: PapelComPermissoes[]; catalogo: Permissao[] }
}

/**
 * PATCH /usuarios/:id/papel — troca o papel. Fora de 2xx lança `UsuariosApiError` com a mensagem
 * e o status do backend (409 = guarda do último gestor / da própria permissão).
 */
export async function atribuirPapel(
  id: number,
  papelId: number,
): Promise<{ id: number; papel: PapelRef }> {
  const res = await apiFetch(`${API}/usuarios/${id}/papel`, {
    method: 'PATCH',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ papelId }),
  })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as { id: number; papel: PapelRef }
}

/**
 * PUT /usuarios/:id/permissoes — substitui o conjunto de exceções do usuário. Fora de 2xx lança
 * `UsuariosApiError` (409 preservado).
 */
export async function definirExcecoes(
  id: number,
  excecoes: ExcecaoPermissao[],
): Promise<{ id: number; excecoes: ExcecaoPermissao[]; permissoesEfetivas: Permissao[] }> {
  const res = await apiFetch(`${API}/usuarios/${id}/permissoes`, {
    method: 'PUT',
    headers: await withAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ excecoes }),
  })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as {
    id: number
    excecoes: ExcecaoPermissao[]
    permissoesEfetivas: Permissao[]
  }
}

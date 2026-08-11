import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/** Papéis atribuíveis a um usuário da plataforma (espelha o backend). */
export type UserRole = 'admin' | 'operador'

/**
 * Ciclo de vida do acesso — espelha `ontology/state-machines/usuario.md`.
 *
 * `convidado` e `inativo` são **ambos `ativo = false`** no banco. Distingui-los na UI não é
 * cosmético: sem isso a tela ofereceria "reenviar convite" para quem foi DESLIGADO, e
 * "acesso revogado" para quem simplesmente ainda não entrou.
 */
export type UsuarioStatus = 'convidado' | 'ativo' | 'inativo'

/** Usuário da plataforma (sem senha) — o que a tela de gestão lista. */
export interface AppUser {
  id: number
  username: string
  role: UserRole
  ativo: boolean
  /** Derivado pelo backend a partir de `ativo` + `convite_pendente` (`GET /usuarios`). */
  status: UsuarioStatus
  /** `true` entre o convite e o aceite — "nunca entrou", não "acesso revogado". */
  convitePendente?: boolean
  createdBy?: string
  createdAt: string
  /** Login Conexos vinculado (ex.: MARILYN_MUTAFCI). Ausente = sem vínculo (opera via robô). */
  conexosUsername?: string
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

/** Quem é o usuário logado, SEGUNDO O BANCO (`GET /me`). */
export interface MeResponse {
  username: string | null
  role: string | null
}

/**
 * `GET /me` — a **fonte do papel no frontend** (ADR-0030 / Task 10).
 *
 * O papel NÃO pode vir do JWT: o token do GoTrue traz `role: 'authenticated'` para todo
 * mundo, então ler a claim faria `useIsAdmin()` retornar `false` para os PRÓPRIOS admins — e
 * a tela `/usuarios` e o card de admin sumiriam, sem erro, sem log e sem teste vermelho.
 */
export async function fetchMe(): Promise<MeResponse> {
  const res = await apiFetch(`${API}/me`, { headers: await withAuthHeaders() })
  if (!res.ok) throw await errorFrom(res)
  return (await res.json()) as MeResponse
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

/** POST /usuarios — cria um usuário (email + senha + papel + vínculo Conexos opcional). */
export async function criarUsuario(input: {
  username: string
  password: string
  role: UserRole
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

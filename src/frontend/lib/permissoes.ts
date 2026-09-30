import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/**
 * Catálogo de permissões — espelho do backend (`domain/interface/auth/Permission.ts`, ADR-0053).
 * Serve só para o front ESCONDER o que o servidor já recusaria: o gate real é o guard de cada rota
 * (I2). Um valor novo lá precisa entrar aqui para aparecer na tela; se não entrar, ele é
 * descartado ao ler `/me/permissoes`, e o item correspondente simplesmente não aparece.
 */
export const PERMISSAO = {
  PERMUTAS_VER: 'permutas:ver',
  PERMUTAS_EXECUTAR: 'permutas:executar',
  SISPAG_VER: 'sispag:ver',
  SISPAG_EXECUTAR: 'sispag:executar',
  /** Aprovar a conta (TED) digitada no item do lote (ADR-0054 D10). Avulsa, sem implicações. */
  SISPAG_APROVAR_DESTINO: 'sispag:aprovar_destino',
  RECEBIMENTOS_VER: 'recebimentos:ver',
  RECEBIMENTOS_EXECUTAR: 'recebimentos:executar',
  OPERACAO_VER: 'operacao:ver',
  METRICAS_VER: 'metricas:ver',
  USUARIOS_GERENCIAR: 'usuarios:gerenciar',
} as const

export type Permissao = (typeof PERMISSAO)[keyof typeof PERMISSAO]

/** O catálogo inteiro, na ordem de exibição (módulo, depois ver → executar). */
export const CATALOGO_PERMISSOES: readonly Permissao[] = [
  PERMISSAO.PERMUTAS_VER,
  PERMISSAO.PERMUTAS_EXECUTAR,
  PERMISSAO.SISPAG_VER,
  PERMISSAO.SISPAG_EXECUTAR,
  PERMISSAO.SISPAG_APROVAR_DESTINO,
  PERMISSAO.RECEBIMENTOS_VER,
  PERMISSAO.RECEBIMENTOS_EXECUTAR,
  PERMISSAO.OPERACAO_VER,
  PERMISSAO.METRICAS_VER,
  PERMISSAO.USUARIOS_GERENCIAR,
]

export const isPermissao = (valor: unknown): valor is Permissao =>
  typeof valor === 'string' && (CATALOGO_PERMISSOES as readonly string[]).includes(valor)

/** Papel resumido, como o backend devolve. */
export interface PapelRef {
  id: number
  nome: string
}

/** O que `GET /me/permissoes` diz sobre o usuário logado. */
export interface MinhasPermissoes {
  permissoes: Set<Permissao>
  papel?: PapelRef
}

/**
 * GET /me/permissoes. Valores fora do catálogo são descartados. Erro de rede ou 5xx rejeita (o
 * provider trata como fail-closed); 401 segue o caminho do `apiFetch` (modal de sessão).
 */
export async function fetchMinhasPermissoes(): Promise<MinhasPermissoes> {
  const res = await apiFetch(`${API}/me/permissoes`, { headers: await withAuthHeaders() })
  if (!res.ok) throw new Error(`Falha ao consultar permissões (HTTP ${res.status}).`)
  const body = (await res.json()) as { permissoes?: unknown; papel?: PapelRef }
  // Sem o array (resposta fora do contrato): conjunto vazio, fail-closed (ADR-0056 removeu o
  // fallback por `role` do token).
  if (!Array.isArray(body.permissoes)) return { permissoes: new Set() }
  return {
    permissoes: new Set(body.permissoes.filter(isPermissao)),
    ...(body.papel ? { papel: body.papel } : {}),
  }
}

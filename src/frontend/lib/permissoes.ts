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
  /**
   * `true` quando a resposta veio de um backend anterior à ADR-0053 (só `{ operacao }`, sem o
   * array `permissoes`) — janela de deploy (D4). Quem decide o que mostrar é o provider, pelo
   * `role` do token. Sai no tweak que remover a chave `operacao`.
   */
  legado: boolean
  /** A chave `operacao` do backend antigo, preservada para o fallback legado. */
  operacaoLegado?: boolean
}

/**
 * GET /me/permissoes. Valores fora do catálogo são descartados. Erro de rede ou 5xx rejeita (o
 * provider trata como fail-closed); 401 segue o caminho do `apiFetch` (modal de sessão).
 */
export async function fetchMinhasPermissoes(): Promise<MinhasPermissoes> {
  const res = await apiFetch(`${API}/me/permissoes`, { headers: await withAuthHeaders() })
  if (!res.ok) throw new Error(`Falha ao consultar permissões (HTTP ${res.status}).`)
  const body = (await res.json()) as {
    permissoes?: unknown
    papel?: PapelRef
    operacao?: unknown
  }
  if (!Array.isArray(body.permissoes)) {
    return { permissoes: new Set(), legado: true, operacaoLegado: body.operacao === true }
  }
  return {
    permissoes: new Set(body.permissoes.filter(isPermissao)),
    ...(body.papel ? { papel: body.papel } : {}),
    legado: false,
  }
}

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
  /**
   * Exceção de destino de pagamento (ADR-0061): cadastrar, aprovar, rejeitar e revogar. Permissão
   * única; a separação de funções é a regra "aprovador ≠ cadastrante" no backend. Avulsa.
   */
  SISPAG_EXCECAO: 'sispag:excecao',
  /** Conferência por segunda pessoa do lote com TED/PIX (ADR-0063). Avulsa. */
  SISPAG_CONFERIR: 'sispag:conferir',
  /** Fila "Pendências de cadastro" (ADR-0063). Avulsa. */
  SISPAG_CADASTRO: 'sispag:cadastro',
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
  PERMISSAO.SISPAG_EXCECAO,
  PERMISSAO.SISPAG_CONFERIR,
  PERMISSAO.SISPAG_CADASTRO,
  PERMISSAO.RECEBIMENTOS_VER,
  PERMISSAO.RECEBIMENTOS_EXECUTAR,
  PERMISSAO.OPERACAO_VER,
  PERMISSAO.METRICAS_VER,
  PERMISSAO.USUARIOS_GERENCIAR,
]

/** Uma permissão na tela: o código e o rótulo curto da ação ("ver", "executar", "gerenciar"). */
export interface ItemPermissao {
  permissao: Permissao
  acao: string
}

/**
 * Agrupamento e rótulos das permissões por módulo, na ordem da navegação. Fonte ÚNICA: a tela de
 * usuários (`EditarAcessoDialog`) e o perfil (`/perfil`) leem daqui. A Frente IV se chama
 * "Adiantamentos", o rótulo que o usuário já vê no nav.
 */
export const MODULOS: ReadonlyArray<{ nome: string; itens: ItemPermissao[] }> = [
  {
    nome: 'Permutas',
    itens: [
      { permissao: PERMISSAO.PERMUTAS_VER, acao: 'ver' },
      { permissao: PERMISSAO.PERMUTAS_EXECUTAR, acao: 'executar' },
    ],
  },
  {
    nome: 'SISPAG',
    itens: [
      { permissao: PERMISSAO.SISPAG_VER, acao: 'ver' },
      { permissao: PERMISSAO.SISPAG_EXECUTAR, acao: 'executar' },
      // ADR-0061: cadastra, aprova, rejeita e revoga exceções de destino. Não implica nem é implicada.
      { permissao: PERMISSAO.SISPAG_EXCECAO, acao: 'exceção de destino' },
      // ADR-0063: conferência por 2ª pessoa e fila de pendências de cadastro. Avulsas.
      { permissao: PERMISSAO.SISPAG_CONFERIR, acao: 'conferir' },
      { permissao: PERMISSAO.SISPAG_CADASTRO, acao: 'pendências de cadastro' },
    ],
  },
  {
    nome: 'Adiantamentos',
    itens: [
      { permissao: PERMISSAO.RECEBIMENTOS_VER, acao: 'ver' },
      { permissao: PERMISSAO.RECEBIMENTOS_EXECUTAR, acao: 'executar' },
    ],
  },
  { nome: 'Operação', itens: [{ permissao: PERMISSAO.OPERACAO_VER, acao: 'ver' }] },
  { nome: 'Métricas', itens: [{ permissao: PERMISSAO.METRICAS_VER, acao: 'ver' }] },
  { nome: 'Usuários', itens: [{ permissao: PERMISSAO.USUARIOS_GERENCIAR, acao: 'gerenciar' }] },
]

/** "Módulo — ação" de uma permissão (ex.: "SISPAG — exceção de destino"). */
export const rotuloPermissao = (permissao: Permissao): string => {
  for (const modulo of MODULOS) {
    const item = modulo.itens.find((i) => i.permissao === permissao)
    if (item) return `${modulo.nome} — ${item.acao}`
  }
  return permissao
}

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
  // Sem o array (resposta fora do contrato): conjunto vazio, fail-closed (ADR-0057 removeu o
  // fallback por `role` do token).
  if (!Array.isArray(body.permissoes)) return { permissoes: new Set() }
  return {
    permissoes: new Set(body.permissoes.filter(isPermissao)),
    ...(body.papel ? { papel: body.papel } : {}),
  }
}

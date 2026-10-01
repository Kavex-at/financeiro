import { withAuthHeaders } from '../auth/token'
import { apiFetch } from '../http'
import type { Permissao } from '../permissoes'

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

/**
 * Cliente do perfil pessoal (ADR-0058): `GET /me`, `GET /me/atividade`, `GET /me/historico`.
 * Só leitura, sobre o `apiFetch` (401 → modal de sessão; 503 nunca desloga, vira erro da seção).
 * O alvo é SEMPRE a sessão: nenhuma função aceita id de usuário.
 */

export type FrenteAtividade = 'permutas' | 'sispag' | 'recebimentos' | 'plataforma'
export type StatusAtividade = 'sucesso' | 'erro' | 'em_andamento' | 'cancelado' | 'info'
export type TipoPeriodo = 'hoje' | 'semana' | 'mes' | 'personalizado'
export type OrigemPermissao = 'papel' | 'concedida' | 'revogada' | 'implicada'

export interface PermissaoComOrigem {
  codigo: Permissao
  efetiva: boolean
  origem: OrigemPermissao
  por?: string
  em?: string
  implicadaPor?: Permissao
}

export interface Perfil {
  username: string
  email: string | null
  ativo: boolean
  membroDesde: string
  criadoPor: string | null
  papel: { id: number; nome: string; descricao: string | null }
  conexos: { vinculado: boolean; conexosUsername: string | null }
  permissoes: PermissaoComOrigem[]
}

export interface AgregadosPermutas {
  concluidas: number
  parciais: number
  valorBaixado: number
  aguardandoBordero: number
  comErro: number
}

export interface AgregadosSispag {
  lotesFinalizados: number
  remessasGeradas: number
  valorRemessado: number
  valorAgendado: number
  valorPagoConfirmado: number
  retornosConciliados: number
  comErro: number
}

export interface AgregadosRecebimentos {
  concluidas: number
  valor: number
  comErro: number
}

export interface AtualEAnterior<T> {
  atual: T
  anterior: T
}

export interface Atividade {
  periodo: { tipo: TipoPeriodo; inicio: string; fim: string }
  periodoAnterior: { inicio: string; fim: string }
  permutas: AtualEAnterior<AgregadosPermutas>
  sispag: AtualEAnterior<AgregadosSispag>
  recebimentos: AtualEAnterior<AgregadosRecebimentos>
}

export interface DetalheAtividade {
  parcial?: boolean
  filCod?: number
  conexosUsername?: string
  loteId?: string
  invoiceDocCod?: string
  docCod?: string
  tipoAlerta?: string
  alvoAlerta?: string
  tipoAcesso?: string
  outroUsername?: string
}

export interface LinhaHistorico {
  em: string
  frente: FrenteAtividade
  acao: string
  alvoTipo: string
  alvoId: string
  valor?: number
  status: StatusAtividade
  fonte: string
  fonteId: string
  detalhe: DetalheAtividade
}

export interface PaginaHistorico {
  itens: LinhaHistorico[]
  proximoCursor?: string
}

export interface ConsultaAtividade {
  periodo: TipoPeriodo
  inicio?: string
  fim?: string
}

export interface FiltrosHistorico {
  frente?: FrenteAtividade
  status?: StatusAtividade
  inicio?: string
  fim?: string
  cursor?: string
}

/** Erro HTTP do perfil, com o status (a tela distingue 503 "não foi possível verificar"). */
export class PerfilApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PerfilApiError'
  }
}

const query = (params: object): string => {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v !== '') qs.set(k, v)
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

const lerJson = async <T>(caminho: string): Promise<T> => {
  const res = await apiFetch(`${API}${caminho}`, { headers: await withAuthHeaders() })
  if (!res.ok) {
    let mensagem = `Falha ao carregar (HTTP ${res.status}).`
    try {
      const body = (await res.json()) as { error?: string }
      if (body?.error) mensagem = body.error
    } catch {
      /* corpo sem JSON — fica a mensagem genérica */
    }
    throw new PerfilApiError(mensagem, res.status)
  }
  return (await res.json()) as T
}

export const getPerfil = (): Promise<Perfil> => lerJson<Perfil>('/me')

export const getAtividade = (consulta: ConsultaAtividade): Promise<Atividade> =>
  lerJson<Atividade>(`/me/atividade${query(consulta)}`)

export const getHistorico = (filtros: FiltrosHistorico): Promise<PaginaHistorico> =>
  lerJson<PaginaHistorico>(`/me/historico${query(filtros)}`)

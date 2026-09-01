import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'

/**
 * Painel de Operação (ADR-0042) — cliente de `GET /operacao`.
 *
 * Os tipos espelham `src/backend/domain/interface/operacao/*.ts`. O front NÃO importa do backend
 * (boundary), então os union types são replicados aqui, um a um — mesma convenção de
 * `lib/recebimentos.ts`.
 *
 * Sem fixture de segurança, ao contrário dos outros painéis: uma tela de operação que finge estar
 * saudável quando a API não responde é pior do que uma tela quebrada. Se a leitura falha, a tela
 * diz que falhou.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

export type JobRunStatus = 'running' | 'success' | 'partial' | 'error'

/** `sem-trilha` = o job roda mas não escreve linha de run (hoje o reaper do SISPAG). */
export type SituacaoPipeline = 'ok' | 'parado' | 'nunca-executou' | 'sem-trilha'

export type AlertaTipo = 'job-falhou' | 'job-parcial' | 'job-parado' | 'config-ausente'
export type AlertaSeveridade = 'aviso' | 'erro'

export type EstadoConfig = 'configurado' | 'ausente' | 'usando-default'
export type Criticidade = 'obrigatoria' | 'degrada-silenciosamente' | 'opcional'

export interface JobRun {
  runId: string
  pipeline: string
  status: JobRunStatus
  triggeredBy: string
  startedAt: string
  finishedAt?: string
  duracaoMs?: number
  metricas: Record<string, number>
  errorMessage?: string
}

export interface PipelineSaude {
  pipeline: string
  rotulo: string
  cadencia: string
  ultimaRun?: JobRun
  ultimoSucessoEm?: string
  idadeDesdeUltimoSucessoMs?: number
  limiteStalenessMs?: number
  situacao: SituacaoPipeline
  /** `false` = a FONTE não distingue `partial`. Cegueira herdada, não sinal de saúde. */
  distinguePartial: boolean
  runsRecentes: JobRun[]
}

export interface Alerta {
  id: number
  tipo: AlertaTipo
  alvo: string
  severidade: AlertaSeveridade
  detalhe: Record<string, unknown>
  criadoEm: string
  notificadoEm?: string
}

export interface DiagnosticoVar {
  nome: string
  frente: string
  criticidade: Criticidade
  estado: EstadoConfig
  consequenciaSeAusente: string
  segredo: boolean
  default?: string
}

export interface DiagnosticoConfig {
  geradoEm: string
  vars: DiagnosticoVar[]
  totalAusentesObrigatorias: number
  totalAusentesSilenciosas: number
}

export interface OperacaoPainel {
  geradoEm: string
  pipelines: PipelineSaude[]
  alertas: Alerta[]
  configuracao: DiagnosticoConfig
}

export async function fetchOperacao(): Promise<OperacaoPainel> {
  const res = await apiFetch(`${API}/operacao`, { headers: await withAuthHeaders() })
  if (!res.ok) throw new Error(`Falha ao carregar o painel de operação (HTTP ${res.status}).`)
  return (await res.json()) as OperacaoPainel
}

export async function reconhecerAlerta(id: number): Promise<void> {
  const res = await apiFetch(`${API}/operacao/alertas/${id}/reconhecer`, {
    method: 'POST',
    headers: await withAuthHeaders(),
  })
  if (!res.ok) throw new Error(`Não foi possível reconhecer o alerta (HTTP ${res.status}).`)
}

/** "há 4h 12min" — a idade importa mais que o timestamp numa tela de incidente. */
export function formatarIdade(ms?: number): string {
  if (ms === undefined) return '—'
  if (ms < 60_000) return 'agora há pouco'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `há ${min}min`
  const h = Math.floor(min / 60)
  const restoMin = min % 60
  if (h < 24) return restoMin === 0 ? `há ${h}h` : `há ${h}h ${restoMin}min`
  const d = Math.floor(h / 24)
  const restoH = h % 24
  return restoH === 0 ? `há ${d}d` : `há ${d}d ${restoH}h`
}

/** Duração legível de uma run. */
export function formatarDuracao(ms?: number): string {
  if (ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  return `${min}min ${s % 60}s`
}

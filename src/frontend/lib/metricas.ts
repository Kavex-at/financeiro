import { withAuthHeaders } from './auth/token'
import { apiFetch } from './http'

/**
 * Métricas do ciclo (ADR-0045) — cliente de `GET /metricas/ciclo`.
 *
 * O tipo espelha `src/backend/domain/interface/metricas/MetricaCiclo.ts`, em snake_case, porque é o
 * contrato da view que o `kavex-report-ciclo` também lê. O front NÃO importa do backend (boundary).
 *
 * Datas chegam como `YYYY-MM-DDTHH:MM:SS` em horário de São Paulo, SEM fuso. Por isso a formatação
 * aqui corta a string em vez de passar por `new Date()`: o navegador interpretaria como hora local
 * da máquina e uma pessoa fora do Brasil veria outra semana.
 */

const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '')

export interface MetricaCiclo {
  frente: string
  metrica: string
  rotulo: string
  valor: number
  unidade: string
  janela_inicio: string
  janela_fim: string
  baseline: number | null
  baseline_desc: string
  /** Semana em curso, ainda não fechada: o número vale até `apurado_ate` e muda até sexta 18:00. */
  parcial: boolean
  /** Até quando a linha foi apurada: o fim da semana, ou o momento da leitura se parcial. */
  apurado_ate: string
}

export interface MetricasCicloLeitura {
  serieInicio: string
  metricas: MetricaCiclo[]
}

/** Chaves estáveis de `metrica` — nunca renomeadas (ADR-0045). */
export const METRICA = {
  PERMUTAS_PCT: 'permutas_baixas_concluidas_pct',
  PERMUTAS_RS: 'permutas_valor_baixado',
  RECEBIMENTOS_PCT: 'recebimentos_alocacoes_concluidas_pct',
  RECEBIMENTOS_RS: 'recebimentos_valor_alocado',
} as const

export async function fetchMetricasCiclo(): Promise<MetricasCicloLeitura> {
  const res = await apiFetch(`${API}/metricas/ciclo`, { headers: await withAuthHeaders() })
  if (!res.ok) throw new Error(`Falha ao carregar as métricas (HTTP ${res.status}).`)
  return (await res.json()) as MetricasCicloLeitura
}

/** Uma semana (fechada ou em curso), com as métricas indexadas pela chave. */
export interface SemanaMetricas {
  janelaInicio: string
  janelaFim: string
  parcial: boolean
  apuradoAte: string
  porChave: Partial<Record<string, MetricaCiclo>>
}

/** Agrupa as linhas por janela, da semana mais recente para a mais antiga. */
export function agruparPorSemana(metricas: MetricaCiclo[]): SemanaMetricas[] {
  const semanas = new Map<string, SemanaMetricas>()
  for (const m of metricas) {
    const semana = semanas.get(m.janela_inicio) ?? {
      janelaInicio: m.janela_inicio,
      janelaFim: m.janela_fim,
      parcial: m.parcial,
      apuradoAte: m.apurado_ate,
      porChave: {},
    }
    semana.porChave[m.metrica] = m
    semanas.set(m.janela_inicio, semana)
  }
  return [...semanas.values()].sort((a, b) => b.janelaInicio.localeCompare(a.janelaInicio))
}

/** `2026-09-11T18:00:00` → `11/09` (ou `11/09/2026` com ano). Sem `Date`: ver o cabeçalho. */
export function formatarDiaLocal(dataLocal: string, comAno = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataLocal)
  if (!m) return '—'
  return comAno ? `${m[3]}/${m[2]}/${m[1]}` : `${m[3]}/${m[2]}`
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/**
 * `2026-09-18T15:02:00` → `sex 18/09, 15:02` — o horário de corte de uma semana parcial. O dia da
 * semana sai de `Date.UTC` sobre os números da string, não de `new Date(string)`: nenhuma conversão de
 * fuso entra no caminho.
 */
export function formatarMomentoLocal(dataLocal: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(dataLocal)
  if (!m) return '—'
  const dia = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${DIAS_SEMANA[dia]} ${m[3]}/${m[2]}, ${m[4]}:${m[5]}`
}

/** Valor de uma linha na unidade dela; `—` quando a métrica não existe na semana. */
export function formatarMetrica(m: MetricaCiclo | undefined): string {
  if (!m) return '—'
  if (m.unidade === 'R$') {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(m.valor)
  }
  if (m.unidade === '%') {
    return `${m.valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
  }
  return m.valor.toLocaleString('pt-BR')
}

/** O absoluto que o backend embute no rótulo do `%` ("12 de 13 tentativas"). */
export function absolutoDoRotulo(rotulo: string): string | undefined {
  const i = rotulo.lastIndexOf(' — ')
  return i >= 0 ? rotulo.slice(i + 3) : undefined
}

import type { ConsultaAtividade, TipoPeriodo } from '@/lib/api/perfil'

/** Chave do período escolhido em "Minha atividade" (preferência por navegador). */
export const CHAVE_PERIODO = 'perfil.atividade.periodo'

export const ROTULO_PERIODO: Record<TipoPeriodo, string> = {
  hoje: 'Hoje',
  // A semana é a de /metricas: começa na sexta às 18:00 (horário de São Paulo). Dizer isso na tela
  // evita que "esta semana" numa segunda de manhã pareça um bug.
  semana: 'Esta semana (desde sex 18:00)',
  mes: 'Este mês',
  personalizado: 'Personalizado',
}

export const PERIODO_PADRAO: ConsultaAtividade = { periodo: 'semana' }

const TIPOS: readonly TipoPeriodo[] = ['hoje', 'semana', 'mes', 'personalizado']
const DIA = /^\d{4}-\d{2}-\d{2}$/

/** Lê a preferência. `localStorage` falha em modo privado e com storage bloqueado: nunca derruba. */
export const lerPeriodo = (): ConsultaAtividade => {
  try {
    const raw = window.localStorage.getItem(CHAVE_PERIODO)
    if (!raw) return PERIODO_PADRAO
    const v = JSON.parse(raw) as Partial<ConsultaAtividade>
    if (!v.periodo || !TIPOS.includes(v.periodo)) return PERIODO_PADRAO
    if (v.periodo !== 'personalizado') return { periodo: v.periodo }
    if (v.inicio && v.fim && DIA.test(v.inicio) && DIA.test(v.fim)) {
      return { periodo: 'personalizado', inicio: v.inicio, fim: v.fim }
    }
  } catch {
    /* storage indisponível ou valor torto — segue com o padrão */
  }
  return PERIODO_PADRAO
}

export const gravarPeriodo = (consulta: ConsultaAtividade): void => {
  try {
    window.localStorage.setItem(CHAVE_PERIODO, JSON.stringify(consulta))
  } catch {
    /* storage indisponível — a escolha vale só para esta visita */
  }
}

/** "há 2 horas" — relativo ao agora, em pt-BR. */
export const tempoRelativo = (iso: string, agora: number = Date.now()): string => {
  const seg = Math.round((new Date(iso).getTime() - agora) / 1000)
  const fmt = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' })
  const abs = Math.abs(seg)
  if (abs < 60) return fmt.format(seg, 'second')
  if (abs < 3600) return fmt.format(Math.round(seg / 60), 'minute')
  if (abs < 86_400) return fmt.format(Math.round(seg / 3600), 'hour')
  if (abs < 30 * 86_400) return fmt.format(Math.round(seg / 86_400), 'day')
  return fmt.format(Math.round(seg / (30 * 86_400)), 'month')
}

/** Data e hora absolutas no horário de São Paulo ("01/10/2026 14:02"). */
export const momentoSp = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Só a data, no horário de São Paulo ("01/08/2026"). */
export const diaSp = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

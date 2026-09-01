import { Badge } from '@/components/ui/badge'
import type { AlertaSeveridade, EstadoConfig, JobRunStatus, SituacaoPipeline } from '@/lib/operacao'

/**
 * Badges do Painel de Operação.
 *
 * A regra que governa todos: **ausência de sinal nunca é pintada como saúde.** `nunca-executou` e
 * `sem-trilha` têm chip próprio em vez de caírem no verde por omissão — um pipeline que jamais
 * teve sucesso não é saudável, é desconhecido, e a diferença é a coisa mais importante da tela.
 */

const SITUACAO: Record<SituacaoPipeline, { texto: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; classe?: string }> = {
  ok: { texto: 'Em dia', variant: 'outline', classe: 'border-success text-success' },
  parado: { texto: 'Parado', variant: 'destructive' },
  'nunca-executou': {
    texto: 'Nunca executou',
    variant: 'outline',
    classe: 'border-warning text-warning-foreground',
  },
  'sem-trilha': { texto: 'Sem trilha', variant: 'secondary' },
}

export function SituacaoBadge({ situacao }: { situacao: SituacaoPipeline }) {
  const s = SITUACAO[situacao]
  return (
    <Badge variant={s.variant} className={s.classe}>
      {s.texto}
    </Badge>
  )
}

const RUN_STATUS: Record<JobRunStatus, { texto: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; classe?: string }> = {
  success: { texto: 'sucesso', variant: 'outline', classe: 'border-success text-success' },
  partial: { texto: 'parcial', variant: 'outline', classe: 'border-warning text-warning-foreground' },
  error: { texto: 'erro', variant: 'destructive' },
  running: { texto: 'rodando', variant: 'secondary' },
}

export function RunStatusBadge({ status }: { status?: JobRunStatus }) {
  if (status === undefined) return <span className="text-muted-foreground">—</span>
  const s = RUN_STATUS[status]
  return (
    <Badge variant={s.variant} className={s.classe}>
      {s.texto}
    </Badge>
  )
}

export function SeveridadeBadge({ severidade }: { severidade: AlertaSeveridade }) {
  return severidade === 'erro' ? (
    <Badge variant="destructive">erro</Badge>
  ) : (
    <Badge variant="outline" className="border-warning text-warning-foreground">
      aviso
    </Badge>
  )
}

const ESTADO: Record<EstadoConfig, { texto: string; classe: string }> = {
  configurado: { texto: 'configurado', classe: 'border-success text-success' },
  ausente: { texto: 'ausente', classe: 'border-danger text-danger' },
  'usando-default': { texto: 'usando default', classe: 'border-border text-muted-foreground' },
}

export function EstadoConfigBadge({ estado }: { estado: EstadoConfig }) {
  const e = ESTADO[estado]
  return (
    <Badge variant="outline" className={e.classe}>
      {e.texto}
    </Badge>
  )
}

'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import type { ArqNodeData, Frente, Maturidade } from '@/lib/arquitetura'
import { cn } from '@/lib/utils'

/**
 * Barra de acento por frente — o eixo horizontal do diagrama já separa as
 * frentes; a cor reforça a leitura quando o usuário está com zoom alto.
 */
const ACENTO_FRENTE: Record<Frente, string> = {
    permutas: 'bg-primary',
    sispag: 'bg-origem-adto-forn-int',
    recebimentos: 'bg-origem-adto-cli-nac',
    plataforma: 'bg-muted-foreground',
}

/**
 * Tratamento visual por maturidade. Traço contínuo = existe e roda; tracejado =
 * não existe ainda. É a distinção mais importante da página, porque as
 * frentes estão em estágios diferentes.
 */
const ESTILO_MATURIDADE: Record<Maturidade, string> = {
    implementado: 'border-border bg-card',
    parcial: 'border-warning bg-card',
    planejado: 'border-info border-dashed bg-info-subtle/40',
    inexistente: 'border-danger border-dashed bg-danger-subtle/30',
    orfao: 'border-muted-foreground/50 border-dashed bg-muted/40',
}

const BADGE_MATURIDADE: Record<Maturidade, { label: string; className: string }> = {
    implementado: { label: 'em produção', className: 'bg-success-subtle text-success-foreground' },
    parcial: { label: 'parcial', className: 'bg-warning-subtle text-warning-foreground' },
    planejado: { label: 'planejado', className: 'bg-info-subtle text-info-foreground' },
    inexistente: { label: 'não existe', className: 'bg-danger-subtle text-danger-foreground' },
    orfao: { label: 'órfão', className: 'bg-muted text-muted-foreground' },
}

export function ArquiteturaNode({ data, selected }: NodeProps & { data: ArqNodeData }) {
    const badge = BADGE_MATURIDADE[data.maturidade]
    const temRiscoCritico = data.riscos?.some((r) => r.nivel === 'critico') ?? false
    const temRisco = (data.riscos?.length ?? 0) > 0

    return (
        <button
            type="button"
            className={cn(
                'relative flex w-[230px] gap-0 overflow-hidden rounded-lg border-2 text-left shadow-sm transition',
                'hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                ESTILO_MATURIDADE[data.maturidade],
                selected && 'ring-2 ring-ring ring-offset-2',
            )}
            aria-label={`${data.label} — ${badge.label}. Clique para ver detalhes.`}
        >
            <Handle type="target" position={Position.Left} className="!size-2 !border-none !bg-muted-foreground" />

            <span className={cn('w-1.5 shrink-0 self-stretch', ACENTO_FRENTE[data.frente])} aria-hidden />

            <span className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5">
                <span className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-semibold leading-snug text-foreground">
                        {data.label}
                    </span>
                    {temRisco ? (
                        <AlertTriangle
                            className={cn(
                                'mt-0.5 size-3.5 shrink-0',
                                temRiscoCritico ? 'text-danger' : 'text-warning',
                            )}
                            aria-label={temRiscoCritico ? 'Risco crítico' : 'Risco registrado'}
                        />
                    ) : null}
                </span>

                {data.subtitle ? (
                    <span className="text-[11px] leading-tight text-muted-foreground">{data.subtitle}</span>
                ) : null}

                <span
                    className={cn(
                        'mt-0.5 w-fit rounded-full px-1.5 py-px text-[10px] font-medium uppercase tracking-wide',
                        badge.className,
                    )}
                >
                    {badge.label}
                </span>
            </span>

            <Handle type="source" position={Position.Right} className="!size-2 !border-none !bg-muted-foreground" />
        </button>
    )
}

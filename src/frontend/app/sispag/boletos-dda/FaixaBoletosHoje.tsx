'use client'

import { CalendarClock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { BoletoDda } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { SITUACAO_BADGE } from './rotulosDda'

/**
 * Faixa sob os cards (padrão `FaixaBloqueadosHoje`): os boletos NÃO casados que vencem hoje (até
 * 4, vindos do servidor) e "Ver só estes". Tom de alerta, não de perigo: boleto sem título hoje
 * não é pagamento nosso perdido. Confirmar continua na gaveta do título.
 */
export function FaixaBoletosHoje({
  amostra,
  total,
  onVerSoEstes,
  onVerCandidatos,
}: {
  amostra: BoletoDda[]
  total: number
  onVerSoEstes: () => void
  onVerCandidatos: (b: BoletoDda) => void
}) {
  if (total <= 0) return null
  return (
    <section
      aria-label="Boletos não casados que vencem hoje"
      className="space-y-2 rounded-lg border border-warning/40 bg-warning-subtle/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-warning-foreground">
          <CalendarClock className="size-4" aria-hidden />
          {total.toLocaleString('pt-BR')} boleto(s) não casado(s) vencem hoje
        </p>
        <Button size="sm" variant="outline" onClick={onVerSoEstes}>
          Ver só estes
        </Button>
      </div>
      <ul className="divide-y text-sm">
        {amostra.map((b) => {
          const principal = b.vinculo ?? b.candidatos[0]
          const badge = SITUACAO_BADGE[b.situacao]
          return (
            <li key={`${b.ddcCod}:${b.ditCod}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="font-medium tabular-nums">{b.numero ?? '—'}</span>
              <span className="tabular-nums">{formatBRL(b.valor)}</span>
              <span className="min-w-0 max-w-[16rem] truncate text-muted-foreground">
                {principal?.credor ?? 'sem título'}
              </span>
              <Badge variant="outline" className={badge.className} title={badge.title}>
                {badge.label}
              </Badge>
              {b.candidatos.length > 1 ? (
                <Button
                  size="sm"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => onVerCandidatos(b)}
                  aria-label={`Ver os ${b.candidatos.length} títulos candidatos do boleto ${b.numero ?? b.ditCod}`}
                >
                  Ver candidatos
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {total > amostra.length ? (
        <p className="text-xs text-muted-foreground">
          E mais {(total - amostra.length).toLocaleString('pt-BR')} na tabela.
        </p>
      ) : null}
    </section>
  )
}

'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TituloAPagar } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { AcaoDoTitulo } from './AcaoDoTitulo'
import { ROTULO_DONO } from './rotulos'
import { donoDe, rotuloSituacao, somar } from './situacaoTitulos'

/** Quantos títulos a faixa lista; o resto fica na tabela, atrás do botão "Ver só estes". */
export const MAXIMO_NA_FAIXA = 4

/**
 * Faixa vermelha sob os cards (decisão D2): só os bloqueados que vencem HOJE. Vencidos ficam de
 * fora (já têm o filtro "Vencidos"). Cada linha traz o motivo, quem resolve e o botão da ação.
 */
export function FaixaBloqueadosHoje({
  titulos,
  dataHoje,
  podeExecutar,
  onVerSoEstes,
  onVerBoleto,
  onResolvido,
}: {
  /** Já filtrados: bloqueados com `diasAteVencimento === 0`. */
  titulos: TituloAPagar[]
  /** `dd/mm/aaaa` do dia, para o título da faixa. */
  dataHoje: string
  podeExecutar: boolean
  onVerSoEstes: () => void
  onVerBoleto: (t: TituloAPagar) => void
  onResolvido: () => void | Promise<void>
}) {
  if (titulos.length === 0) return null
  const total = somar(titulos)
  const visiveis = titulos.slice(0, MAXIMO_NA_FAIXA)
  return (
    <section
      aria-label="Bloqueados que vencem hoje"
      className="space-y-2 rounded-lg border border-danger/40 bg-danger-subtle/40 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-danger-foreground">
        <p className="flex items-center gap-2 text-sm">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            <strong>
              {total.qtd} bloqueado{total.qtd > 1 ? 's' : ''} vence{total.qtd > 1 ? 'm' : ''} hoje (
              {dataHoje}) · {formatBRL(total.valor)}
            </strong>{' '}
            Sem ação hoje, {total.qtd > 1 ? 'não saem' : 'não sai'} no pagamento do dia.
          </span>
        </p>
        <Button size="sm" variant="outline" onClick={onVerSoEstes}>
          Ver só {total.qtd > 1 ? `estes ${total.qtd}` : 'este'}
        </Button>
      </div>
      <ul className="grid gap-2 lg:grid-cols-2">
        {visiveis.map((t) => (
          <li
            key={`${t.filCod}:${t.docCod}:${t.titCod}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-3 py-2"
          >
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">
                {t.credor ?? '—'} · {formatBRL(t.valor)}
              </p>
              <p className="text-xs text-muted-foreground">
                {rotuloSituacao(t)} · resolve: {ROTULO_DONO[donoDe(t)].toLowerCase()}
              </p>
            </div>
            <AcaoDoTitulo
              titulo={t}
              podeExecutar={podeExecutar}
              onVerBoleto={onVerBoleto}
              onResolvido={onResolvido}
            />
          </li>
        ))}
      </ul>
      {titulos.length > visiveis.length ? (
        <p className="text-xs text-danger-foreground">
          + {titulos.length - visiveis.length} na tabela abaixo.
        </p>
      ) : null}
    </section>
  )
}

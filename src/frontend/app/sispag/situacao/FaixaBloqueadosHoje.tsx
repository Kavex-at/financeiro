'use client'

import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TituloAPagar } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { AcaoDoTitulo } from './AcaoDoTitulo'
import { ROTULO_DONO } from './rotulos'
import { causaDoPrazo, ROTULO_PERDIDO } from './prazoTitulo'
import { donoDe, rotuloSituacao, somar } from './situacaoTitulos'

/** Quantos títulos a faixa lista; o resto fica na tabela, atrás do botão "Ver só estes". */
export const MAXIMO_NA_FAIXA = 4

/**
 * Faixa vermelha sob os cards (decisão D2): só os bloqueados cujo PRAZO EFETIVO é hoje (I19t: o
 * boleto sugerido pode antecipar o título). Vencidos ficam de fora (já têm o filtro "Vencidos").
 * Cada linha traz o motivo, quem resolve e o botão da ação. O boleto PERDIDO tem uma lista
 * separada, fora do "pagamento do dia": é resolver no portal do banco, não confirmar boleto.
 */
export function FaixaBloqueadosHoje({
  titulos,
  perdidos = [],
  dataHoje,
  podeExecutar,
  onVerSoEstes,
  onVerBoleto,
  onResolvido,
}: {
  /** Já filtrados: bloqueados com prazo efetivo hoje (`bloqueadosQueVencemHoje`). */
  titulos: TituloAPagar[]
  /** Bloqueados com boleto perdido (`bloqueadosPerdidos`): linha separada, sem botão de boleto. */
  perdidos?: TituloAPagar[]
  /** `dd/mm/aaaa` do dia, para o título da faixa. */
  dataHoje: string
  podeExecutar: boolean
  onVerSoEstes: () => void
  onVerBoleto: (t: TituloAPagar) => void
  onResolvido: () => void | Promise<void>
}) {
  if (titulos.length === 0 && perdidos.length === 0) return null
  return (
    <div className="space-y-2">
      {titulos.length > 0 ? (
        <VencemHoje
          titulos={titulos}
          dataHoje={dataHoje}
          podeExecutar={podeExecutar}
          onVerSoEstes={onVerSoEstes}
          onVerBoleto={onVerBoleto}
          onResolvido={onResolvido}
        />
      ) : null}
      {perdidos.length > 0 ? <Perdidos titulos={perdidos} /> : null}
    </div>
  )
}

function VencemHoje({
  titulos,
  dataHoje,
  podeExecutar,
  onVerSoEstes,
  onVerBoleto,
  onResolvido,
}: {
  titulos: TituloAPagar[]
  dataHoje: string
  podeExecutar: boolean
  onVerSoEstes: () => void
  onVerBoleto: (t: TituloAPagar) => void
  onResolvido: () => void | Promise<void>
}) {
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
              {causaDoPrazo(t) ? (
                <p className="text-xs font-medium text-danger-foreground">{causaDoPrazo(t)}</p>
              ) : null}
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

/** Boleto perdido (I19t(5)): fora do pagamento do dia; resolver no portal do banco. */
function Perdidos({ titulos }: { titulos: TituloAPagar[] }) {
  const total = somar(titulos)
  return (
    <section
      aria-label="Boletos perdidos"
      className="space-y-2 rounded-lg border border-warning/40 bg-warning-subtle/40 p-3"
    >
      <p className="flex items-center gap-2 text-sm text-warning-foreground">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        <span>
          <strong>
            {total.qtd} com boleto perdido · {formatBRL(total.valor)}
          </strong>{' '}
          Não {total.qtd > 1 ? 'saem' : 'sai'} no pagamento do dia. {ROTULO_PERDIDO}.
        </span>
      </p>
      <ul className="grid gap-2 lg:grid-cols-2">
        {titulos.slice(0, MAXIMO_NA_FAIXA).map((t) => (
          <li
            key={`${t.filCod}:${t.docCod}:${t.titCod}`}
            className="rounded-md border bg-card px-3 py-2 text-sm"
          >
            <p className="truncate font-medium">
              {t.credor ?? '—'} · {formatBRL(t.valor)}
            </p>
            <p className="text-xs text-muted-foreground">
              {rotuloSituacao(t)} · {ROTULO_PERDIDO}
            </p>
          </li>
        ))}
      </ul>
      {titulos.length > MAXIMO_NA_FAIXA ? (
        <p className="text-xs text-warning-foreground">
          + {titulos.length - MAXIMO_NA_FAIXA} no filtro &quot;Vencidos&quot;.
        </p>
      ) : null}
    </section>
  )
}

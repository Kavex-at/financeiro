'use client'

import { ChevronDown, LogOut } from 'lucide-react'
import * as React from 'react'
import type { GrupoNoLote, ItemLote } from '@/lib/sispag'
import { formatBRL, formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import { orientacaoSituacaoGrupo, rotuloSituacaoGrupo } from './grupoBoleto'

/** Selo da situação do grupo (derivada pelo servidor): cor e texto, nunca só cor. */
export function SituacaoGrupoBadge({ situacao }: { situacao: string }) {
  const classe =
    situacao === 'REJEITADO' || situacao === 'ORFAO'
      ? 'border-danger/40 bg-danger-subtle text-danger-foreground'
      : situacao === 'DIVERGENTE' || situacao === 'RETIDO'
        ? 'border-warning/40 bg-warning-subtle text-warning-foreground'
        : situacao === 'PAGO'
          ? 'border-success/40 text-success'
          : situacao === 'EM_LOTE' || situacao === 'EM_REMESSA'
            ? 'border-info/40 text-info'
            : 'text-muted-foreground'
  return (
    <Badge variant="outline" className={classe}>
      {rotuloSituacaoGrupo(situacao)}
    </Badge>
  )
}

/**
 * O boleto agrupado no lote é UMA linha (ADR-0077, I21j): boleto mascarado, total, credor,
 * vencimento do boleto e situação; os N títulos aparecem ao expandir. Retirar age no grupo
 * inteiro: não há ação por título. Só a máscara 5+4 do boleto chega à tela.
 */
export function GrupoBoletoLinha({
  grupo,
  itens,
  onRetirar,
  ocupado = false,
  colunasExtras = 1,
}: {
  grupo: GrupoNoLote
  /** Os itens do lote (o componente pega os do grupo): valor e divergência de cada título. */
  itens: readonly ItemLote[]
  /** Ausente = sem ação (sem `sispag:executar`, ou lote que não é rascunho). */
  onRetirar?: (grupo: GrupoNoLote) => void
  ocupado?: boolean
  /** Colunas opcionais da tabela do lote além das cinco fixas: a última célula as cobre. */
  colunasExtras?: number
}) {
  const [aberto, setAberto] = React.useState(false)
  const detalheId = React.useId()
  const doGrupo = itens.filter((i) =>
    grupo.titulos.some(
      (t) => t.filCod === i.filCod && t.docCod === i.docCod && t.titCod === i.titCod,
    ),
  )
  const n = grupo.titulos.length
  const orientacao = orientacaoSituacaoGrupo(grupo.situacao)

  return (
    <>
      <TableRow data-grupo-id={grupo.grupoId}>
        <TableCell className="max-w-[16rem]">
          <span className="block truncate">{grupo.credor ?? '—'}</span>
          {orientacao ? (
            <span className="block text-xs text-muted-foreground">{orientacao}</span>
          ) : null}
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Boleto agrupado</span>
            <span className="font-medium tabular-nums">{grupo.codbarMascarado}</span>
            <button
              type="button"
              className="flex w-fit items-center gap-1 text-xs text-primary underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              aria-expanded={aberto}
              aria-controls={detalheId}
              aria-label={`${aberto ? 'Ocultar' : 'Mostrar'} os ${n} títulos do boleto agrupado`}
              onClick={() => setAberto((v) => !v)}
            >
              <ChevronDown
                className={`size-3 transition-transform ${aberto ? 'rotate-180' : ''}`}
                aria-hidden
              />
              {n} títulos
            </button>
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums">{formatBRL(grupo.valorBoleto)}</TableCell>
        <TableCell className="tabular-nums">{formatDate(grupo.vencimentoBoleto)}</TableCell>
        <TableCell>
          <SituacaoGrupoBadge situacao={grupo.situacao} />
        </TableCell>
        {onRetirar && colunasExtras > 0 ? (
          <TableCell colSpan={colunasExtras} className="text-right">
            <Button
              size="sm"
              variant="outline"
              disabled={ocupado}
              aria-label={`Retirar boleto agrupado ${grupo.codbarMascarado}`}
              onClick={() => onRetirar(grupo)}
            >
              <LogOut aria-hidden />
              Retirar
            </Button>
          </TableCell>
        ) : null}
      </TableRow>
      {aberto ? (
        <TableRow id={detalheId} className="bg-muted/30">
          <TableCell colSpan={5 + colunasExtras}>
            <ul className="flex flex-col gap-1 text-sm">
              {grupo.titulos.map((t) => {
                const item = doGrupo.find((i) => i.docCod === t.docCod && i.titCod === t.titCod)
                return (
                  <li
                    key={`${t.filCod}:${t.docCod}:${t.titCod}`}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <span className="tabular-nums">
                      {t.docCod}/{t.titCod}
                    </span>
                    {item?.divergencia && item.divergenciaDetalhe ? (
                      <span className="text-xs text-warning-foreground">
                        {item.divergenciaDetalhe}
                      </span>
                    ) : null}
                    <span className="tabular-nums">
                      {item?.valor !== undefined ? formatBRL(item.valor) : '—'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}

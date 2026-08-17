'use client'

import { ArrowLeftRight, Banknote } from 'lucide-react'
import type { PermutaBorderoVinculo, PermutaPendente } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SALDO_TOL, fmtData, moedaCodigo } from './format'
import { Moeda, PermutaBorderoBadge } from './ui'

/**
 * Tabela de alocação manual (1 adto → N invoices) — compartilhada pelas abas
 * Múltiplas, Cross-over e Cross-process. Mostra saldo restante + nº de
 * alocações + ação "Alocar" (distribui o saldo em várias invoices).
 */
export function PermutaPendenteTable({
  list,
  statusPorAdto,
  abrirAlocar,
  abrirReconciliar,
}: {
  list: PermutaPendente[]
  statusPorAdto: Record<string, PermutaBorderoVinculo>
  abrirAlocar: (p: PermutaPendente) => void
  abrirReconciliar: (p: PermutaPendente) => void
}) {
  return list.length === 0 ? (
    <EmptyState
      title="Nenhuma permuta cross-process"
      description="Não há adiantamentos de clientes-filtro aguardando alocação."
    />
  ) : (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Filial</TableHead>
          <TableHead>Código</TableHead>
          <TableHead>Data adto</TableHead>
          <TableHead>Exportador</TableHead>
          <TableHead className="text-right">Valor Moeda Negociada</TableHead>
          <TableHead className="text-right">Saldo restante</TableHead>
          <TableHead className="text-right">Alocações</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Ação</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((p) => {
          const vinculo = statusPorAdto[p.docCod]
          // Sem saldo a permutar = totalmente alocado. PARCIAL = já tem borderô MAS ainda sobra saldo
          // (baixa parcial) → Alocar/Baixar continuam liberados pra lançar o resto.
          const semSaldo = p.saldoRestante !== undefined && p.saldoRestante <= SALDO_TOL
          const parcial = vinculo !== undefined && !semSaldo
          const temAlocacoes = (p.alocacoes?.length ?? 0) > 0
          return (
            <TableRow key={p.docCod}>
              <TableCell>{p.filCod}</TableCell>
              <TableCell className="font-medium">{p.docCod}</TableCell>
              {/* Data de emissão do ADIANTAMENTO — âncora de idade do próprio adto (FIFO).
                  Não confundir com "Dias em Aberto" da Visão Geral, que é ancorada na
                  data-base da D.I/DUIMP e fica vazia nos cross-process sem declaração. */}
              <TableCell className="whitespace-nowrap tabular-nums">
                {fmtData(p.detalhe?.dataEmissao)}
              </TableCell>
              <TableCell>{p.exportador}</TableCell>
              <TableCell className="text-right">
                <Moeda valor={p.valorMoedaNegociada} moeda={p.moeda} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {p.saldoRestante != null
                  ? `${formatNumber(p.saldoRestante)} ${moedaCodigo(p.moeda)}`
                  : '—'}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {p.alocacoes?.length ?? 0}
              </TableCell>
              <TableCell>
                {parcial ? (
                  <Badge className="border-transparent bg-warning-subtle text-warning-foreground">
                    Parcial · borderô {vinculo?.borCod}
                  </Badge>
                ) : (
                  <PermutaBorderoBadge vinculo={vinculo} />
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    // Só desabilita quando NÃO há saldo a alocar E NÃO há alocação pra gerenciar.
                    // Totalmente alocado mas com alocações → ABRE pra poder REMOVER (o "remover" vive
                    // dentro deste modal); senão a alocação ficava presa.
                    disabled={semSaldo && !temAlocacoes}
                    title={
                      semSaldo
                        ? temAlocacoes
                          ? 'Totalmente alocado — abra para ver/remover as alocações'
                          : 'Adiantamento totalmente alocado — sem saldo a permutar'
                        : parcial
                          ? 'Alocar o saldo restante em mais invoices'
                          : 'Alocar saldo em invoices'
                    }
                    onClick={() => abrirAlocar(p)}
                  >
                    <ArrowLeftRight aria-hidden /> Alocar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(p.alocacoes?.length ?? 0) === 0}
                    title={
                      (p.alocacoes?.length ?? 0) === 0
                        ? 'Aloque ao menos uma invoice antes de baixar'
                        : parcial
                          ? `Parcial: borderô ${vinculo?.borCod} já lançado — aloque o restante e baixe de novo (o que já foi baixado é ignorado)`
                          : 'Pré-visualizar e baixar no ERP (fin010)'
                    }
                    onClick={() => abrirReconciliar(p)}
                  >
                    <Banknote aria-hidden /> Baixar
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

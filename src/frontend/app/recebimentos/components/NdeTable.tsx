'use client'

import * as React from 'react'
import { FileText } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { formatBRL } from '@/lib/utils'
import type { NotaDebitoEletronica } from '@/lib/recebimentos'
import { FiltroBarra, Paginacao, useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'
import { NdeStatusBadge } from './status-badges'

/** Formata uma data ISO (ou undefined) para pt-BR curta. */
const fmtData = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'

/**
 * Aba NDe (§1.5) — lista as Notas de Débito Eletrônica com status de emissão,
 * valor, filial, `correlationId` e data. Filtra por filial + busca via
 * `useTabelaFiltro` (mesmo kit das demais listas). READ-ONLY na Fase 1.
 */
export function NdeTable({ ndes }: { ndes: NotaDebitoEletronica[] }) {
  const aba = useTabelaFiltro(
    ndes,
    (n) => n.filCod,
    (n) => `${n.numeroNde ?? ''} ${n.correlationId} ${n.statusEmissao}`,
  )

  if (ndes.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="size-6" aria-hidden />}
        title="Nenhuma NDe"
        description="As Notas de Débito Eletrônica aparecem aqui quando um recebimento é executado."
      />
    )
  }

  return (
    <div className="space-y-3">
      <FiltroBarra aba={aba} buscaPlaceholder="Buscar por nº NDe, correlationId ou status…" />
      {aba.total === 0 ? (
        <EmptyState
          icon={<FileText className="size-6" aria-hidden />}
          title="Nenhuma NDe para o filtro"
          description="Ajuste a filial ou a busca acima."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº NDe</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Filial</TableHead>
                <TableHead>Status emissão</TableHead>
                <TableHead>correlationId</TableHead>
                <TableHead>Emitida em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aba.slice.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">
                    {n.numeroNde ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(n.valor)}</TableCell>
                  <TableCell className="text-muted-foreground">{n.filCod}</TableCell>
                  <TableCell>
                    <NdeStatusBadge status={n.statusEmissao} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {n.correlationId}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtData(n.emitidaEm)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Paginacao aba={aba} />
    </div>
  )
}

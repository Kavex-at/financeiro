'use client'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBRL } from '@/lib/utils'
import type { BoletoDda, BoletoDdaTitulo } from '@/lib/sispag'

/** `YYYY-MM-DD` → `DD/MM/AAAA` sem passar por `Date` (data civil, sem fuso). */
export const fmtCivil = (civil?: string) => {
  if (!civil) return '—'
  const [a, m, d] = civil.split('-')
  return `${d}/${m}/${a}`
}

export function DiferencaBadge({ dias }: { dias?: number }) {
  if (dias === undefined) return null
  if (dias === 0)
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        mesmo dia
      </Badge>
    )
  const texto = `${dias > 0 ? '+' : ''}${dias} dia${Math.abs(dias) > 1 ? 's' : ''}`
  return (
    <Badge
      variant="outline"
      className="border-warning/40 text-warning"
      title="Vencimento do boleto menos o do título. Diferente de zero, o Conexos não costuma associar."
    >
      {texto}
    </Badge>
  )
}

const fmtDias = (d: number) => (d === 0 ? '0' : `${d > 0 ? '+' : ''}${d}`)

/**
 * Resumo de uma lista de candidatos para caber numa linha da tabela:
 * `"+18 títulos · 1 credor · 0 a −2 dias"`. A lista vem do backend ordenada do mais próximo ao
 * mais distante, então o primeiro é o que aparece na linha e o resto é o "+N".
 */
export const resumoCandidatos = (candidatos: BoletoDdaTitulo[]): string => {
  const outros = candidatos.length - 1
  const credores = new Set(candidatos.map((c) => c.credor ?? '—')).size
  const dias = candidatos
    .map((c) => c.diferencaDias)
    .filter((d): d is number => d !== undefined)
  const faixa =
    dias.length === 0
      ? ''
      : Math.min(...dias) === Math.max(...dias)
        ? ` · ${fmtDias(dias[0] as number)} dia(s)`
        : ` · ${fmtDias(Math.max(...dias))} a ${fmtDias(Math.min(...dias))} dias`
  return `+${outros} título${outros > 1 ? 's' : ''} · ${credores} credor${credores > 1 ? 'es' : ''}${faixa}`
}

/**
 * Todos os títulos candidatos de um boleto AMBÍGUO, numa tabela compacta. Existe porque uma
 * cobrança recorrente (PEDRONI: 19 títulos de R$ 1.412,00) transformava a linha da tabela
 * principal numa coluna de cartões.
 */
export function CandidatosBoletoDialog({
  boleto,
  onClose,
}: {
  boleto: BoletoDda | null
  onClose: () => void
}) {
  return (
    <Dialog open={boleto !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="lg">
        {boleto ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Boleto {boleto.numero ?? boleto.ditCod} · {boleto.candidatos.length} títulos
                candidatos
              </DialogTitle>
              <DialogDescription>
                {formatBRL(boleto.valor)} · vence {fmtCivil(boleto.vencimento)}
                {boleto.bancoEmissor ? ` · banco ${boleto.bancoEmissor}` : ''} · fin124 #
                {boleto.ddcCod}. Todos têm o mesmo valor e vencimento próximo; o Conexos não
                escolhe entre eles. Os de diferença “mesmo dia” são os mais prováveis.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Credor</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Filial</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Diferença</TableHead>
                    <TableHead>Lote</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boleto.candidatos.map((c) => (
                    <TableRow key={`${c.filCod}:${c.docCod}:${c.titCod}`}>
                      <TableCell className="max-w-[16rem] truncate font-medium">
                        {c.credor ?? '—'}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {c.docCod}/{c.titCod}
                      </TableCell>
                      <TableCell className="tabular-nums">{c.filCod}</TableCell>
                      <TableCell className="tabular-nums">{fmtCivil(c.vencimento)}</TableCell>
                      <TableCell>
                        <DiferencaBadge dias={c.diferencaDias} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.lote ? c.lote.status.toLowerCase() : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

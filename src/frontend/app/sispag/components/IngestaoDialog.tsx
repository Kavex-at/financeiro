'use client'

import { Ban, CheckCircle2, DatabaseZap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PagamentoIngestaoRun } from '@/lib/sispag'

/** cron → automático; senão foi manual e mostra quem rodou. */
const quemRodou = (t: string) => (t === 'cron' ? 'Automático (cron)' : t)
const quando = (r: PagamentoIngestaoRun) => {
  const d = r.finishedAt ?? r.startedAt
  return d ? new Date(d).toLocaleString('pt-BR') : '—'
}

function RunStatus({
  status,
  aviso,
}: {
  status: PagamentoIngestaoRun['status']
  /** `error_message` de uma run que terminou com sucesso: leitura parcial (filial ou flag de boleto). */
  aviso?: string
}) {
  if (status === 'success' && aviso) {
    return (
      <Badge
        className="border-transparent bg-warning-subtle text-warning-foreground"
        title={aviso}
      >
        <CheckCircle2 aria-hidden /> Sucesso parcial
      </Badge>
    )
  }
  if (status === 'success') {
    return (
      <Badge className="border-transparent bg-success-subtle text-success-foreground">
        <CheckCircle2 aria-hidden /> Sucesso
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge className="border-transparent bg-danger-subtle text-danger-foreground">
        <Ban aria-hidden /> Falha
      </Badge>
    )
  }
  return (
    <Badge className="border-transparent bg-muted text-muted-foreground">
      <Spinner /> Rodando
    </Badge>
  )
}

/** Modal de ingestão de pagamentos: trilha das últimas rodadas + botão para rodar. */
export function IngestaoDialog({
  open,
  setOpen,
  ingestRunning,
  runs,
  runsLoading,
  rodarIngestao,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  ingestRunning: boolean
  runs: PagamentoIngestaoRun[] | null
  runsLoading: boolean
  rodarIngestao: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Não fecha enquanto a ingestão está rodando (espera no modal).
        if (ingestRunning) return
        setOpen(next)
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Ingestão de dados</DialogTitle>
          <DialogDescription>
            Roda a mesma pipeline do cron diário, sob demanda.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="rounded-md border border-warning/40 bg-warning-subtle/40 p-3 text-sm text-warning-foreground">
            <p>
              Lê os títulos a pagar do <strong>Conexos</strong> e atualiza a carteira
              (aprovação, vencimento). É <strong>somente leitura no ERP</strong> — nada é enviado
              ao banco. Pode levar alguns segundos; aguarde aqui.
            </p>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-medium text-muted-foreground">Últimas ingestões</div>
              {runsLoading ? <Spinner className="text-muted-foreground" /> : null}
            </div>
            {runsLoading && !runs ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : runs && runs.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Quem rodou</TableHead>
                    <TableHead>Quando</TableHead>
                    <TableHead className="text-right">Títulos</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell className="font-medium">{quemRodou(run.triggeredBy)}</TableCell>
                      <TableCell className="text-muted-foreground">{quando(run)}</TableCell>
                      <TableCell className="text-right">
                        {run.status === 'success' ? run.totalTitulos.toLocaleString('pt-BR') : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <RunStatus status={run.status} aviso={run.errorMessage} />
                        {run.status === 'success' && run.errorMessage ? (
                          <p className="mt-1 text-xs text-muted-foreground">{run.errorMessage}</p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma ingestão registrada ainda.</p>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={ingestRunning}>
            Fechar
          </Button>
          <Button onClick={() => void rodarIngestao()} disabled={ingestRunning}>
            {ingestRunning ? (
              <>
                <Spinner /> Rodando…
              </>
            ) : (
              <>
                <DatabaseZap aria-hidden /> Rodar agora
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

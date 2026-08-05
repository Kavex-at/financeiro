'use client'

import type { CasamentoSugerido, PermutaPendente } from '@/lib/types'
import { formatNumber } from '@/lib/utils'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PROCESSAMENTO_HABILITADO } from './format'
import { Campo, Moeda, ProcessamentoBadge } from './ui'

/** Modal de confirmação do processamento (checkout) de um casamento automático. */
export function ConfirmarProcessamentoDialog({
  confirmacao,
  onClose,
  pendenteByDocCod,
  confirmarProcessamento,
}: {
  confirmacao: CasamentoSugerido | null
  onClose: () => void
  pendenteByDocCod: Map<string, PermutaPendente>
  confirmarProcessamento: () => void
}) {
  return (
    <Dialog
      open={confirmacao !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Confirmar processamento</DialogTitle>
          <DialogDescription>
            Revise os adiantamentos que vão abater esta invoice antes de processar.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {confirmacao ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                <Campo label="Processo">{confirmacao.priCod}</Campo>
                <Campo label="Invoice a abater">
                  <span className="text-muted-foreground">{confirmacao.invoice.docCod}</span>{' '}
                  ·{' '}
                  <Moeda
                    valor={confirmacao.invoice.valorMoedaNegociada}
                    moeda={confirmacao.invoice.moeda}
                  />
                </Campo>
              </dl>
              <div className="mt-4">
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Adiantamentos a abater
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Adiantamento</TableHead>
                      <TableHead className="text-right">Valor a ser usado</TableHead>
                      <TableHead className="text-right">Variação cambial</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {confirmacao.adiantamentos.map((adto) => {
                      const det = pendenteByDocCod.get(adto.docCod)?.detalhe
                      return (
                        <TableRow key={adto.docCod}>
                          <TableCell className="font-medium">{adto.docCod}</TableCell>
                          <TableCell className="text-right">
                            <Moeda valor={adto.valorASerUsado} moeda={adto.moeda} />
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {det?.variacaoClassificacao != null &&
                            det.variacaoResultado != null
                              ? `${det.variacaoClassificacao} · R$ ${formatNumber(det.variacaoResultado)}`
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <ProcessamentoBadge
                              status={adto.processamentoStatus ?? 'pendente'}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Os adiantamentos pendentes acima vão abater a invoice{' '}
                <strong>{confirmacao.invoice.docCod}</strong>. Os já processados são ignorados.
              </p>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!PROCESSAMENTO_HABILITADO}
            title={
              !PROCESSAMENTO_HABILITADO
                ? 'Indisponível — aguardando write-back no Conexos'
                : undefined
            }
            onClick={() => void confirmarProcessamento()}
          >
            Processar{' '}
            {confirmacao
              ? confirmacao.adiantamentos.filter(
                  (a) => a.processamentoStatus !== 'processado',
                ).length
              : 0}{' '}
            adiantamento(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import { Undo2 } from 'lucide-react'
import type { PermutaPendente } from '@/lib/types'
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
import { Spinner } from '@/components/ui/spinner'
import { fmtData } from './format'
import { Campo } from './ui'

/**
 * Confirmação de "Desfazer exceção" (ADR-0047). Mostra o que está sendo desfeito — justificativa,
 * autor e data — antes do soft delete. O adiantamento volta ao estado calculado pelo ERP.
 */
export function DesfazerExcecaoDialog({
  pendente,
  onClose,
  desfazendo,
  onConfirmar,
}: {
  pendente: PermutaPendente | null
  onClose: () => void
  desfazendo: boolean
  onConfirmar: () => void
}) {
  const excecao = pendente?.excecaoManual
  return (
    <Dialog
      open={pendente !== null && excecao !== undefined}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Desfazer exceção do adiantamento {pendente?.docCod}</DialogTitle>
          <DialogDescription>
            A exceção sai da classificação e fica no histórico com o seu usuário e a data. O
            adiantamento volta ao estado calculado pelo ERP (hoje, <strong>Sem saldo a
            permutar</strong>, se nada mudou).
          </DialogDescription>
        </DialogHeader>
        {excecao ? (
          <DialogBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Campo label="Justificativa" className="col-span-2">
                <span className="whitespace-pre-wrap font-normal">{excecao.justificativa}</span>
              </Campo>
              <Campo label="Marcada por">{excecao.criadoPor}</Campo>
              <Campo label="Marcada em">{fmtData(excecao.criadoEm)}</Campo>
            </dl>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={desfazendo}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={desfazendo} onClick={onConfirmar}>
            {desfazendo ? <Spinner aria-hidden /> : <Undo2 aria-hidden />}
            Desfazer exceção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

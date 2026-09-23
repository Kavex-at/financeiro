'use client'

import { LogOut } from 'lucide-react'
import type { TituloAPagar } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
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
import { rotuloLote } from './loteDoTitulo'

/**
 * Confirmação de "Retirar do lote" (ADR-0050). O título sai do lote RASCUNHO e fica solto: pode
 * ser incluído em outro lote logo em seguida.
 */
export function RetirarDoLoteDialog({
  titulo,
  onClose,
  salvando,
  onConfirmar,
}: {
  titulo: TituloAPagar | null
  onClose: () => void
  salvando: boolean
  onConfirmar: () => void
}) {
  return (
    <Dialog open={titulo !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Retirar do lote</DialogTitle>
          <DialogDescription>
            O título sai do lote e fica livre para entrar em outro. Nada é escrito no ERP.
          </DialogDescription>
        </DialogHeader>
        {titulo ? (
          <DialogBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Credor</dt>
                <dd className="font-medium">{titulo.credor ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Documento</dt>
                <dd className="font-medium">
                  {titulo.docCod}/{titulo.titCod}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Valor</dt>
                <dd className="font-medium tabular-nums">{formatBRL(titulo.valor)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Lote</dt>
                <dd className="font-medium">
                  {titulo.loteRascunho ? rotuloLote(titulo.loteRascunho) : '—'}
                  {titulo.loteRascunho?.automatico ? ' (passa a ser manual)' : ''}
                </dd>
              </div>
            </dl>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={onConfirmar}>
            {salvando ? <Spinner aria-hidden /> : <LogOut aria-hidden />}
            Retirar do lote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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

/** Boleto agrupado a retirar do lote INTEIRO (ADR-0077, I21j). Só a máscara 5+4 do boleto. */
export interface GrupoParaRetirar {
  grupoId: string
  codbarMascarado: string
  credor?: string
  titulos: Array<{ filCod: number; docCod: string; titCod: string }>
}

/**
 * Confirmação de "Retirar do lote" (ADR-0050). O título sai do lote RASCUNHO e fica solto: pode
 * ser incluído em outro lote logo em seguida. Com `grupo` (ADR-0077), é o boleto agrupado que sai
 * INTEIRO: os N títulos juntos, nunca um só.
 */
export function RetirarDoLoteDialog({
  titulo,
  grupo = null,
  onClose,
  salvando,
  onConfirmar,
}: {
  titulo: TituloAPagar | null
  grupo?: GrupoParaRetirar | null
  onClose: () => void
  salvando: boolean
  onConfirmar: () => void
}) {
  return (
    <Dialog
      open={titulo !== null || grupo !== null}
      onOpenChange={(open) => (!open && !salvando ? onClose() : undefined)}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{grupo ? 'Retirar boleto agrupado' : 'Retirar do lote'}</DialogTitle>
          <DialogDescription>
            {grupo
              ? `O boleto agrupado sai inteiro do lote, com os ${grupo.titulos.length} títulos juntos, e eles ficam livres para entrar em outro. Nada é escrito no ERP.`
              : 'O título sai do lote e fica livre para entrar em outro. Nada é escrito no ERP.'}
          </DialogDescription>
        </DialogHeader>
        {grupo ? (
          <DialogBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Credor</dt>
                <dd className="font-medium">{grupo.credor ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Boleto</dt>
                <dd className="font-medium tabular-nums">{grupo.codbarMascarado}</dd>
              </div>
            </dl>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
              {grupo.titulos.map((t) => (
                <li key={`${t.filCod}:${t.docCod}:${t.titCod}`}>
                  {t.docCod}/{t.titCod}
                </li>
              ))}
            </ul>
          </DialogBody>
        ) : titulo ? (
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

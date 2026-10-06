'use client'

import { Layers } from 'lucide-react'
import { formatBRL } from '@/lib/utils'
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
import { Spinner } from '@/components/ui/spinner'
import { rotuloLote } from './loteDoTitulo'
import type { SaidaDeLote } from './moverParaLote'

/**
 * Confirmação de "Criar lote" quando parte da seleção já está em lotes em rascunho (ADR-0064):
 * lista, por lote de origem, os títulos que saem de lá para o lote manual novo. Substitui o
 * "Retirar do lote" um a um como caminho principal.
 */
export function MoverParaLoteDialog({
  plano,
  totalSelecionados,
  onClose,
  salvando,
  onConfirmar,
}: {
  plano: SaidaDeLote[] | null
  totalSelecionados: number
  onClose: () => void
  salvando: boolean
  onConfirmar: () => void
}) {
  const movidos = plano?.reduce((acc, s) => acc + s.titulos.length, 0) ?? 0
  return (
    <Dialog open={plano !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Mover títulos para um lote manual</DialogTitle>
          <DialogDescription>
            {movidos} de {totalSelecionados} título(s) selecionado(s) já estão em lotes em
            rascunho. Eles saem desses lotes e entram no lote novo. Nada é escrito no ERP.
          </DialogDescription>
        </DialogHeader>
        {plano ? (
          <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {plano.map((s) => (
              <section key={s.loteId} className="rounded-lg border p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium">
                  <Layers className="size-4 text-muted-foreground" aria-hidden />
                  {rotuloLote({ id: s.loteId, automatico: s.automatico })}
                  <span className="text-xs font-normal text-muted-foreground">
                    sai{s.titulos.length > 1 ? 'em' : ''} {s.titulos.length} título(s)
                  </span>
                  {s.ficaVazio ? (
                    <Badge variant="outline" className="border-warning/40 text-warning">
                      fica vazio e será cancelado
                    </Badge>
                  ) : s.automatico ? (
                    <Badge variant="outline">passa a ser manual</Badge>
                  ) : null}
                </div>
                <ul className="flex flex-col gap-1 text-sm">
                  {s.titulos.map((t) => (
                    <li
                      key={`${t.filCod}:${t.docCod}:${t.titCod}`}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="truncate">
                        {t.credor ?? '—'}{' '}
                        <span className="text-muted-foreground">
                          {t.docCod}/{t.titCod}
                        </span>
                      </span>
                      <span className="tabular-nums">{formatBRL(t.valor)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button disabled={salvando} onClick={onConfirmar}>
            {salvando ? <Spinner aria-hidden /> : <Layers aria-hidden />}
            Mover e criar lote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

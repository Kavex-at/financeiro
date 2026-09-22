'use client'

import * as React from 'react'
import { PauseCircle } from 'lucide-react'
import type { TituloAPagar } from '@/lib/sispag'
import { cn, formatBRL } from '@/lib/utils'
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
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { MOTIVO_RETENCAO_MAX, rotuloLote } from './retencao'

/**
 * Confirmação de "Retirar do lote" (ADR-0050). O título sai do lote RASCUNHO e fica retido da
 * formação automática; o motivo é opcional (até 500 caracteres). Autor e data não são pedidos:
 * o backend grava a partir do token.
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
  onConfirmar: (motivo: string) => void
}) {
  const [texto, setTexto] = React.useState('')
  const id = React.useId()
  const idCampo = `${id}-motivo`
  const idAjuda = `${id}-ajuda`
  const idContador = `${id}-contador`

  // Cada abertura começa em branco — nunca herda o motivo de outro título.
  const chave = titulo ? `${titulo.filCod}:${titulo.docCod}:${titulo.titCod}` : undefined
  const [chaveAtual, setChaveAtual] = React.useState(chave)
  if (chave !== chaveAtual) {
    setChaveAtual(chave)
    setTexto('')
  }

  const tamanho = texto.trim().length
  const excedeu = tamanho > MOTIVO_RETENCAO_MAX

  return (
    <Dialog open={titulo !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Retirar do lote</DialogTitle>
          <DialogDescription>
            O título sai do lote e fica marcado como <strong>Não lotar automaticamente</strong>: a
            formação automática não o coloca em lote de novo. Ele volta quando alguém o incluir num
            lote à mão ou clicar em <strong>Liberar</strong>. Nada é escrito no ERP.
          </DialogDescription>
        </DialogHeader>
        {titulo ? (
          <DialogBody className="space-y-4">
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
            <div className="space-y-2">
              <Label htmlFor={idCampo}>Motivo (opcional)</Label>
              <Textarea
                id={idCampo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                aria-invalid={excedeu || undefined}
                aria-describedby={`${idAjuda} ${idContador}`}
                placeholder="Ex.: fornecedor pediu para segurar; em negociação; falta documento."
                disabled={salvando}
              />
              <div className="flex items-start justify-between gap-3 text-xs">
                <p id={idAjuda} className="text-muted-foreground">
                  Aparece no detalhe do título com o seu usuário e a data.
                </p>
                <p
                  id={idContador}
                  aria-live="polite"
                  className={cn(
                    'shrink-0 tabular-nums',
                    excedeu ? 'text-danger-foreground' : 'text-muted-foreground',
                  )}
                >
                  {tamanho}/{MOTIVO_RETENCAO_MAX}
                  {excedeu ? ` · ${tamanho - MOTIVO_RETENCAO_MAX} além do limite` : ''}
                </p>
              </div>
            </div>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button disabled={excedeu || salvando} onClick={() => onConfirmar(texto.trim())}>
            {salvando ? <Spinner aria-hidden /> : <PauseCircle aria-hidden />}
            Retirar do lote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

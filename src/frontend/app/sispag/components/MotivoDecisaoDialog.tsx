'use client'

import * as React from 'react'
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

/**
 * Diálogo de decisão com motivo obrigatório (rejeitar sugestão, revogar confirmação). O motivo
 * fica na trilha. Erros do servidor aparecem dentro do diálogo, que permanece aberto.
 */
export function MotivoDecisaoDialog({
  titulo,
  descricao,
  rotuloConfirmar,
  onFechar,
  onConfirmar,
}: {
  titulo: string
  descricao: string
  rotuloConfirmar: string
  onFechar: () => void
  /** Rejeita com a mensagem em português para o diálogo mostrar e continuar aberto. */
  onConfirmar: (motivo: string) => Promise<void>
}) {
  const campoId = React.useId()
  const [motivo, setMotivo] = React.useState('')
  const [erroCampo, setErroCampo] = React.useState<string | null>(null)
  const [erroServidor, setErroServidor] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (salvando) return
    if (motivo.trim() === '') {
      setErroCampo('Informe o motivo.')
      return
    }
    setErroCampo(null)
    setErroServidor(null)
    setSalvando(true)
    try {
      await onConfirmar(motivo.trim())
    } catch (err) {
      setErroServidor(err instanceof Error ? err.message : 'Não foi possível concluir a ação.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!aberto && !salvando) onFechar()
      }}
    >
      <DialogContent size="sm">
        <form onSubmit={enviar} noValidate>
          <DialogHeader>
            <DialogTitle>{titulo}</DialogTitle>
            <DialogDescription>{descricao}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={campoId}>Motivo</Label>
              <Textarea
                id={campoId}
                value={motivo}
                autoComplete="off"
                onChange={(e) => {
                  setMotivo(e.target.value)
                  setErroCampo(null)
                }}
                aria-invalid={erroCampo ? true : undefined}
                aria-describedby={erroCampo ? `${campoId}-erro` : undefined}
              />
              {erroCampo ? (
                <p id={`${campoId}-erro`} role="alert" className="text-xs text-destructive">
                  {erroCampo}
                </p>
              ) : null}
            </div>
            {erroServidor ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
              >
                {erroServidor}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={salvando}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={salvando}>
              {salvando ? <Spinner aria-hidden /> : null}
              {rotuloConfirmar}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

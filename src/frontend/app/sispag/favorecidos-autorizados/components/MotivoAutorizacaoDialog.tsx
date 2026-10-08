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
import { type FavorecidoAutorizado, rejeitarAutorizacao, revogarAutorizacao } from '@/lib/sispag'

export type AcaoComMotivo = 'rejeitar' | 'revogar'

const TEXTOS: Record<AcaoComMotivo, { titulo: string; descricao: string; botao: string }> = {
  rejeitar: {
    titulo: 'Rejeitar autorização',
    descricao: 'O pedido é encerrado. Um pedido novo pode ser feito depois. O motivo fica na trilha.',
    botao: 'Rejeitar',
  },
  revogar: {
    titulo: 'Revogar autorização',
    descricao:
      'O favorecido deixa de poder receber por esta forma de pagamento em lotes ainda não enviados ao Conexos. O motivo fica na trilha.',
    botao: 'Revogar',
  },
}

/** Rejeitar (F3) e revogar (F7) exigem motivo. */
export function MotivoAutorizacaoDialog({
  autorizacao,
  acao,
  onOpenChange,
  onConcluida,
}: {
  autorizacao: FavorecidoAutorizado
  acao: AcaoComMotivo
  onOpenChange: (open: boolean) => void
  onConcluida: (a: FavorecidoAutorizado) => void
}) {
  const t = TEXTOS[acao]
  const [motivo, setMotivo] = React.useState('')
  const [erroCampo, setErroCampo] = React.useState<string | null>(null)
  const [erroServidor, setErroServidor] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const campoId = `motivo-${autorizacao.id}`

  async function confirmar(e: React.FormEvent) {
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
      const chamar = acao === 'rejeitar' ? rejeitarAutorizacao : revogarAutorizacao
      onConcluida(await chamar(autorizacao.id, { versao: autorizacao.versao, motivo: motivo.trim() }))
    } catch (err) {
      setErroServidor(err instanceof Error ? err.message : `Não foi possível ${acao}.`)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!salvando) onOpenChange(aberto) }}>
      <DialogContent size="sm">
        <form onSubmit={confirmar} noValidate>
          <DialogHeader>
            <DialogTitle>{t.titulo}</DialogTitle>
            <DialogDescription>
              {autorizacao.credor ?? `Favorecido ${autorizacao.pesCod}`} · {autorizacao.modalidade}. {t.descricao}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={campoId}>Motivo</Label>
              <Textarea
                id={campoId}
                value={motivo}
                onChange={(e) => {
                  setMotivo(e.target.value)
                  setErroCampo(null)
                }}
                aria-invalid={erroCampo ? true : undefined}
                aria-describedby={erroCampo ? `${campoId}-erro` : undefined}
                autoComplete="off"
              />
              {erroCampo ? (
                <p id={`${campoId}-erro`} role="alert" className="text-xs text-destructive">
                  {erroCampo}
                </p>
              ) : null}
            </div>
            {erroServidor ? (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground">
                {erroServidor}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" disabled={salvando}>
              {salvando ? <Spinner aria-hidden /> : null}
              {t.botao}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

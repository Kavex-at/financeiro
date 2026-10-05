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
import { type ExcecaoDestinoResumo, rejeitarExcecao, revogarExcecao } from '@/lib/sispag'

export type AcaoComMotivo = 'rejeitar' | 'revogar'

const TEXTOS: Record<AcaoComMotivo, { titulo: string; descricao: string; botao: string }> = {
  rejeitar: {
    titulo: 'Rejeitar exceção de destino',
    descricao: 'A exceção pendente é descartada e não poderá ser usada. O motivo fica na trilha.',
    botao: 'Rejeitar exceção',
  },
  revogar: {
    titulo: 'Revogar exceção de destino',
    descricao:
      'A exceção deixa de valer para novos lotes. Destino já enviado ao Conexos não é reescrito. O motivo fica na trilha.',
    botao: 'Revogar exceção',
  },
}

/** Rejeitar (PENDENTE) e revogar (APROVADA) exigem motivo (ADR-0061, E3/E5). */
export function RevogarExcecaoDialog({
  excecao,
  acao,
  onOpenChange,
  onConcluida,
}: {
  excecao: ExcecaoDestinoResumo
  acao: AcaoComMotivo
  onOpenChange: (open: boolean) => void
  onConcluida: (excecao: ExcecaoDestinoResumo) => void
}) {
  const t = TEXTOS[acao]
  const [motivo, setMotivo] = React.useState('')
  const [erroCampo, setErroCampo] = React.useState<string | null>(null)
  const [erroServidor, setErroServidor] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const campoId = `motivo-${excecao.id}`

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
      const chamar = acao === 'rejeitar' ? rejeitarExcecao : revogarExcecao
      onConcluida(await chamar(excecao.id, motivo.trim()))
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
              Favorecido {excecao.pesCod} · {excecao.destinoMascarado}. {t.descricao}
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
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
              >
                {erroServidor}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={salvando}
            >
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

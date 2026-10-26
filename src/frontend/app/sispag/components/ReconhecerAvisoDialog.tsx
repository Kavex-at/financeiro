'use client'

import { AlertTriangle } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

/** Texto do reconhecimento (proposta §3.4): o botão só habilita com o checkbox marcado. */
export const TEXTO_RECONHECIMENTO_VENCE_ANTES =
  'Entendo que este boleto vence antes do título e que o pagamento na data do título pode gerar atraso, juros e multa.'

/**
 * Confirmar um candidato que vence ANTES do título (I15o, ADR-0072) exige reconhecimento
 * explícito. O servidor confere de novo contra a avaliação recalculada (422 sem o aviso), então
 * este diálogo é só o consentimento informado — não a trava. Erros do servidor aparecem aqui e o
 * diálogo continua aberto.
 */
export function ReconhecerAvisoDialog({
  mensagem,
  deltaValor,
  deltaDias,
  onFechar,
  onConfirmar,
  titulo = 'Boleto vence antes do título',
  textoReconhecimento = TEXTO_RECONHECIMENTO_VENCE_ANTES,
  rotuloDeltaValor = 'Valor (boleto − título)',
  rotuloDeltaDias = 'Vencimento (boleto − título)',
}: {
  /** Mensagem completa do aviso (datas e dias, em português). */
  mensagem: string
  /** Δ com sinal já formatado, para o analista ver o que está reconhecendo. */
  deltaValor: string
  deltaDias: string
  onFechar: () => void
  /** Rejeita com a mensagem em português para o diálogo mostrar. */
  onConfirmar: () => Promise<void>
  /** Boleto agrupado (ADR-0077): o mesmo consentimento, com o texto do caso "título antes do boleto". */
  titulo?: string
  textoReconhecimento?: string
  rotuloDeltaValor?: string
  rotuloDeltaDias?: string
}) {
  const campoId = React.useId()
  const [marcado, setMarcado] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (salvando || !marcado) return
    setErro(null)
    setSalvando(true)
    try {
      await onConfirmar()
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível confirmar a sugestão.')
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
            <DialogDescription>{mensagem}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{rotuloDeltaValor}</dt>
                <dd className="tabular-nums">{deltaValor}</dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">{rotuloDeltaDias}</dt>
                <dd className="font-medium tabular-nums text-warning-foreground">{deltaDias}</dd>
              </div>
            </dl>
            <p className="flex items-start gap-2 text-sm text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Confirme o vencimento no portal do banco antes de decidir.</span>
            </p>
            <div className="flex items-start gap-2">
              <Checkbox
                id={campoId}
                checked={marcado}
                onCheckedChange={(v) => setMarcado(v === true)}
                disabled={salvando}
                autoFocus
              />
              <Label htmlFor={campoId} className="text-sm font-normal leading-snug">
                {textoReconhecimento}
              </Label>
            </div>
            {erro ? (
              <p
                role="alert"
                className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
              >
                {erro}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={salvando}>
              Voltar
            </Button>
            <Button type="submit" disabled={salvando || !marcado}>
              {salvando ? <Spinner aria-hidden /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

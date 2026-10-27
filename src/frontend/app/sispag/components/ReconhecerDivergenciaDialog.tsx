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
import { Textarea } from '@/components/ui/textarea'
import { MOTIVO_RECONHECIMENTO_MAX, MOTIVO_RECONHECIMENTO_MIN } from '@/lib/sispag'
import { motivoReconhecimentoValido } from './sugestaoBoleto'

/** Texto do reconhecimento tipado (I15r): o botão só habilita com o checkbox E o motivo válido. */
export const TEXTO_RECONHECIMENTO_DATA_DIVERGENTE =
  'Entendo que a data deste boleto é diferente da do título e que o pagamento em data divergente pode gerar atraso, juros e multa.'

/**
 * Confirmar um candidato de valor igual com data divergente (I15r, ADR-0078; Δ<0 ou Δ>5) exige o
 * reconhecimento TIPADO: checkbox + motivo (10 a 500 caracteres). Mostra o Δ de dias e o valor que
 * a analista está vendo — são eles que seguem no corpo e que o servidor confere contra a avaliação
 * ao vivo (422 "desatualizado" se mudaram). O servidor é a trava; este diálogo é o consentimento
 * informado. Erros do servidor aparecem aqui e o diálogo continua aberto. Sem segunda pessoa.
 */
export function ReconhecerDivergenciaDialog({
  mensagem,
  deltaDias,
  valorBoleto,
  deltaValor,
  onFechar,
  onConfirmar,
}: {
  /** Mensagem completa da divergência (datas e dias, em português). */
  mensagem: string
  /** Δ de dias com sinal já formatado (o `deltaDiasVisto` que segue no corpo). */
  deltaDias: string
  /** Valor do boleto já formatado (o `valorBoletoVisto` que segue no corpo). */
  valorBoleto: string
  /** Δ de valor com sinal já formatado (zero no caminho de valor igual). */
  deltaValor: string
  onFechar: () => void
  /** Recebe o motivo; rejeita com a mensagem em português para o diálogo mostrar. */
  onConfirmar: (motivo: string) => Promise<void>
}) {
  const campoId = React.useId()
  const motivoId = React.useId()
  const [marcado, setMarcado] = React.useState(false)
  const [motivo, setMotivo] = React.useState('')
  const [erro, setErro] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)

  const motivoOk = motivoReconhecimentoValido(motivo)
  const tamanho = motivo.trim().length

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    if (salvando || !marcado || !motivoOk) return
    setErro(null)
    setSalvando(true)
    try {
      await onConfirmar(motivo.trim())
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
            <DialogTitle>Boleto com data divergente do título</DialogTitle>
            <DialogDescription>{mensagem}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">Valor do boleto</dt>
                <dd className="tabular-nums">
                  {valorBoleto} <span className="text-muted-foreground">({deltaValor})</span>
                </dd>
              </div>
              <div className="flex flex-col">
                <dt className="text-xs text-muted-foreground">Vencimento (boleto − título)</dt>
                <dd className="font-medium tabular-nums text-warning-foreground">{deltaDias}</dd>
              </div>
            </dl>
            <p className="flex items-start gap-2 text-sm text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Confirme o vencimento no portal do banco antes de decidir.</span>
            </p>
            <div className="space-y-1.5">
              <Label htmlFor={motivoId}>Motivo do reconhecimento</Label>
              <Textarea
                id={motivoId}
                value={motivo}
                autoComplete="off"
                autoFocus
                maxLength={MOTIVO_RECONHECIMENTO_MAX}
                disabled={salvando}
                onChange={(e) => setMotivo(e.target.value)}
                aria-describedby={`${motivoId}-ajuda`}
              />
              <p id={`${motivoId}-ajuda`} className="text-xs text-muted-foreground">
                {tamanho}/{MOTIVO_RECONHECIMENTO_MAX} caracteres (mínimo {MOTIVO_RECONHECIMENTO_MIN}).
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Checkbox
                id={campoId}
                checked={marcado}
                onCheckedChange={(v) => setMarcado(v === true)}
                disabled={salvando}
              />
              <Label htmlFor={campoId} className="text-sm font-normal leading-snug">
                {TEXTO_RECONHECIMENTO_DATA_DIVERGENTE}
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
            <Button type="submit" disabled={salvando || !marcado || !motivoOk}>
              {salvando ? <Spinner aria-hidden /> : null}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

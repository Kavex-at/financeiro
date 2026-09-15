'use client'

import * as React from 'react'
import { CheckCircle2 } from 'lucide-react'
import type { PermutaPendente } from '@/lib/types'
import { cn } from '@/lib/utils'
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
import { MOTIVO_LABEL } from './format'
import { Campo, Moeda } from './ui'

/** Limites da justificativa — os mesmos do backend (Zod na rota e CHECK da migration 0059). */
export const JUSTIFICATIVA_MIN = 10
export const JUSTIFICATIVA_MAX = 500

/**
 * Marca um adiantamento como "permutado fora do painel" (ADR-0047). Justificativa obrigatória,
 * entre 10 e 500 caracteres (após trim): o botão fica desabilitado fora da faixa e o contador
 * diz o que falta. Autor e data não são pedidos — o backend grava a partir do token.
 */
export function ExcecaoManualDialog({
  pendente,
  onClose,
  salvando,
  onConfirmar,
}: {
  pendente: PermutaPendente | null
  onClose: () => void
  salvando: boolean
  onConfirmar: (justificativa: string) => void
}) {
  const [texto, setTexto] = React.useState('')
  const id = React.useId()
  const idCampo = `${id}-justificativa`
  const idAjuda = `${id}-ajuda`
  const idContador = `${id}-contador`

  // Cada abertura começa em branco — nunca herda o texto de outro adiantamento. Ajuste de
  // estado durante o render (padrão do React para "resetar ao trocar a prop"), sem efeito.
  const docCod = pendente?.docCod
  const [docCodAtual, setDocCodAtual] = React.useState(docCod)
  if (docCod !== docCodAtual) {
    setDocCodAtual(docCod)
    setTexto('')
  }

  const tamanho = texto.trim().length
  const valido = tamanho >= JUSTIFICATIVA_MIN && tamanho <= JUSTIFICATIVA_MAX
  const excedeu = tamanho > JUSTIFICATIVA_MAX
  const invalido = texto.length > 0 && !valido

  return (
    <Dialog open={pendente !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Marcar como permutado fora do painel</DialogTitle>
          <DialogDescription>
            Use quando a permuta já aconteceu por baixas manuais no Conexos, fora do fluxo de
            permuta, e o ERP não registrou o valor permutado. O adiantamento passa para{' '}
            <strong>Já permutado</strong> com a tag <strong>Exceção manual</strong>. Se o dado do
            ERP mudar, o cálculo volta a valer.
          </DialogDescription>
        </DialogHeader>
        {pendente ? (
          <DialogBody className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Campo label="Adiantamento">{pendente.docCod}</Campo>
              <Campo label="Referência externa">
                {pendente.referenciaExterna ?? pendente.referencia}
              </Campo>
              <Campo label="Cliente">{pendente.importador ?? '—'}</Campo>
              <Campo label="Exportador">{pendente.exportador}</Campo>
              <Campo label="Valor moeda negociada">
                <Moeda valor={pendente.valorMoedaNegociada} moeda={pendente.moeda} />
              </Campo>
              <Campo label="Motivo atual">
                {pendente.motivoBloqueio
                  ? (MOTIVO_LABEL[pendente.motivoBloqueio] ?? pendente.motivoBloqueio)
                  : '—'}
              </Campo>
            </dl>
            <div className="space-y-2">
              <Label htmlFor={idCampo}>
                Justificativa{' '}
                <span aria-hidden className="text-danger-foreground">
                  *
                </span>
              </Label>
              <Textarea
                id={idCampo}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                required
                aria-required
                aria-invalid={invalido || undefined}
                aria-describedby={`${idAjuda} ${idContador}`}
                placeholder="Ex.: baixas cruzadas nas contas 21 e 198 em 30/04, contra a invoice 7329."
                disabled={salvando}
              />
              <div className="flex items-start justify-between gap-3 text-xs">
                <p id={idAjuda} className="text-muted-foreground">
                  Obrigatória, de {JUSTIFICATIVA_MIN} a {JUSTIFICATIVA_MAX} caracteres. Fica no
                  histórico da exceção com o seu usuário e a data.
                </p>
                <p
                  id={idContador}
                  aria-live="polite"
                  className={cn(
                    'shrink-0 tabular-nums',
                    invalido ? 'text-danger-foreground' : 'text-muted-foreground',
                  )}
                >
                  {tamanho}/{JUSTIFICATIVA_MAX}
                  {tamanho > 0 && tamanho < JUSTIFICATIVA_MIN
                    ? ` · faltam ${JUSTIFICATIVA_MIN - tamanho}`
                    : ''}
                  {excedeu ? ` · ${tamanho - JUSTIFICATIVA_MAX} além do limite` : ''}
                </p>
              </div>
            </div>
          </DialogBody>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>
            Cancelar
          </Button>
          <Button disabled={!valido || salvando} onClick={() => onConfirmar(texto.trim())}>
            {salvando ? <Spinner aria-hidden /> : <CheckCircle2 aria-hidden />}
            Marcar como permutado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

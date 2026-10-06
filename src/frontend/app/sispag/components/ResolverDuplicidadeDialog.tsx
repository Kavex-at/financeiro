'use client'

import { AlertTriangle } from 'lucide-react'
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
import {
  type AlertaItemLote,
  formatErpDay,
  type ItemLote,
  type LotePagamento,
  resolverAlertaDuplicidade,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

type Escolha = 'JUSTIFICAR' | 'RETIRAR'

const ROTULO_TIPO: Record<string, string> = {
  DUPLICIDADE_FORTE: 'mesma NF do mesmo favorecido',
  DUPLICIDADE_FRACA: 'mesmo valor e vencimento próximo, mesmo favorecido',
}

/**
 * Trata UMA alerta de duplicidade de um item TED/PIX (ADR-0063, I13f). Duas saídas:
 * - Justificar: o item fica no lote; o texto é obrigatório e aparece para o conferente.
 * - Retirar: o item sai do lote e o título fica bloqueado até o documento duplicado ser cancelado
 *   NO CONEXOS — a solução não escreve no ERP; o cancelamento é com a analista.
 */
export function ResolverDuplicidadeDialog({
  lote,
  item,
  alerta,
  onOpenChange,
  onResolvida,
}: {
  lote: LotePagamento
  item: ItemLote
  alerta: AlertaItemLote
  onOpenChange: (open: boolean) => void
  onResolvida: (lote: LotePagamento, escolha: Escolha) => void
}) {
  const [escolha, setEscolha] = React.useState<Escolha>('JUSTIFICAR')
  const [texto, setTexto] = React.useState('')
  const [erroCampo, setErroCampo] = React.useState<string | null>(null)
  const [erroServidor, setErroServidor] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const campoId = `duplicidade-${alerta.id}`
  const titulo = `${item.docCod}/${item.titCod}`

  async function confirmar(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return
    if (escolha === 'JUSTIFICAR' && texto.trim() === '') {
      setErroCampo('Informe a justificativa: por que não é pagamento em duplicidade.')
      return
    }
    setErroCampo(null)
    setErroServidor(null)
    setSalvando(true)
    try {
      const atualizado = await resolverAlertaDuplicidade(
        lote.id,
        { filCod: item.filCod, docCod: item.docCod, titCod: item.titCod },
        alerta.id,
        { acao: escolha, ...(texto.trim() ? { justificativa: texto.trim() } : {}) },
      )
      onResolvida(atualizado, escolha)
    } catch (err) {
      setErroServidor(err instanceof Error ? err.message : 'Não foi possível tratar a alerta.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberto) => {
        if (!salvando) onOpenChange(aberto)
      }}
    >
      <DialogContent size="md">
        <form onSubmit={confirmar} noValidate>
          <DialogHeader>
            <DialogTitle>Possível pagamento em duplicidade</DialogTitle>
            <DialogDescription>
              Título {titulo}
              {item.credor ? ` (${item.credor})` : ''}
              {item.valor != null ? ` · ${formatBRL(item.valor)}` : ''}. Outro documento do mesmo
              favorecido: doc {alerta.contraparteDocCod ?? '—'} ({ROTULO_TIPO[alerta.tipo] ?? alerta.tipo}).
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            {alerta.contraparteTitulos?.length ? (
              <ul className="space-y-1 text-sm" aria-label="Títulos do outro documento">
                {alerta.contraparteTitulos.map((t) => (
                  <li key={t.titCod} className="flex flex-wrap gap-x-3 tabular-nums text-muted-foreground">
                    <span>
                      doc {alerta.contraparteDocCod}/{t.titCod}
                    </span>
                    <span>{formatBRL(t.valor)}</span>
                    <span>venc. {formatErpDay(t.vencimento)}</span>
                    <span className={t.pago ? 'font-medium text-warning' : ''}>
                      {t.pago ? 'já pago' : 'em aberto'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">O que fazer com este item?</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`escolha-${alerta.id}`}
                  value="JUSTIFICAR"
                  checked={escolha === 'JUSTIFICAR'}
                  onChange={() => setEscolha('JUSTIFICAR')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Manter e justificar</span> — não é duplicidade; o
                  item segue no lote e a justificativa vai para o conferente.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name={`escolha-${alerta.id}`}
                  value="RETIRAR"
                  checked={escolha === 'RETIRAR'}
                  onChange={() => setEscolha('RETIRAR')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Retirar do lote</span> — é duplicidade; o título
                  fica bloqueado para novos lotes.
                </span>
              </label>
            </fieldset>

            {escolha === 'RETIRAR' ? (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  Cancele o documento duplicado no Conexos. O sistema não cancela nada no ERP: o
                  bloqueio só sai quando o título sumir da carteira ou alguém o desfizer com motivo.
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor={campoId}>
                {escolha === 'JUSTIFICAR' ? 'Justificativa' : 'Motivo (opcional)'}
              </Label>
              <Textarea
                id={campoId}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value)
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
            <Button
              type="submit"
              variant={escolha === 'RETIRAR' ? 'destructive' : 'default'}
              disabled={salvando}
            >
              {salvando ? <Spinner aria-hidden /> : null}
              {escolha === 'RETIRAR' ? 'Retirar do lote' : 'Manter e justificar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

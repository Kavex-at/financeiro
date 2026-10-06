'use client'

import * as React from 'react'
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
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  conferirLote,
  devolverLote,
  ehDuplicidade,
  type ItemLote,
  type LotePagamento,
  ROTULO_CANAL,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

const ORIGEM: Record<NonNullable<ItemLote['destinoOrigem']>, string> = {
  CADASTRO: 'cadastro',
  EXCECAO: 'exceção',
  NENHUM: 'sem destino',
}

/** Destino que a verificação viu: origem + máscara. Nunca o valor completo (I10h). */
function DestinoConferido({ item }: { item: ItemLote }) {
  if (!item.destinoOrigem) return <span className="text-xs text-muted-foreground">não verificado</span>
  return (
    <div className="flex flex-col gap-0.5">
      <Badge
        variant="outline"
        className={`w-fit ${item.destinoOrigem === 'EXCECAO' ? 'border-warning/40 text-warning' : ''}`}
      >
        {ORIGEM[item.destinoOrigem]}
      </Badge>
      {item.destinoMascarado ? (
        <span className="text-xs tabular-nums text-muted-foreground">{item.destinoMascarado}</span>
      ) : null}
    </div>
  )
}

/** Alertas do item como o conferente precisa ver: duplicidade COM a justificativa e canal. */
function AlertasConferidas({ item }: { item: ItemLote }) {
  const alertas = item.alertas ?? []
  if (alertas.length === 0) return <span className="text-xs text-muted-foreground">nenhuma</span>
  return (
    <ul className="space-y-1">
      {alertas.map((a) =>
        ehDuplicidade(a) ? (
          <li key={a.id} className="text-xs">
            <span className="font-medium text-warning">
              duplicidade com doc {a.contraparteDocCod ?? '—'}
            </span>
            {a.justificativa ? (
              <span className="block text-muted-foreground">
                justificada por {a.resolvidoPor ?? '—'}: “{a.justificativa}”
              </span>
            ) : (
              <span className="block text-danger">sem justificativa</span>
            )}
          </li>
        ) : (
          <li key={a.id} className="text-xs text-muted-foreground">
            canal habitual: {ROTULO_CANAL[String(a.evidencia.grupoDominante)] ?? '—'} (não TED/PIX)
          </li>
        ),
      )}
    </ul>
  )
}

/**
 * Conferência por segunda pessoa do lote com TED/PIX (ADR-0063, I13l; L12/L13). Mostra, por item
 * TED/PIX: favorecido, destino MASCARADO e sua origem, valor, alertas de duplicidade com a
 * justificativa e alerta de canal. Boletos aparecem só contados. Quem confere não pode ter
 * finalizado, incluído item nem montado o lote — o backend recusa (403) e a mensagem aparece aqui.
 */
export function ConferenciaLoteDialog({
  lote,
  onOpenChange,
  onConcluida,
}: {
  lote: LotePagamento
  onOpenChange: (open: boolean) => void
  onConcluida: (lote: LotePagamento, acao: 'conferido' | 'devolvido') => void
}) {
  const [devolvendo, setDevolvendo] = React.useState(false)
  const [motivo, setMotivo] = React.useState('')
  const [erroCampo, setErroCampo] = React.useState<string | null>(null)
  const [erroServidor, setErroServidor] = React.useState<string | null>(null)
  const [salvando, setSalvando] = React.useState(false)
  const tedPix = lote.itens.filter((i) => i.modalidade === 'TED' || i.modalidade === 'PIX')
  const outros = lote.itens.length - tedPix.length
  const campoId = `devolucao-${lote.id}`

  async function executar(acao: 'conferir' | 'devolver') {
    if (salvando) return
    if (acao === 'devolver' && motivo.trim() === '') {
      setErroCampo('Informe o motivo da devolução.')
      return
    }
    setErroCampo(null)
    setErroServidor(null)
    setSalvando(true)
    try {
      const atualizado =
        acao === 'conferir'
          ? await conferirLote(lote.id, lote.versao)
          : await devolverLote(lote.id, lote.versao, motivo.trim())
      onConcluida(atualizado, acao === 'conferir' ? 'conferido' : 'devolvido')
    } catch (err) {
      setErroServidor(err instanceof Error ? err.message : 'Não foi possível concluir.')
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
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Conferir pagamentos TED/PIX</DialogTitle>
          <DialogDescription>
            Filial {lote.filCod} · finalizado por {lote.finalizadoPor ?? '—'}. Confira cada pagamento
            antes da remessa
            {outros > 0 ? ` (${outros} boleto(s) do lote não passam por conferência)` : ''}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Favorecido</TableHead>
                  <TableHead>Forma</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Alertas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tedPix.map((i) => (
                  <TableRow key={`${i.docCod}:${i.titCod}`}>
                    <TableCell className="max-w-[14rem]">
                      <span className="block truncate">{i.credor ?? '—'}</span>
                      <span className="text-xs text-muted-foreground">
                        {i.docCod}/{i.titCod}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">{i.modalidade}</TableCell>
                    <TableCell>
                      <DestinoConferido item={i} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {i.valor != null ? formatBRL(i.valor) : '—'}
                    </TableCell>
                    <TableCell>
                      <AlertasConferidas item={i} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {devolvendo ? (
            <div className="space-y-1.5">
              <Label htmlFor={campoId}>Motivo da devolução</Label>
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
          ) : null}
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
          {devolvendo ? (
            <Button
              type="button"
              variant="destructive"
              disabled={salvando}
              onClick={() => void executar('devolver')}
            >
              {salvando ? <Spinner aria-hidden /> : null}
              Devolver à analista
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={salvando}
                onClick={() => setDevolvendo(true)}
              >
                Devolver…
              </Button>
              <Button type="button" disabled={salvando} onClick={() => void executar('conferir')}>
                {salvando ? <Spinner aria-hidden /> : null}
                Confirmar conferência
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

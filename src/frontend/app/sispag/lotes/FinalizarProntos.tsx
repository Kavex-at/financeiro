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
import type { LotePagamento } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'
import { finalizarEmSequencia, type ResultadoFinalizacao, totalDoLote } from './prontidaoLotes'

const rotuloLote = (l: LotePagamento): string =>
  `Filial ${l.filCod} · ${l.itens.length} título(s) · ${formatBRL(totalDoLote(l))}`

/**
 * "Finalizar os N lotes prontos" (ADR-0076, D20): a faixa aparece quando há lote sem nenhuma
 * pendência. Confirma com a lista e o total, finaliza um lote por vez pelo endpoint de sempre e
 * mostra o resultado lote a lote. Um lote que falha não desfaz os outros.
 */
export function FinalizarProntos({
  prontos,
  finalizar,
  onConcluido,
}: {
  /** Só os lotes com prontidão PRONTO. Vazio = a faixa some. */
  prontos: LotePagamento[]
  finalizar: (l: LotePagamento) => Promise<{ retirados: unknown[] }>
  /** Recarrega lotes e painel depois do lote final (com ou sem falhas). */
  onConcluido: () => void | Promise<void>
}) {
  const [aberto, setAberto] = React.useState(false)
  const [alvo, setAlvo] = React.useState<LotePagamento[]>([])
  const [feitos, setFeitos] = React.useState<number | null>(null)
  const [resultados, setResultados] = React.useState<ResultadoFinalizacao[] | null>(null)
  const rodando = feitos !== null && resultados === null

  if (prontos.length === 0 && !aberto) return null
  const soma = prontos.reduce((acc, l) => acc + totalDoLote(l), 0)
  const lista = resultados === null ? alvo : resultados.map((r) => r.lote)
  const finalizados = resultados?.filter((r) => r.ok).length ?? 0

  const abrir = () => {
    // A lista congela ao abrir: um recarregamento no meio não muda o que a pessoa confirmou.
    setAlvo(prontos)
    setFeitos(null)
    setResultados(null)
    setAberto(true)
  }
  const fechar = async () => {
    if (rodando) return
    setAberto(false)
    if (resultados !== null) await onConcluido()
  }
  const confirmar = async () => {
    setFeitos(0)
    setResultados(await finalizarEmSequencia(alvo, finalizar, setFeitos))
  }

  return (
    <>
      {prontos.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-success/40 bg-success-subtle/40 px-4 py-2.5 text-sm">
          <p>
            <span className="font-medium">
              {prontos.length === 1 ? '1 lote sem nenhuma pendência' : `${prontos.length} lotes sem nenhuma pendência`}
            </span>
            <span className="text-muted-foreground"> · {formatBRL(soma)}</span>
          </p>
          <Button size="sm" onClick={abrir}>
            {prontos.length === 1 ? 'Finalizar o lote pronto' : `Finalizar os ${prontos.length} lotes prontos`}
          </Button>
        </div>
      ) : null}
      <Dialog open={aberto} onOpenChange={(open) => (!open ? void fechar() : undefined)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>
              {resultados === null
                ? `Finalizar ${alvo.length === 1 ? '1 lote' : `${alvo.length} lotes`}`
                : `${finalizados} de ${resultados.length} lotes finalizados`}
            </DialogTitle>
            <DialogDescription>
              {resultados === null
                ? 'Cada lote é finalizado separadamente, com as mesmas conferências do botão Finalizar do card: a situação de pagamento e o favorecido TED/PIX são relidos no Conexos agora. Um lote que falhar não desfaz os outros.'
                : 'Os lotes finalizados seguem para a geração de remessa. Os que não finalizaram continuam em rascunho, com o motivo abaixo.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] overflow-y-auto">
            <ul className="divide-y rounded-md border text-sm" aria-label="Lotes a finalizar">
              {lista.map((l, i) => {
                const r = resultados?.[i]
                return (
                  <li key={l.id} className="space-y-1 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{rotuloLote(l)}</span>
                      {r ? (
                        <Badge
                          variant="outline"
                          className={
                            r.ok
                              ? 'border-success/40 text-success-foreground'
                              : 'border-danger/40 text-danger-foreground'
                          }
                        >
                          {r.ok ? 'Finalizado' : 'Não finalizado'}
                        </Badge>
                      ) : rodando && i < (feitos ?? 0) ? (
                        <span className="text-xs text-muted-foreground">feito</span>
                      ) : null}
                    </div>
                    {r && !r.ok && r.mensagem ? (
                      <p className="text-xs text-muted-foreground">{r.mensagem}</p>
                    ) : null}
                    {r?.ok && r.retirados ? (
                      <p className="text-xs text-muted-foreground">
                        {r.retirados === 1
                          ? '1 item TED/PIX saiu pela verificação do favorecido.'
                          : `${r.retirados} itens TED/PIX saíram pela verificação do favorecido.`}
                      </p>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </DialogBody>
          <DialogFooter>
            {resultados === null ? (
              <>
                <Button variant="outline" onClick={() => void fechar()} disabled={rodando}>
                  Cancelar
                </Button>
                <Button onClick={() => void confirmar()} disabled={rodando}>
                  {rodando
                    ? `Finalizando ${Math.min((feitos ?? 0) + 1, alvo.length)} de ${alvo.length}…`
                    : alvo.length === 1
                      ? 'Finalizar 1 lote'
                      : `Finalizar ${alvo.length} lotes`}
                </Button>
              </>
            ) : (
              <Button onClick={() => void fechar()}>Fechar</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

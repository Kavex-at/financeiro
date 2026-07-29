'use client'

import * as React from 'react'
import { Boxes, CheckCircle2, ChevronRight, Landmark } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { formatBRL } from '@/lib/utils'
import {
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
  type Processo,
  type SolicitacaoNumerarioDryRun,
  type TransacaoBancaria,
} from '@/lib/recebimentos'

interface AlocarProcessosDialogProps {
  transacao: TransacaoBancaria | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Preview colapsável do payload dry-run (JSON monoespaçado). */
function PayloadPreview({ resultado }: { resultado: SolicitacaoNumerarioDryRun }) {
  const [aberto, setAberto] = React.useState(true)
  return (
    <Collapsible open={aberto} onOpenChange={setAberto} className="mt-2">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
          <ChevronRight
            className={`size-3 transition-transform ${aberto ? 'rotate-90' : ''}`}
            aria-hidden
          />
          Payload da simulação ({resultado.docConfig.gcdDesNome})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed">
          {JSON.stringify(resultado.payload, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * AlocarProcessosDialog — modal aberto pelo botão "Alocar" de uma transação. Lista os PROCESSOS
 * candidatos e, em cada linha, um botão "Processar" que gera a **Solicitação de Numerário
 * (encomenda)** em DRY-RUN (nada é enviado ao ERP). Mostra o payload previsto + marca a linha como
 * "processado (simulação)". Feature code domain-aware (NÃO é um átomo do DS).
 */
export function AlocarProcessosDialog({
  transacao,
  open,
  onOpenChange,
}: AlocarProcessosDialogProps) {
  const [loading, setLoading] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [processos, setProcessos] = React.useState<Processo[]>([])
  const [processandoPri, setProcessandoPri] = React.useState<number | null>(null)
  const [resultados, setResultados] = React.useState<Record<number, SolicitacaoNumerarioDryRun>>({})

  React.useEffect(() => {
    if (!open || !transacao) return
    let cancelado = false
    setLoading(true)
    setErro(null)
    setResultados({})
    fetchProcessosParaTransacao(transacao.id, transacao.filCod, transacao.contraparte)
      .then((lista) => {
        if (!cancelado) setProcessos(lista)
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar processos.')
      })
      .finally(() => {
        if (!cancelado) setLoading(false)
      })
    return () => {
      cancelado = true
    }
  }, [open, transacao])

  const processar = async (processo: Processo) => {
    if (!transacao) return
    setProcessandoPri(processo.priCod)
    try {
      const resultado = await processarSolicitacaoNumerario(
        transacao.id,
        processo,
        transacao.valor,
      )
      setResultados((prev) => ({ ...prev, [processo.priCod]: resultado }))
      toast.success('Solicitação de Numerário (encomenda) — simulação gerada (dry-run).', {
        description: 'Nada foi enviado ao ERP.',
      })
    } catch {
      toast.error('Não foi possível gerar a simulação.')
    } finally {
      setProcessandoPri(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Alocar processos</DialogTitle>
          <DialogDescription>
            {transacao ? (
              <>
                Transação {transacao.contraparte ?? '—'} · {formatBRL(transacao.valor)} · filial{' '}
                {transacao.filCod}. Escolha um processo e clique em <strong>Processar</strong> para
                gerar a Solicitação de Numerário (encomenda) — <strong>simulação (dry-run)</strong>,
                nada é enviado ao ERP.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-info/40 bg-info/5 p-3 text-sm">
            <Landmark className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <div>
              <span className="font-medium">Dry-run.</span> &ldquo;Processar&rdquo; apenas constrói o
              payload do com299 (<code>gerDocProcesso</code>). Nenhuma chamada de escrita é feita ao
              Conexos.
            </div>
          </div>

          {loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Carregando processos">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : erro ? (
            <EmptyState
              icon={<Boxes className="size-6" aria-hidden />}
              title="Não foi possível carregar"
              description={erro}
            />
          ) : processos.length === 0 ? (
            <EmptyState
              icon={<Boxes className="size-6" aria-hidden />}
              title="Nenhum processo candidato"
              description="Não há processos candidatos para esta transação (filial/contraparte). Ajuste a conciliação manualmente."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Processo</TableHead>
                    <TableHead>Ref. cliente</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processos.map((p) => {
                    const resultado = resultados[p.priCod]
                    const processado = Boolean(resultado)
                    return (
                      <React.Fragment key={p.priCod}>
                        <TableRow>
                          <TableCell className="font-mono text-xs">{p.priCod}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {p.priEspRefcliente}
                          </TableCell>
                          <TableCell className="max-w-[16rem] truncate font-medium">
                            {p.dpeNomPessoa}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.valor !== undefined ? formatBRL(p.valor) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            {processado ? (
                              <Badge variant="secondary" className="gap-1">
                                <CheckCircle2 className="size-3" aria-hidden />
                                processado (simulação)
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => void processar(p)}
                                disabled={processandoPri === p.priCod}
                              >
                                {processandoPri === p.priCod ? (
                                  <Spinner className="size-4" />
                                ) : null}
                                Processar
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {resultado ? (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-muted/20">
                              <PayloadPreview resultado={resultado} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </React.Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

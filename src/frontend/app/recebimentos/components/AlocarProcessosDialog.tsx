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
import { Combobox } from '@/components/ui/combobox'
import {
  fetchClientes,
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
  type ClienteProcesso,
  type Processo,
  type SolicitacaoNumerarioDryRun,
  type TransacaoBancaria,
} from '@/lib/recebimentos'

interface AlocarProcessosDialogProps {
  transacao: TransacaoBancaria | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Normaliza para comparar nomes: sem acento, sem pontuação, caixa alta. */
const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

/**
 * Sugere o cliente a partir do histórico do extrato.
 *
 * O banco trunca o histórico em ~24 caracteres — `"TED 745.0001.BROWN-FORMA"`
 * para BROWN-FORMAN, `"SISPAG BELLIZ INDUSTRIA"` para BELLIZ INDUSTRIA, COMERCIO,
 * IMPORTA… Por isso o casamento é por PREFIXO nos dois sentidos, e o resultado é
 * só uma pré-seleção visível: quem confirma é o analista.
 */
export const sugerirCliente = (
  clientes: ClienteProcesso[],
  contraparte?: string,
): number | null => {
  const alvo = normalizar(contraparte ?? '')
  if (alvo.length < 4) return null

  let melhor: { pesCod: number; score: number } | null = null
  for (const c of clientes) {
    const nome = normalizar(c.dpeNomPessoa)
    if (nome.length < 4) continue
    // Prefixo comum: o truncamento corta o FIM, então o começo é o que sobrevive.
    let i = 0
    while (i < nome.length && i < alvo.length && nome[i] === alvo[i]) i++
    if (i < 4) continue
    if (!melhor || i > melhor.score) melhor = { pesCod: c.pesCod, score: i }
  }
  return melhor?.pesCod ?? null
}

/** Preview colapsável do payload dry-run (JSON monoespaçado). */
function PayloadPreview({
  resultado,
  processo,
}: {
  resultado: SolicitacaoNumerarioDryRun
  processo: Processo
}) {
  // FECHADO por padrão: o JSON cru é ferramenta de quem valida o contrato com o
  // ERP, não informação para o analista. O que ele precisa saber vai no resumo.
  const [aberto, setAberto] = React.useState(false)

  // Placeholders que ainda NÃO foram confirmados contra o ERP. Enquanto a
  // geração é dry-run isso é inofensivo; no dia em que virar POST real, cada um
  // destes é um documento errado. Melhor o analista ver agora.
  const pendencias: string[] = []
  if (resultado.docConfig.gcdCod === 0) {
    pendencias.push('código da configuração de documento (gcdCod) ainda não confirmado no ERP')
  }
  if (processo.moeCodAssumido) {
    pendencias.push('moeda assumida como BRL — o imp021 não informa a moeda do processo')
  }
  pendencias.push('valor = valor cheio do crédito; o percentual da encomenda não está definido')

  return (
    <div className="mt-2 space-y-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Documento</dt>
        <dd className="font-medium">{resultado.docConfig.gcdDesNome}</dd>
        <dt className="text-muted-foreground">Processo</dt>
        <dd>
          {resultado.payload.priCod}
          {resultado.payload.priEspRefcliente ? ` · ${resultado.payload.priEspRefcliente}` : ''}
        </dd>
        <dt className="text-muted-foreground">Valor</dt>
        <dd>{formatBRL(resultado.payload.valor)}</dd>
      </dl>

      <div className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs">
        <span className="font-medium">Ainda não é um documento válido.</span>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
          {pendencias.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>

      <Collapsible open={aberto} onOpenChange={setAberto}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
            <ChevronRight
              className={`size-3 transition-transform ${aberto ? 'rotate-90' : ''}`}
              aria-hidden
            />
            {aberto ? 'Ocultar' : 'Ver'} payload técnico
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre
            tabIndex={0}
            className="mt-1 max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed"
          >
            {JSON.stringify(resultado.payload, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
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
  const [carregandoClientes, setCarregandoClientes] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [clientes, setClientes] = React.useState<ClienteProcesso[]>([])
  const [pesCod, setPesCod] = React.useState<number | null>(null)
  const [processos, setProcessos] = React.useState<Processo[]>([])
  const [processandoPri, setProcessandoPri] = React.useState<number | null>(null)
  const [resultados, setResultados] = React.useState<Record<number, SolicitacaoNumerarioDryRun>>({})

  // Ao abrir: carrega os clientes (multi-filial) e PRÉ-SELECIONA o melhor palpite
  // pelo histórico do extrato. Pré-seleção é sugestão visível e trocável — nunca
  // filtro invisível (o invariante do ADR-0022 é que o humano confirma).
  React.useEffect(() => {
    if (!open || !transacao) return
    let cancelado = false
    setCarregandoClientes(true)
    setErro(null)
    setResultados({})
    setProcessos([])
    setPesCod(null)

    fetchClientes()
      .then((lista) => {
        if (cancelado) return
        setClientes(lista)
        setPesCod(sugerirCliente(lista, transacao.contraparte))
      })
      .catch((e) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Falha ao carregar clientes.')
      })
      .finally(() => {
        if (!cancelado) setCarregandoClientes(false)
      })
    return () => {
      cancelado = true
    }
  }, [open, transacao])

  // Busca os processos SÓ depois que há cliente escolhido.
  React.useEffect(() => {
    if (!open || !transacao || pesCod === null) return
    let cancelado = false
    setLoading(true)
    setErro(null)
    setResultados({})
    fetchProcessosParaTransacao(transacao.id, pesCod)
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
  }, [open, transacao, pesCod])

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
    } catch (e) {
      // Sem fallback local: se o backend caiu, o analista PRECISA ver o erro —
      // um payload inventado no navegador com toast verde é pior que uma falha.
      toast.error('Não foi possível gerar a simulação.', {
        description: e instanceof Error ? e.message : undefined,
      })
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

        <DialogBody className="flex flex-col overflow-hidden">
          <div className="mb-3 flex shrink-0 items-start gap-2 rounded-lg border border-info/40 bg-info/5 p-3 text-sm">
            <Landmark className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
            <div>
              <span className="font-medium">Dry-run.</span> &ldquo;Processar&rdquo; apenas constrói o
              payload do com299 (<code>gerDocProcesso</code>). Nenhuma chamada de escrita é feita ao
              Conexos.
            </div>
          </div>

          {/* Seletor de cliente: fica FORA da árvore de estados abaixo, senão o
              usuário não consegue corrigir a escolha quando a lista está vazia. */}
          <div className="mb-4 shrink-0 space-y-1.5">
            <label htmlFor="cliente-alocar" className="text-sm font-medium">
              Cliente
            </label>
            {carregandoClientes ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Combobox
                id="cliente-alocar"
                aria-label="Cliente do recebimento"
                options={clientes.map((c) => {
                  const filiais = c.filiais ?? []
                  const filHint =
                    filiais.length === 1
                      ? ` · fil ${filiais[0]}`
                      : filiais.length > 1
                        ? ` · ${filiais.length} filiais`
                        : ''
                  return {
                    value: String(c.pesCod),
                    label: c.dpeNomPessoa,
                    hint: `${c.processosAbertos} processo${c.processosAbertos === 1 ? '' : 's'}${filHint}`,
                  }
                })}
                value={pesCod === null ? null : String(pesCod)}
                onChange={(v) => setPesCod(v === null ? null : Number(v))}
                placeholder="Escolha o cliente…"
                searchPlaceholder="Buscar cliente…"
                emptyMessage="Nenhum cliente com processo aberto em nenhuma filial acessível."
              />
            )}
            {processos.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {processos.length} processo{processos.length === 1 ? '' : 's'} aberto
                {processos.length === 1 ? '' : 's'} para este cliente.
              </p>
            ) : null}
            {transacao?.contraparte ? (
              <p className="text-xs text-muted-foreground">
                Histórico do banco:{' '}
                <code className="rounded bg-muted px-1 py-0.5">{transacao.contraparte}</code> — o
                banco trunca o texto, confira o cliente.
              </p>
            ) : null}
          </div>

          {erro ? (
            <EmptyState
              icon={<Boxes className="size-6" aria-hidden />}
              title="Não foi possível carregar"
              description={erro}
            />
          ) : pesCod === null ? (
            <EmptyState
              icon={<Boxes className="size-6" aria-hidden />}
              title="Escolha o cliente"
              description="O extrato bancário não identifica o pagador — selecione o cliente acima para ver os processos dele."
            />
          ) : loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Carregando processos">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : processos.length === 0 ? (
            <EmptyState
              icon={<Boxes className="size-6" aria-hidden />}
              title="Nenhum processo aberto"
              description="Este cliente não tem processo aberto em nenhuma filial acessível. Escolha outro cliente ou trate a conciliação manualmente."
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto rounded-lg border">
              <Table>
                {/* Sticky: com dezenas de processos, perder o cabeçalho ao rolar
                    deixa o usuário sem saber qual coluna é qual. */}
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Processo</TableHead>
                    <TableHead>Filial</TableHead>
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
                          <TableCell className="tabular-nums text-xs">{p.filCod}</TableCell>
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
                            <TableCell colSpan={6} className="bg-muted/20">
                              <PayloadPreview resultado={resultado} processo={p} />
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

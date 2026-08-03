'use client'

import * as React from 'react'
import { AlertTriangle, Boxes, CheckCircle2, Landmark } from 'lucide-react'
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
import { MoneyInput } from '@/components/ui/money-input'
import { formatBRL } from '@/lib/utils'
import { numToMask, parseBrl } from '@/lib/brl'
import { Combobox } from '@/components/ui/combobox'
import {
  fetchClientes,
  fetchProcessosParaTransacao,
  processarSolicitacaoNumerario,
  type AlocacaoResultado,
  type ClienteProcesso,
  type Processo,
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

/** Tolerância (centavos) ao comparar o valor da linha com o saldo restante. */
const SALDO_TOL = 0.005

/**
 * Resultado REAL de uma alocação renderizado na linha. O status carrega o desfecho
 * — `settled` (quitado), `error` (falhou numa etapa), `dry-run` (simulação do backend).
 * Badges usam tokens semânticos do DS (`-subtle`/`-foreground`), não uma variante nova.
 */
function ResultadoAlocacao({ resultado }: { resultado: AlocacaoResultado }) {
  if (resultado.status === 'error') {
    return (
      <div className="mt-2 space-y-1 text-sm">
        <Badge className="border-transparent bg-danger-subtle text-danger-foreground">
          <AlertTriangle aria-hidden /> Falhou{resultado.etapa ? ` em ${resultado.etapa}` : ''}
        </Badge>
        {resultado.erro ? (
          <p className="text-xs text-muted-foreground">{resultado.erro}</p>
        ) : null}
      </div>
    )
  }

  if (resultado.status === 'dry-run') {
    return (
      <div className="mt-2">
        <Badge className="border-transparent bg-info-subtle text-info-foreground">
          <Landmark aria-hidden /> Simulação (dry-run)
        </Badge>
      </div>
    )
  }

  // settled (e skipped — já concluído numa execução anterior, tratado como quitado).
  const revisaoPendente =
    resultado.revisaoHumana === true || resultado.docVldComvalidacoes === 2
  const aguardandoSefaz = resultado.vldAutorizado === 0

  return (
    <div className="mt-2 space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-success-subtle text-success-foreground">
          <CheckCircle2 aria-hidden /> Quitado
        </Badge>
        {revisaoPendente ? (
          <Badge className="border-transparent bg-warning-subtle text-warning-foreground">
            <AlertTriangle aria-hidden /> Homologado — revisão pendente
          </Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {resultado.snDocCod !== undefined ? (
          <>
            <dt className="text-muted-foreground">Solicitação de Numerário</dt>
            <dd className="font-mono tabular-nums">{resultado.snDocCod}</dd>
          </>
        ) : null}
        {resultado.borCod !== undefined ? (
          <>
            <dt className="text-muted-foreground">Borderô (baixa)</dt>
            <dd className="font-mono tabular-nums">{resultado.borCod}</dd>
          </>
        ) : null}
        {resultado.ndDocCod !== undefined ? (
          <>
            <dt className="text-muted-foreground">Nota de débito</dt>
            <dd className="font-mono tabular-nums">{resultado.ndDocCod}</dd>
          </>
        ) : null}
      </dl>
      {aguardandoSefaz ? (
        <p className="text-xs text-info-foreground">Aguardando autorização SEFAZ</p>
      ) : null}
    </div>
  )
}

/**
 * AlocarProcessosDialog — modal aberto pelo botão "Alocar" de uma transação. Lista os PROCESSOS
 * candidatos; cada linha tem um valor EDITÁVEL (fatia do saldo do pagamento) e um botão "Processar"
 * que roda a automação REAL do Conexos (SN → baixa → nota de débito). Pagamentos podem ser
 * DIVIDIDOS entre processos: o `saldoRestante` diminui a cada alocação quitada. Feature code
 * domain-aware (NÃO é um átomo do DS).
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
  const [resultados, setResultados] = React.useState<Record<number, AlocacaoResultado>>({})
  // Valor editável por linha (string mascarada pt-BR). Vazio = ainda não tocado (usa o default).
  const [valores, setValores] = React.useState<Record<number, string>>({})

  const gerNum = transacao?.gerNum
  const contaAusente = gerNum === undefined || gerNum === null

  // Saldo do pagamento ainda não alocado = valor − Σ(alocações já quitadas). Split-safe:
  // "skipped" (já concluído antes) também consome. Erros e simulações NÃO consomem.
  const saldoRestante = React.useMemo(() => {
    if (!transacao) return 0
    const consumido = Object.entries(resultados).reduce((acc, [priCod, r]) => {
      if (r.status !== 'settled' && r.status !== 'skipped') return acc
      return acc + (parseBrl(valores[Number(priCod)] ?? '') || 0)
    }, 0)
    return Math.max(0, transacao.valor - consumido)
  }, [transacao, resultados, valores])

  // Valor efetivo (número) de uma linha: o digitado, ou o default = min(saldo, valor do processo).
  const valorDefault = (p: Processo): number =>
    Math.min(saldoRestante, p.valor ?? saldoRestante)

  // `undefined` = linha nunca tocada → usa o default; qualquer string (inclusive "")
  // = o analista digitou → respeita o que está no campo (vazio conta como 0, o que
  // desabilita o Processar). Isso torna o input limpável.
  const valorLinha = (p: Processo): number => {
    const bruto = valores[p.priCod]
    if (bruto === undefined) return valorDefault(p)
    return parseBrl(bruto) || 0
  }

  // Ao abrir: carrega os clientes (multi-filial) e PRÉ-SELECIONA o melhor palpite
  // pelo histórico do extrato. Pré-seleção é sugestão visível e trocável — nunca
  // filtro invisível (o invariante do ADR-0022 é que o humano confirma).
  React.useEffect(() => {
    if (!open || !transacao) return
    let cancelado = false
    setCarregandoClientes(true)
    setErro(null)
    setResultados({})
    setValores({})
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
    setValores({})
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
    const valor = valorLinha(processo)
    setProcessandoPri(processo.priCod)
    try {
      const resultado = await processarSolicitacaoNumerario(transacao.id, {
        priCod: processo.priCod,
        valor,
        // Filial DO PROCESSO (pode diferir da do pagamento) — todo o fluxo Conexos roda nela.
        filCod: processo.filCod,
        priEspRefcliente: processo.priEspRefcliente,
        pesCod: processo.pesCod,
        dpeNomPessoa: processo.dpeNomPessoa,
        moeCod: processo.moeCod,
      })
      // Congela o valor efetivamente processado nesta linha para o cálculo do saldo.
      setValores((prev) => ({ ...prev, [processo.priCod]: numToMask(valor) }))
      setResultados((prev) => ({ ...prev, [processo.priCod]: resultado }))

      if (resultado.status === 'error') {
        toast.error('A alocação falhou no Conexos.', {
          description: resultado.etapa ? `Etapa: ${resultado.etapa}` : resultado.erro,
        })
      } else if (resultado.dryRun || resultado.status === 'dry-run') {
        toast.success('Simulação gerada (dry-run).', { description: 'Nada foi enviado ao ERP.' })
      } else {
        toast.success('Alocação processada no Conexos.', {
          description: 'SN, baixa e nota de débito gerados.',
        })
      }
    } catch (e) {
      // Sem fallback local: se o backend caiu, o analista PRECISA ver o erro — um
      // sucesso inventado no navegador com toast verde é pior que uma falha real.
      toast.error('Não foi possível processar a alocação.', {
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
                {transacao.filCod}
                {!contaAusente ? (
                  <>
                    {' '}
                    · conta financeira <strong>{gerNum}</strong>
                  </>
                ) : null}
                . Escolha um processo, confira o valor e clique em <strong>Processar</strong>.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col overflow-hidden">
          <div className="mb-3 flex shrink-0 items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div>
              <span className="font-medium">Ação real.</span> &ldquo;Processar&rdquo; gera SN, baixa
              e nota de débito no Conexos. Não é simulação.
            </div>
          </div>

          {contaAusente ? (
            <div
              className="mb-3 flex shrink-0 items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div>
                <span className="font-medium">Sem conta financeira.</span> Este pagamento não tem{' '}
                <code>gerNum</code> — a baixa não sabe em qual conta lançar. Processar está
                bloqueado.
              </div>
            </div>
          ) : (
            <div className="mb-3 shrink-0 text-sm text-muted-foreground">
              Saldo a alocar:{' '}
              <strong className="tabular-nums text-foreground">{formatBRL(saldoRestante)}</strong> de{' '}
              <span className="tabular-nums">{formatBRL(transacao?.valor ?? 0)}</span>.
            </div>
          )}

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
                    <TableHead className="text-right">Valor a alocar</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processos.map((p) => {
                    const resultado = resultados[p.priCod]
                    const processado = Boolean(resultado) && resultado.status !== 'error'
                    const valor = valorLinha(p)
                    const excedeSaldo = valor > saldoRestante + SALDO_TOL
                    const invalido = valor <= 0 || excedeSaldo || contaAusente
                    const emAndamento = processandoPri === p.priCod
                    const valorMascarado =
                      valores[p.priCod] !== undefined
                        ? valores[p.priCod]
                        : numToMask(valorDefault(p))
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
                          <TableCell className="text-right">
                            {processado ? (
                              <span className="tabular-nums">{formatBRL(valor)}</span>
                            ) : (
                              <MoneyInput
                                value={valorMascarado}
                                onChange={(masked) =>
                                  setValores((prev) => ({ ...prev, [p.priCod]: masked }))
                                }
                                max={saldoRestante}
                                aria-label={`Valor a alocar no processo ${p.priCod}`}
                                aria-invalid={excedeSaldo || undefined}
                                className="w-32"
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {processado ? (
                              <Badge className="gap-1 border-transparent bg-success-subtle text-success-foreground">
                                <CheckCircle2 className="size-3" aria-hidden />
                                Processado
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => void processar(p)}
                                disabled={emAndamento || invalido}
                                aria-busy={emAndamento || undefined}
                                title={
                                  contaAusente
                                    ? 'Pagamento sem conta financeira (gerNum)'
                                    : excedeSaldo
                                      ? 'Valor acima do saldo disponível'
                                      : valor <= 0
                                        ? 'Informe um valor maior que zero'
                                        : undefined
                                }
                              >
                                {emAndamento ? <Spinner className="size-4" /> : null}
                                Processar
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                        {resultado ? (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-muted/20">
                              <ResultadoAlocacao resultado={resultado} />
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

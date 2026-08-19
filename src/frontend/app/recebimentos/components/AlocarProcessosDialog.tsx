'use client'

import * as React from 'react'
import { AlertTriangle, Boxes, CheckCircle2, FileText, Landmark } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { MoneyInput } from '@/components/ui/money-input'
import { formatBRL, formatDate } from '@/lib/utils'
import { numToMask, parseBrl } from '@/lib/brl'
import { Combobox } from '@/components/ui/combobox'
import {
  fetchClientes,
  fetchProcessosParaTransacao,
  fetchSNsDoProcesso,
  processarSolicitacaoNumerario,
  type AlocacaoResultado,
  type ClienteProcesso,
  type Processo,
  type SolicitacaoNumerarioListItem,
  type TransacaoBancaria,
} from '@/lib/recebimentos'

interface AlocarProcessosDialogProps {
  transacao: TransacaoBancaria | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Chamado depois de uma execução REAL que mexeu no estado do crédito (ADR-0034).
   *
   * Sem isto, o status recém-escrito no backend não chega à tela: a linha processada continuaria
   * na carteira até o analista clicar "Recarregar" à mão, e a impressão seria a de que a mudança
   * não funcionou — exatamente o sintoma que a ADR-0034 foi escrita para eliminar.
   *
   * NÃO dispara em dry-run: simulação não muda estado, e recarregar ali só piscaria a tela.
   */
  onProcessado?: () => void
}

/** Valor sentinela do radio "Criar novo SN" (default) — distinto de qualquer `docCod` real. */
const CRIAR_NOVO_SN = 'novo'

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

/**
 * Processos do mais RECENTE para o mais antigo (`priCod` decrescente).
 *
 * O `imp021` devolve na ordem dele e a rota concatena filial a filial, então a lista chegava sem
 * critério nenhum. `priCod` é sequencial no ERP, e o crédito que acabou de cair quase sempre é de um
 * processo novo — deixá-lo no topo poupa o analista de varrer a lista inteira. Ordenar aqui (e não
 * no servidor) porque a lista não é paginada: vem inteira, com os processos abertos de UM cliente.
 */
const ordenarProcessos = (lista: Processo[]): Processo[] =>
  [...lista].sort((a, b) => b.priCod - a.priCod)

/** Tolerância (centavos) ao comparar o valor da linha com o saldo restante. */
const SALDO_TOL = 0.005

/**
 * Desfechos que o analista pode TENTAR DE NOVO: `error` (falhou numa etapa do ERP) e `blocked` (o
 * pré-flight barrou antes de escrever — some depois que o cadastro for corrigido). Nos dois casos a
 * tela mantém o valor + o botão Processar e mostra o motivo embaixo; nenhum consome saldo.
 */
const isReprocessavel = (r?: AlocacaoResultado): boolean =>
  r?.status === 'error' || r?.status === 'blocked'

/**
 * Resultado REAL de uma alocação renderizado no painel. O status carrega o desfecho
 * — `settled` (quitado), `error` (falhou numa etapa), `blocked` (barrado no pré-flight, nada foi ao
 * ERP), `dry-run` (simulação do backend).
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
      <div className="mt-2 space-y-1 text-sm">
        <Badge className="border-transparent bg-info-subtle text-info-foreground">
          <Landmark aria-hidden /> Simulação (dry-run)
        </Badge>
        {resultado.ndeDispensada === true && resultado.motivo ? (
          <p className="text-xs text-muted-foreground">{resultado.motivo}</p>
        ) : null}
      </div>
    )
  }

  // `blocked`: o pré-flight barrou ANTES de escrever — nada foi ao ERP. Tem de aparecer como
  // pendência acionável (o `motivo` diz o que corrigir no cadastro), NUNCA como "Quitado".
  if (resultado.status === 'blocked') {
    return (
      <div className="mt-2 space-y-1 text-sm">
        <Badge className="border-transparent bg-warning-subtle text-warning-foreground">
          <AlertTriangle aria-hidden /> Não processado
        </Badge>
        {resultado.motivo ? (
          <p className="text-xs text-muted-foreground">{resultado.motivo}</p>
        ) : null}
      </div>
    )
  }

  // settled (e skipped — já concluído numa execução anterior, tratado como quitado).
  const revisaoPendente =
    resultado.revisaoHumana === true || resultado.docVldComvalidacoes === 2
  const aguardandoSefaz = resultado.vldAutorizado === 0
  const ndeDispensada = resultado.ndeDispensada === true

  return (
    <div className="mt-2 space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-transparent bg-success-subtle text-success-foreground">
          <CheckCircle2 aria-hidden /> Quitado
        </Badge>
        {ndeDispensada ? (
          <Badge className="border-transparent bg-info-subtle text-info-foreground">
            <Landmark aria-hidden /> Sem nota de débito
          </Badge>
        ) : null}
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
      {ndeDispensada && resultado.motivo ? (
        <p className="text-xs text-muted-foreground">{resultado.motivo}</p>
      ) : null}
      {aguardandoSefaz ? (
        <p className="text-xs text-info-foreground">Aguardando autorização SEFAZ</p>
      ) : null}
    </div>
  )
}

/** Chip do status de uma SN (best-effort do backend), sem cor sozinha (ícone + texto). */
function SnStatusBadge({ statusLabel }: { statusLabel: string }) {
  const finalizada = /finaliz/i.test(statusLabel)
  return (
    <Badge
      variant="outline"
      className={
        finalizada ? 'border-success/40 text-success' : 'border-muted-foreground/40 text-muted-foreground'
      }
      title={`Status da SN: ${statusLabel}`}
    >
      {finalizada ? (
        <CheckCircle2 className="size-3" aria-hidden />
      ) : (
        <FileText className="size-3" aria-hidden />
      )}
      {statusLabel}
    </Badge>
  )
}

/**
 * AlocarProcessosDialog — modal aberto pelo botão "Alocar" de uma transação. Layout de DOIS PAINÉIS
 * (ADR-0027): à ESQUERDA a lista de PROCESSOS candidatos (seleção por rádio); ao selecionar um
 * processo, à DIREITA surge o painel de SN, que lista as Solicitações de Numerário JÁ EXISTENTES do
 * processo + a opção "Criar novo SN" (default). "Processar" vive no painel direito e roda a automação
 * REAL do Conexos: SN existente → baixa + nota de débito contra o `docCod` escolhido; "Criar novo SN"
 * → fluxo completo (gera a SN). Pagamentos podem ser DIVIDIDOS entre processos (`saldoRestante` cai a
 * cada alocação quitada). Feature code domain-aware (NÃO é um átomo do DS).
 */
export function AlocarProcessosDialog({
  transacao,
  open,
  onOpenChange,
  onProcessado,
}: AlocarProcessosDialogProps) {
  const [loading, setLoading] = React.useState(false)
  const [carregandoClientes, setCarregandoClientes] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)
  const [clientes, setClientes] = React.useState<ClienteProcesso[]>([])
  const [pesCod, setPesCod] = React.useState<number | null>(null)
  const [processos, setProcessos] = React.useState<Processo[]>([])
  const [selectedPriCod, setSelectedPriCod] = React.useState<number | null>(null)
  const [processandoPri, setProcessandoPri] = React.useState<number | null>(null)
  const [resultados, setResultados] = React.useState<Record<number, AlocacaoResultado>>({})
  // Valor editável por processo (string mascarada pt-BR). Vazio = ainda não tocado (usa o default).
  const [valores, setValores] = React.useState<Record<number, string>>({})

  // SN por processo: lista carregada + estados + a opção escolhida (docCod ou "novo").
  const [sns, setSns] = React.useState<Record<number, SolicitacaoNumerarioListItem[]>>({})
  const [carregandoSns, setCarregandoSns] = React.useState(false)
  const [erroSns, setErroSns] = React.useState<string | null>(null)
  // Escolha do painel direito: "novo" (default) ou o docCod (string) de uma SN existente.
  const [snEscolhida, setSnEscolhida] = React.useState<string>(CRIAR_NOVO_SN)

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

  // Valor efetivo (número) de um processo: o digitado, ou o default = min(saldo, valor do processo).
  const valorDefault = (p: Processo): number =>
    Math.min(saldoRestante, p.valor ?? saldoRestante)

  // `undefined` = processo nunca tocado → usa o default; qualquer string (inclusive "")
  // = o analista digitou → respeita o campo (vazio conta como 0, o que desabilita o Processar).
  const valorProcesso = (p: Processo): number => {
    const bruto = valores[p.priCod]
    if (bruto === undefined) return valorDefault(p)
    return parseBrl(bruto) || 0
  }

  const processoSelecionado = React.useMemo(
    () => processos.find((p) => p.priCod === selectedPriCod) ?? null,
    [processos, selectedPriCod],
  )

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
    setSelectedPriCod(null)
    setSns({})
    setSnEscolhida(CRIAR_NOVO_SN)
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
    setProcessos([])
    setSelectedPriCod(null)
    setSns({})
    setSnEscolhida(CRIAR_NOVO_SN)
    fetchProcessosParaTransacao(transacao.id, pesCod)
      .then((lista) => {
        if (!cancelado) setProcessos(ordenarProcessos(lista))
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

  // Ao selecionar um processo à esquerda: reseta a escolha p/ "Criar novo SN" e busca as SN
  // existentes do processo (cacheadas por priCod para não re-buscar ao voltar num processo).
  React.useEffect(() => {
    if (processoSelecionado === null) return
    setSnEscolhida(CRIAR_NOVO_SN)
    setErroSns(null)
    if (sns[processoSelecionado.priCod] !== undefined) return
    let cancelado = false
    setCarregandoSns(true)
    fetchSNsDoProcesso(processoSelecionado.priCod, processoSelecionado.filCod)
      .then((lista) => {
        if (!cancelado) setSns((prev) => ({ ...prev, [processoSelecionado.priCod]: lista }))
      })
      .catch((e) => {
        if (!cancelado) setErroSns(e instanceof Error ? e.message : 'Falha ao carregar as SN.')
      })
      .finally(() => {
        if (!cancelado) setCarregandoSns(false)
      })
    return () => {
      cancelado = true
    }
    // Só reage à troca do processo selecionado (não ao objeto `sns` recém-preenchido).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processoSelecionado?.priCod, processoSelecionado?.filCod])

  /**
   * Escolha de SN → preenche o "Valor a alocar" com `min(valor da SN, saldo restante)`.
   *
   * O default do campo é o saldo INTEIRO do crédito (o `imp021` não expõe valor de processo, então
   * não há outro teto). Quando o analista aponta uma SN existente, ele disse qual dívida está
   * quitando: partir do valor dela evita digitar à mão o número que está na tela logo acima, e o
   * `min` garante que a sugestão nunca proponha alocar mais do que sobrou do pagamento.
   *
   * Voltar para "Criar novo SN" LIMPA o campo, que volta ao default — não existe SN de referência,
   * então manter o valor da anterior seria arrastar um número sem dono.
   *
   * SN com valor não-positivo não preenche nada: prefixar `0,00` deixaria "Processar" travado com
   * uma mensagem de valor inválido logo depois de um clique que deveria ajudar.
   */
  const escolherSn = (escolha: string, sn?: SolicitacaoNumerarioListItem) => {
    setSnEscolhida(escolha)
    if (processoSelecionado === null) return
    const priCod = processoSelecionado.priCod
    if (escolha === CRIAR_NOVO_SN) {
      setValores((prev) => {
        const { [priCod]: _removido, ...resto } = prev
        return resto
      })
      return
    }
    if (sn === undefined || !(sn.valor > 0)) return
    setValores((prev) => ({ ...prev, [priCod]: numToMask(Math.min(sn.valor, saldoRestante)) }))
  }

  const processar = async (processo: Processo) => {
    if (!transacao) return
    const valor = valorProcesso(processo)
    const snDocCod = snEscolhida === CRIAR_NOVO_SN ? undefined : Number(snEscolhida)
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
        // SN existente escolhida (ADR-0027); omitida em "Criar novo SN".
        ...(snDocCod !== undefined ? { snDocCod } : {}),
      })
      // Congela o valor efetivamente processado neste processo para o cálculo do saldo.
      setValores((prev) => ({ ...prev, [processo.priCod]: numToMask(valor) }))
      setResultados((prev) => ({ ...prev, [processo.priCod]: resultado }))

      // Avisa a página para recarregar (ADR-0034). Vale para settled E para error: os dois mudam o
      // status do crédito no backend, e a carteira precisa refletir os dois. `blocked` e dry-run
      // ficam de fora porque nada foi escrito.
      const mexeuNoEstado =
        !resultado.dryRun &&
        resultado.status !== 'dry-run' &&
        resultado.status !== 'blocked'
      if (mexeuNoEstado) onProcessado?.()

      if (resultado.status === 'error') {
        toast.error('A alocação falhou no Conexos.', {
          description: resultado.etapa ? `Etapa: ${resultado.etapa}` : resultado.erro,
        })
      } else if (resultado.dryRun || resultado.status === 'dry-run') {
        toast.success('Simulação gerada (dry-run).', { description: 'Nada foi enviado ao ERP.' })
      } else if (resultado.status === 'blocked') {
        // Nada foi ao ERP: é pendência de cadastro/elegibilidade, não falha de execução.
        toast.warning('A alocação não foi processada.', { description: resultado.motivo })
      } else if (resultado.ndeDispensada === true) {
        // Processo por conta e ordem de terceiros: a nota não é devida (ADR-0031). O texto tem de
        // dizer isso — prometer uma nota de débito que nunca sairá manda o analista procurá-la.
        toast.success('Alocação processada no Conexos.', {
          description:
            snDocCod !== undefined
              ? 'Baixa gerada na SN existente. Sem nota de débito (conta e ordem de terceiros).'
              : 'SN e baixa gerados. Sem nota de débito (conta e ordem de terceiros).',
        })
      } else {
        toast.success('Alocação processada no Conexos.', {
          description:
            snDocCod !== undefined
              ? 'Baixa e nota de débito gerados na SN existente.'
              : 'SN, baixa e nota de débito gerados.',
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

  const resultadoSelecionado =
    processoSelecionado !== null ? resultados[processoSelecionado.priCod] : undefined
  const processadoSelecionado =
    Boolean(resultadoSelecionado) && !isReprocessavel(resultadoSelecionado)
  const valorSelecionado = processoSelecionado ? valorProcesso(processoSelecionado) : 0
  const excedeSaldo = valorSelecionado > saldoRestante + SALDO_TOL
  const emAndamento =
    processoSelecionado !== null && processandoPri === processoSelecionado.priCod
  // Processar exige: um processo E uma opção de SN escolhida (existente OU "Criar novo SN"), valor
  // válido, conta presente, e não estar em andamento. `snEscolhida` nunca é vazio (default "novo").
  const processarDesabilitado =
    processoSelecionado === null ||
    emAndamento ||
    valorSelecionado <= 0 ||
    excedeSaldo ||
    contaAusente
  const valorMascaradoSelecionado =
    processoSelecionado === null
      ? ''
      : valores[processoSelecionado.priCod] !== undefined
        ? valores[processoSelecionado.priCod]
        : numToMask(valorDefault(processoSelecionado))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Alocar processos</DialogTitle>
          <DialogDescription>
            {transacao ? (
              <>
                Transação {transacao.contraparte ?? '—'} · {formatBRL(transacao.valor)} ·{' '}
                {/* Sem filial = conta corporativa (fin095, ADR-0032): a filial da operação nasce
                    do processo escolhido aqui, não do crédito. */}
                {transacao.filCod !== undefined
                  ? `filial ${transacao.filCod}`
                  : 'conta corporativa'}
                {!contaAusente ? (
                  <>
                    {' '}
                    · conta financeira <strong>{gerNum}</strong>
                  </>
                ) : null}
                . Escolha um processo à esquerda e uma SN à direita, depois clique em{' '}
                <strong>Processar</strong>.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {/* No desktop o corpo NÃO rola: quem rola são as regiões internas, para o rodapé com
            "Processar" nunca sair da tela. No mobile os dois painéis empilhados não cabem lado a
            lado, então o corpo volta a rolar inteiro e o rodapé fica `sticky`. */}
        <DialogBody className="flex flex-col overflow-y-auto md:overflow-hidden">
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
            <div className="grid grid-cols-1 gap-4 md:min-h-0 md:flex-1 md:grid-cols-2 md:overflow-hidden">
              {/* ── Painel ESQUERDO: lista de processos (seleção por rádio) ── */}
              <div
                className="rounded-lg border md:min-h-0 md:overflow-auto"
                role="radiogroup"
                aria-label="Processos candidatos"
              >
                <ul className="divide-y">
                  {processos.map((p) => {
                    const r = resultados[p.priCod]
                    const processado = Boolean(r) && !isReprocessavel(r)
                    const selecionado = selectedPriCod === p.priCod
                    return (
                      <li key={p.priCod}>
                        <label
                          className={`flex cursor-pointer items-start gap-3 p-3 text-sm ${
                            selecionado ? 'bg-accent' : 'hover:bg-muted/50'
                          }`}
                        >
                          <input
                            type="radio"
                            name="processo-alocar"
                            className="mt-1 accent-primary"
                            checked={selecionado}
                            onChange={() => setSelectedPriCod(p.priCod)}
                            aria-label={`Processo ${p.priCod} — ${p.dpeNomPessoa}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs">{p.priCod}</span>
                              <span className="text-xs text-muted-foreground">
                                filial {p.filCod}
                              </span>
                              {processado ? (
                                <Badge className="gap-1 border-transparent bg-success-subtle text-success-foreground">
                                  <CheckCircle2 className="size-3" aria-hidden />
                                  Processado
                                </Badge>
                              ) : null}
                            </div>
                            <div className="truncate font-medium">{p.dpeNomPessoa}</div>
                            {p.priEspRefcliente ? (
                              <div className="truncate text-xs text-muted-foreground">
                                {p.priEspRefcliente}
                              </div>
                            ) : null}
                          </div>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {/* ── Painel DIREITO: três regiões — cabeçalho fixo, lista de SN rolável, rodapé
                     sempre visível. Antes era UMA caixa rolável com tudo dentro: com muitas SN o
                     botão "Processar" ia para baixo da dobra e o analista tinha de rolar a lista
                     inteira para alcançá-lo. ── */}
              <div className="flex flex-col rounded-lg border md:min-h-0 md:overflow-hidden">
                {processoSelecionado === null ? (
                  <div className="p-4">
                    <EmptyState
                      icon={<FileText className="size-6" aria-hidden />}
                      title="Selecione um processo"
                      description="Escolha um processo à esquerda para ver as Solicitações de Numerário existentes e processar a alocação."
                    />
                  </div>
                ) : (
                  <>
                    <div className="shrink-0 border-b p-4">
                      <h3 className="text-sm font-medium">
                        Solicitação de Numerário — processo {processoSelecionado.priCod}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Escolha uma SN existente ou crie uma nova.
                      </p>
                    </div>

                    <div
                      role="radiogroup"
                      aria-label="Solicitação de Numerário"
                      aria-busy={carregandoSns || undefined}
                      className="space-y-2 p-4 md:min-h-0 md:flex-1 md:overflow-y-auto"
                    >
                      {/* "Criar novo SN" é sempre a 1ª opção e o default. */}
                      <label
                        className={`flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm ${
                          snEscolhida === CRIAR_NOVO_SN ? 'border-primary bg-accent' : ''
                        }`}
                      >
                        <input
                          type="radio"
                          name="sn-escolha"
                          className="accent-primary"
                          value={CRIAR_NOVO_SN}
                          checked={snEscolhida === CRIAR_NOVO_SN}
                          onChange={() => escolherSn(CRIAR_NOVO_SN)}
                          aria-label="Criar novo SN"
                        />
                        <span className="font-medium">Criar novo SN</span>
                      </label>

                      {carregandoSns ? (
                        <div aria-busy="true" aria-label="Carregando SN" className="space-y-2">
                          <Skeleton className="h-14 w-full" />
                          <Skeleton className="h-14 w-full" />
                        </div>
                      ) : erroSns ? (
                        <EmptyState
                          icon={<AlertTriangle className="size-6" aria-hidden />}
                          title="Não foi possível carregar as SN"
                          description={erroSns}
                        />
                      ) : (sns[processoSelecionado.priCod]?.length ?? 0) === 0 ? (
                        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                          Este processo ainda não tem Solicitação de Numerário. Use &ldquo;Criar novo
                          SN&rdquo;.
                        </p>
                      ) : (
                        sns[processoSelecionado.priCod]?.map((sn) => (
                          <label
                            key={sn.docCod}
                            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                              snEscolhida === String(sn.docCod) ? 'border-primary bg-accent' : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name="sn-escolha"
                              className="mt-1 accent-primary"
                              value={String(sn.docCod)}
                              checked={snEscolhida === String(sn.docCod)}
                              onChange={() => escolherSn(String(sn.docCod), sn)}
                              aria-label={`SN ${sn.numero} — ${sn.descricao}`}
                            />
                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-xs">{sn.numero}</span>
                                <span className="text-xs text-muted-foreground">
                                  {formatDate(sn.data)}
                                </span>
                                <SnStatusBadge statusLabel={sn.statusLabel} />
                              </div>
                              <div className="truncate text-xs">{sn.descricao}</div>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs text-muted-foreground">
                                <dt>Solicitado</dt>
                                <dd className="tabular-nums">{formatBRL(sn.solicitado)}</dd>
                                <dt>Valor</dt>
                                <dd className="tabular-nums">{formatBRL(sn.valor)}</dd>
                              </dl>
                            </div>
                          </label>
                        ))
                      )}
                    </div>

                    {/* Rodapé: valor + Processar (ou o resultado, quando já processado). Fica FORA
                        da região rolável — é a ação terminal do modal e não pode depender de o
                        analista rolar até o fim de uma lista de 100 SN para aparecer. */}
                    <div className="sticky bottom-0 z-10 shrink-0 border-t bg-card p-4">
                    {processadoSelecionado && resultadoSelecionado ? (
                      <ResultadoAlocacao resultado={resultadoSelecionado} />
                    ) : (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <label
                            htmlFor={`valor-alocar-${processoSelecionado.priCod}`}
                            className="text-sm font-medium"
                          >
                            Valor a alocar
                          </label>
                          <MoneyInput
                            id={`valor-alocar-${processoSelecionado.priCod}`}
                            value={valorMascaradoSelecionado}
                            onChange={(masked) =>
                              setValores((prev) => ({
                                ...prev,
                                [processoSelecionado.priCod]: masked,
                              }))
                            }
                            max={saldoRestante}
                            aria-label={`Valor a alocar no processo ${processoSelecionado.priCod}`}
                            aria-invalid={excedeSaldo || undefined}
                            aria-describedby={
                              excedeSaldo ? `valor-alocar-erro-${processoSelecionado.priCod}` : undefined
                            }
                            className="w-40"
                          />
                          {/* Mensagem visível, não só o `title` do botão travado: sem ela o
                              analista vê "Processar" desabilitado e não sabe por quê. E o valor
                              NÃO é cortado sozinho — corrigir é decisão dele. */}
                          {excedeSaldo ? (
                            <p
                              id={`valor-alocar-erro-${processoSelecionado.priCod}`}
                              role="alert"
                              className="text-xs text-danger"
                            >
                              Acima do saldo a alocar ({formatBRL(saldoRestante)}). Ajuste o valor.
                            </p>
                          ) : null}
                        </div>
                        <Button
                          onClick={() => void processar(processoSelecionado)}
                          disabled={processarDesabilitado}
                          aria-busy={emAndamento || undefined}
                          title={
                            contaAusente
                              ? 'Pagamento sem conta financeira (gerNum)'
                              : excedeSaldo
                                ? 'Valor acima do saldo disponível'
                                : valorSelecionado <= 0
                                  ? 'Informe um valor maior que zero'
                                  : undefined
                          }
                        >
                          {emAndamento ? <Spinner className="size-4" /> : null}
                          Processar
                        </Button>
                        {isReprocessavel(resultadoSelecionado) && resultadoSelecionado ? (
                          <ResultadoAlocacao resultado={resultadoSelecionado} />
                        ) : null}
                      </div>
                    )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

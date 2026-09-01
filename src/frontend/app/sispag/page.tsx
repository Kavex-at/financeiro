'use client'

import * as React from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  DatabaseZap,
  Layers,
  Lock,
  RefreshCcw,
  Trash2,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { isSispagEnabled } from '@/lib/features'
import { isSessionExpiredError } from '@/lib/http'
import { formatBRL } from '@/lib/utils'
import {
  type ArquivoRetorno,
  cancelarLote,
  conciliarRetorno,
  type ConciliarResult,
  ErpPerguntaError,
  criarLote,
  fetchLotes,
  fetchRetornos,
  fetchSispagPainel,
  fetchIngestaoRuns,
  finalizarLote,
  formarLotes,
  incluirTitulo,
  IngestaoPagamentosEmAndamentoError,
  type PagamentoIngestaoRun,
  reabrirLote,
  ConciliacaoEmDuvidaError,
  LoteAnteriorCanceladoError,
  RemessaEmAndamentoError,
  RemessaEmDuvidaError,
  removerItem,
  runIngestaoPagamentos,
  type LotePagamento,
  type SispagPainel,
  type TituloAPagar,
} from '@/lib/sispag'
import { FiltroBarra, Paginacao, useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'
import { AdicionarTituloDialog } from './components/AdicionarTituloDialog'
import { IngestaoDialog } from './components/IngestaoDialog'
import { LoteCard } from './components/LoteCard'

const keyOf = (t: TituloAPagar) => `${t.filCod}:${t.docCod}:${t.titCod}`

const fmtData = (ms?: number) =>
  ms === undefined ? '—' : new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'UTC' })

function VencimentoBadge({ dias }: { dias?: number }) {
  if (dias === undefined) return <span className="text-muted-foreground">—</span>
  if (dias < 0)
    return (
      <Badge variant="outline" className="border-danger/40 text-danger">
        vencido {Math.abs(dias)}d
      </Badge>
    )
  if (dias <= 7)
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        vence em {dias}d
      </Badge>
    )
  return <Badge variant="outline">em {dias}d</Badge>
}


/**
 * Guard de acesso (bloqueio via URL): quando o SISPAG está desligado (produção,
 * por padrão), a rota `/sispag` mostra a tela de bloqueio em vez do painel. A
 * API também nega (`sispagGate` → 403), então esconder aqui é UX, não a barreira.
 */
export default function SispagPage() {
  if (!isSispagEnabled()) {
    return (
      <div className="space-y-6">
        <PageHeader title="SISPAG — Pagamentos" subtitle="Frente II — Automação de Pagamentos." />
        <EmptyState
          icon={<Lock className="size-8" aria-hidden />}
          title="SISPAG indisponível"
          description="Esta frente ainda não está liberada em produção. Fale com o time se precisar de acesso."
        />
      </div>
    )
  }
  return <SispagPanel />
}

function SispagPanel() {
  const [painel, setPainel] = React.useState<SispagPainel | null>(null)
  const [lotes, setLotes] = React.useState<LotePagamento[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  // Default 'a-vencer' a pedido do financeiro: vencido não entra em lote (o ERP recusa
  // finalizar quando a data de débito passa do menor vencimento), então ele só polui a
  // tabela de trabalho. Continua a um clique de distância — e o contador no botão existe
  // para que "escondido" nunca vire "esquecido".
  const [filtro, setFiltro] = React.useState<'a-vencer' | 'vencidos' | 'todos'>('a-vencer')
  const [selecionados, setSelecionados] = React.useState<Set<string>>(new Set())
  const [busy, setBusy] = React.useState(false)
  const [ingerindo, setIngerindo] = React.useState(false)
  const [formando, setFormando] = React.useState(false)
  const [ingestaoOpen, setIngestaoOpen] = React.useState(false)
  const [retornos, setRetornos] = React.useState<ArquivoRetorno[] | null>(null)
  const [retornosLoading, setRetornosLoading] = React.useState(false)
  const [runs, setRuns] = React.useState<PagamentoIngestaoRun[] | null>(null)
  const [runsLoading, setRunsLoading] = React.useState(false)

  const carregar = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [p, ls] = await Promise.all([fetchSispagPainel(), fetchLotes().catch(() => [])])
      setPainel(p)
      setLotes(ls)
    } catch (e) {
      // Sessão expirada tem dono: o SessionExpiredModal. Se renderizarmos o nosso
      // EmptyState aqui, ele cobre o modal e o usuário fica sem caminho para o login.
      if (isSessionExpiredError(e)) return
      setError(e instanceof Error ? e.message : 'Falha ao carregar o painel.')
    } finally {
      setLoading(false)
    }
  }, [])

  const recarregarLotes = React.useCallback(async () => {
    try {
      setLotes(await fetchLotes())
    } catch {
      /* mantém a lista anterior */
    }
  }, [])

  const carregarRuns = React.useCallback(async () => {
    setRunsLoading(true)
    try {
      setRuns(await fetchIngestaoRuns())
    } catch {
      setRuns([])
    } finally {
      setRunsLoading(false)
    }
  }, [])

  const abrirIngestao = React.useCallback(() => {
    setIngestaoOpen(true)
    void carregarRuns()
  }, [carregarRuns])

  // Rodada manual disparada de DENTRO do modal — mantém o modal aberto e atualiza a trilha.
  const ingerir = async () => {
    setIngerindo(true)
    try {
      const r = await runIngestaoPagamentos()
      toast.success('Ingestão concluída', {
        description: `${r.totalTitulos} título(s) na carteira · ${r.totalInativados} inativado(s).`,
      })
      await Promise.all([carregar(), carregarRuns()])
    } catch (e) {
      if (e instanceof IngestaoPagamentosEmAndamentoError) {
        toast.warning('Ingestão em andamento', { description: e.message })
        void carregarRuns()
      } else {
        toast.error('Falha na ingestão', {
          description: e instanceof Error ? e.message : undefined,
        })
      }
    } finally {
      setIngerindo(false)
    }
  }

  const formar = async () => {
    setFormando(true)
    try {
      const r = await formarLotes()
      await Promise.all([carregar(), recarregarLotes()])
      toast.success('Formação concluída', {
        description: `${r.lotesFormados} lote(s) · ${r.titulosLotados} título(s)${
          r.lotesDesfeitos ? ` · ${r.lotesDesfeitos} desfeito(s)` : ''
        }.`,
      })
    } catch (e) {
      toast.error('Falha ao formar lotes', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setFormando(false)
    }
  }

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const titulos = painel?.titulos ?? []
  const ehVencido = (t: TituloAPagar): boolean => (t.diasAteVencimento ?? 0) < 0
  const totalVencidos = React.useMemo(() => titulos.filter(ehVencido).length, [titulos])
  // O backend corta o payload num teto. Se cortou, dizer — a versão anterior mostrava
  // "Todos (400)" ao lado de um KPI de 1.225 e ninguém tinha como saber qual valia.
  const truncado = (painel?.titulosTotal ?? titulos.length) > titulos.length
  const paradas = painel?.execucoesParadas
  const execucoesParadas =
    paradas && paradas.remessa + paradas.conciliacao > 0 ? paradas : undefined
  const titulosFiltrados = React.useMemo(() => {
    const base = titulos
    if (filtro === 'a-vencer') return base.filter((t) => (t.diasAteVencimento ?? -1) >= 0)
    if (filtro === 'vencidos') return base.filter(ehVencido)
    return base
  }, [titulos, filtro])

  // Filial + busca + paginação — mesmo kit do painel de Permutas (consistência de UX).
  const abaTitulos = useTabelaFiltro(
    titulosFiltrados,
    (t) => t.filCod,
    (t) => `${t.credor ?? ''} ${t.docCod}/${t.titCod} ${t.banco ?? ''}`,
  )
  // Lotes: candidatos (RASCUNHO) vs. em andamento (do FINALIZADO até o BAIXADO).
  const lotesRascunho = lotes.filter((l) => l.status === 'RASCUNHO')
  const EM_ANDAMENTO = ['FINALIZADO', 'REMESSA_GERADA', 'RETORNADO', 'BAIXADO'] as const
  const lotesFinalizados = lotes.filter((l) =>
    (EM_ANDAMENTO as readonly string[]).includes(l.status),
  )
  const [statusFin, setStatusFin] = React.useState<
    'todos' | 'aguardando' | 'remessa' | 'retornado'
  >('todos')
  const [adicionarLote, setAdicionarLote] = React.useState<LotePagamento | null>(null)
  const buscaLote = (l: LotePagamento) =>
    `${l.filCod} ${l.criadoPor} ${l.itens.map((i) => i.credor ?? '').join(' ')}`
  const abaCandidatos = useTabelaFiltro(lotesRascunho, (l) => l.filCod, buscaLote, 8)
  const finFiltrados = lotesFinalizados.filter((l) =>
    statusFin === 'aguardando'
      ? l.status === 'FINALIZADO'
      : statusFin === 'remessa'
        ? l.status === 'REMESSA_GERADA'
        : statusFin === 'retornado'
          ? l.status === 'RETORNADO' || l.status === 'BAIXADO'
          : true,
  )
  const abaFinalizados = useTabelaFiltro(finFiltrados, (l) => l.filCod, buscaLote, 8)
  // Retornos (.RET) do fin052 — mesmo kit (filial + busca + paginação) das demais abas.
  const abaRetornos = useTabelaFiltro(
    retornos ?? [],
    (r) => r.filCod,
    (r) => `${r.banco ?? ''} ${r.configNome ?? ''} ${r.arquivo ?? ''}`,
  )

  const selTitulos = titulos.filter((t) => selecionados.has(keyOf(t)))
  const totalSelecionado = selTitulos.reduce((acc, t) => acc + t.valor, 0)

  const toggle = (t: TituloAPagar) => {
    if (t.emLote) return
    setSelecionados((prev) => {
      const next = new Set(prev)
      const k = keyOf(t)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  const criarLoteComSelecionados = async () => {
    if (selTitulos.length === 0) return
    const filiais = new Set(selTitulos.map((t) => t.filCod))
    if (filiais.size > 1) {
      toast.error('Selecione títulos de uma única filial', {
        description: 'Um lote é de uma filial só. Filtre por filial e monte um lote por vez.',
      })
      return
    }
    setBusy(true)
    try {
      const filCod = selTitulos[0].filCod
      const lote = await criarLote({ filCod })
      let ok = 0
      const falhas: string[] = []
      for (const t of selTitulos) {
        try {
          await incluirTitulo(lote.id, { filCod: t.filCod, docCod: t.docCod, titCod: t.titCod })
          ok += 1
        } catch (e) {
          falhas.push(`${t.docCod}/${t.titCod}: ${e instanceof Error ? e.message : 'erro'}`)
        }
      }
      setSelecionados(new Set())
      await recarregarLotes()
      if (falhas.length === 0) {
        toast.success(`Lote criado com ${ok} título(s)`, {
          description: 'Lote criado localmente — nada foi escrito no ERP ainda.',
        })
      } else {
        toast.warning(`Lote criado com ${ok} título(s); ${falhas.length} não entraram`, {
          description: falhas.slice(0, 3).join(' · '),
        })
      }
    } catch (e) {
      toast.error('Não foi possível criar o lote', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  const acaoLote = async (
    fn: (opts?: { confirmarNovoLote?: boolean }) => Promise<unknown>,
    // Função quando a confirmação depende do QUE ACONTECEU. "Remessa gerada" e
    // "simulação em dry-run" não podem ter a mesma mensagem num botão que move dinheiro.
    okMsg: string | ((resultado: unknown) => { titulo: string; descricao?: string }),
  ) => {
    setBusy(true)
    try {
      const resultado = await fn()
      await recarregarLotes()
      if (typeof okMsg === 'string') {
        toast.success(okMsg)
      } else {
        const { titulo, descricao } = okMsg(resultado)
        toast.success(titulo, descricao ? { description: descricao } : undefined)
      }
    } catch (e) {
      // Dois erros pedem ação humana diferente de "tente de novo" — e insistir em um
      // deles pode gerar pagamento em duplicidade. Não podem virar toast genérico.
      if (isSessionExpiredError(e)) return
      if (e instanceof RemessaEmAndamentoError) {
        // Não é falha: outra execução está rodando agora. Insistir é o que criaria o
        // segundo lote — por isso a mensagem pede espera, não retry.
        toast.warning('Geração já em andamento', {
          description: e.message,
          duration: 12000,
        })
      } else if (e instanceof LoteAnteriorCanceladoError) {
        // NÃO é erro: é uma pergunta. Limpar um órfão travado e abortar um pagamento
        // deixam o mesmo estado no Conexos, e só quem cancelou sabe qual dos dois foi.
        // Por isso a ação fica atrás de um segundo clique, e não de um retry automático.
        toast.warning('O lote anterior foi cancelado no Conexos', {
          description: e.message,
          duration: 60000,
          action: {
            label: 'Gerar um lote novo',
            onClick: () => {
              void acaoLote((o) => fn({ ...o, confirmarNovoLote: true }), okMsg)
            },
          },
        })
      } else if (e instanceof RemessaEmDuvidaError) {
        toast.error('Remessa em dúvida — NÃO repita', {
          description: e.message,
          duration: 30000,
        })
      } else if (e instanceof ErpPerguntaError) {
        toast.warning('O Conexos pediu uma confirmação', {
          description: e.message,
          duration: 20000,
        })
      } else {
        toast.error('Ação não concluída', {
          description: e instanceof Error ? e.message : undefined,
        })
      }
    } finally {
      setBusy(false)
    }
  }

  /**
   * Concilia um arquivo `.RET`. Com `processar`, manda o ERP processar antes — é o passo
   * que GERA AS BAIXAS no fin010, então é uma ação separada e explícita.
   */
  const conciliar = async (r: ArquivoRetorno, processar: boolean) => {
    setBusy(true)
    try {
      const res: ConciliarResult = await conciliarRetorno({
        filCod: r.filCod,
        bncCod: r.bncCod,
        gtbCodSeq: r.gtbCodSeq,
        garCodSeq: r.garCodSeq,
        processar,
      })
      await recarregarLotes()
      await carregarRetornos()
      const partes = [`${res.pagos} pago(s)`]
      if (res.rejeitados > 0) partes.push(`${res.rejeitados} rejeitado(s)`)
      if (res.naoReconhecidos > 0) partes.push(`${res.naoReconhecidos} de outro lote`)
      // Varredura parcial não é sucesso: pode haver rejeição que não foi lida, e o
      // lote fica em RETORNADO de propósito. Um toast verde aqui seria mentira.
      if (res.varreduraIncompleta) {
        const codigos = (res.eventosNaoLidos ?? []).map((e) => e.evento).join(', ')
        toast.warning('Conciliação PARCIAL — nem todos os códigos foram lidos', {
          description:
            `${res.totalLinhas} linha(s) lidas, mas ${codigos || 'algum código'} falhou. ` +
            'Pode haver pagamento ou rejeição não conciliado. O lote NÃO foi fechado — ' +
            'repita a conciliação.',
          duration: 12000,
        })
        return
      }
      toast.success(res.dryRun ? 'Conciliação simulada (dry-run)' : 'Retorno conciliado', {
        description: `${res.totalLinhas} linha(s): ${partes.join(' · ')}`,
      })
    } catch (e) {
      if (isSessionExpiredError(e)) return
      if (e instanceof ConciliacaoEmDuvidaError) {
        // Paridade com a remessa: "em dúvida" é classe própria, não falha de rede. Sem
        // isso o operador retenta por reflexo — e aprende a ignorar o alerta.
        toast.error('Conciliação em dúvida — NÃO repita', {
          description: e.message,
          duration: 30000,
        })
        return
      }
      toast.error('Não foi possível conciliar', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  const carregarRetornos = async () => {
    setRetornosLoading(true)
    try {
      setRetornos(await fetchRetornos())
    } catch (e) {
      if (isSessionExpiredError(e)) return
      toast.error('Não foi possível ler os retornos', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setRetornosLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="SISPAG — Pagamentos"
        subtitle="Escopo II · Frente II. Painel, montagem do lote, geração da remessa e conciliação do retorno. O arquivo não é transmitido ao banco."
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={abrirIngestao}
              title="Ver as últimas ingestões (cron/manual) e rodar sob demanda"
            >
              <DatabaseZap aria-hidden /> Ingestão de dados
            </Button>
            <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={loading}>
              <RefreshCcw className="size-4" /> Recarregar
            </Button>
          </div>
        }
      />

      <IngestaoDialog
        open={ingestaoOpen}
        setOpen={setIngestaoOpen}
        ingestRunning={ingerindo}
        runs={runs}
        runsLoading={runsLoading}
        rodarIngestao={ingerir}
      />

      <AdicionarTituloDialog
        lote={adicionarLote}
        titulos={titulos}
        onClose={() => setAdicionarLote(null)}
        onAdded={async () => {
          await Promise.all([carregar(), recarregarLotes()])
        }}
      />

      {/*
        Execuções presas no meio de uma escrita. O fail-closed impede o pagamento em
        duplicidade, mas é MUDO: só se manifesta se alguém tentar de novo. Sem este aviso o
        lote órfão no Conexos ficaria semanas sem ninguém saber — o WARN no log do servidor
        é lido por quem abre o log, ou seja, ninguém por hábito. Aqui aparece para quem gera
        remessa, na tela onde a decisão de repetir vai ser tomada.
      */}
      {execucoesParadas ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <span className="font-medium text-destructive">
              {execucoesParadas.remessa + execucoesParadas.conciliacao} execução(ões) sem
              confirmação há mais de {execucoesParadas.desdeMinutos} min.
            </span>{' '}
            Uma escrita no Conexos começou e não terminou — pode haver lote de pagamento
            órfão no ERP.
            {execucoesParadas.lotesNativos.length > 0 ? (
              <>
                {' '}
                Procure no fin015 o(s) lote(s){' '}
                <strong>{execucoesParadas.lotesNativos.join(', ')}</strong> e cancele antes de
                tentar de novo.
              </>
            ) : (
              <>
                {' '}
                A interrupção foi antes de registrarmos o número do lote — procure no fin015
                por rascunhos em aberto e sem títulos.
              </>
            )}{' '}
            <span className="text-muted-foreground">
              Repetir sem conferir poderia gerar um segundo pagamento.
            </span>
          </div>
        </div>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
        <Lock className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <span className="font-medium">Gerar remessa e conciliar ESCREVEM no Conexos.</span> A
          carteira vem do <strong>nosso banco</strong> (última ingestão); lotes nativos e borderôs
          são lidos <strong>ao vivo</strong>. Montar o lote é estado local, mas{' '}
          <strong>Gerar remessa</strong> cria o lote no ERP e <strong>Processar</strong> grava as
          baixas no fin010. O arquivo <strong>não é entregue ao banco</strong>: o Conexos não
          transmite remessa de pagamento — o transporte é externo e manual.
          {painel?.ingestao.ultimaRunEm ? (
            <span className="text-muted-foreground">
              {' '}
              · carteira de {new Date(painel.ingestao.ultimaRunEm).toLocaleString('pt-BR')}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Spinner /> Carregando painel…
        </div>
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="Não foi possível carregar"
          description={error}
        />
      ) : painel ? (
        <>
          <KPIGrid columns={4}>
            <SimpleKPI
              label="A vencer (7 dias)"
              value={painel.kpis.titulosAVencer7d.toLocaleString('pt-BR')}
              color="warning"
              footer="títulos aprovados"
            />
            <SimpleKPI
              label="A vencer (30 dias)"
              value={formatBRL(painel.kpis.valorAVencer30d)}
              color="primary"
              footer={`${painel.kpis.titulosAVencer30d.toLocaleString('pt-BR')} títulos`}
            />
            <SimpleKPI
              label="Vencidos (não pagos)"
              value={painel.kpis.titulosVencidos.toLocaleString('pt-BR')}
              color="danger"
              footer="na janela"
            />
            <SimpleKPI
              label="Lotes candidatos"
              value={lotes.filter((l) => l.status !== 'CANCELADO').length.toLocaleString('pt-BR')}
              color="info"
              footer={`${lotes.filter((l) => l.status === 'FINALIZADO').length} finalizados`}
            />
          </KPIGrid>

          <Tabs defaultValue="titulos">
            <TabsList>
              <TabsTrigger value="titulos">Títulos a pagar</TabsTrigger>
              <TabsTrigger value="lotes-candidatos">
                Lotes candidatos ({lotesRascunho.length})
              </TabsTrigger>
              <TabsTrigger value="lotes-finalizados">
                Finalizados ({lotesFinalizados.length})
              </TabsTrigger>
              <TabsTrigger value="lotes">Lançamento Lote (REM) - Conexos</TabsTrigger>
              <TabsTrigger value="retornos">Retorno Lote (RET) - Conexos</TabsTrigger>
            </TabsList>

            {/* ---- Títulos a pagar ---- */}
            <TabsContent value="titulos" className="space-y-3">
              <FiltroBarra aba={abaTitulos} buscaPlaceholder="Buscar por credor, documento ou banco…" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex gap-1">
                    {(['a-vencer', 'vencidos', 'todos'] as const).map((f) => (
                      <Button
                        key={f}
                        size="sm"
                        variant={filtro === f ? 'default' : 'outline'}
                        onClick={() => setFiltro(f)}
                      >
                        {f === 'todos'
                          ? `Todos (${titulos.length})`
                          : f === 'a-vencer'
                            ? `A vencer (${titulos.length - totalVencidos})`
                            : `Vencidos (${totalVencidos})`}
                      </Button>
                    ))}
                  </div>
                  {truncado ? (
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-500">
                      Lista cortada em {titulos.length} de {painel?.titulosTotal} títulos — os
                      demais não aparecem aqui nem podem entrar em lote. Filtre por filial ou
                      busque pelo credor.
                    </span>
                  ) : null}
                  {filtro === 'a-vencer' && totalVencidos > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {totalVencidos} vencido{totalVencidos > 1 ? 's' : ''} fora da lista — não
                      entra{totalVencidos > 1 ? 'm' : ''} em lote enquanto o vencimento não for
                      renegociado no ERP.
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {selecionados.size > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      {selecionados.size} sel. · {formatBRL(totalSelecionado)}
                    </span>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={formar} disabled={formando}>
                    <Layers className="size-4" />{' '}
                    {formando ? 'Formando…' : 'Formar lotes automáticos'}
                  </Button>
                  <Button size="sm" disabled={selecionados.size === 0 || busy} onClick={criarLoteComSelecionados}>
                    <Layers className="size-4" /> Criar lote ({selecionados.size})
                  </Button>
                </div>
              </div>

              {abaTitulos.total === 0 ? (
                <EmptyState
                  icon={titulos.length === 0 ? <DatabaseZap className="size-6" /> : undefined}
                  title={titulos.length === 0 ? 'Carteira vazia' : 'Nenhum título encontrado'}
                  description={
                    titulos.length === 0
                      ? 'Clique em "Ingestão de dados" para carregar os títulos a pagar do Conexos.'
                      : 'Ajuste a faixa, a filial ou a busca acima.'
                  }
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Credor</TableHead>
                        <TableHead>Documento</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Boleto</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead>Filial</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {abaTitulos.slice.map((t) => (
                        <TableRow key={keyOf(t)}>
                          <TableCell>
                            <Checkbox
                              checked={selecionados.has(keyOf(t))}
                              onCheckedChange={() => toggle(t)}
                              disabled={t.emLote}
                              aria-label="selecionar título"
                              title={t.emLote ? 'Já está num lote — não pode ser atachado a outro.' : undefined}
                            />
                          </TableCell>
                          <TableCell className="max-w-[18rem] truncate font-medium">
                            <span className={t.emLote ? 'text-muted-foreground' : undefined}>
                              {t.credor ?? '—'}
                            </span>
                            {t.emLote ? (
                              <Badge
                                variant="outline"
                                className="ml-2 border-muted text-muted-foreground"
                                title="Já está num lote RASCUNHO."
                              >
                                em lote
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {t.docCod}/{t.titCod}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatBRL(t.valor)}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground">
                                {fmtData(t.vencimento)}
                              </span>
                              <VencimentoBadge dias={t.diasAteVencimento} />
                            </div>
                          </TableCell>
                          <TableCell>
                            {/* Boleto DDA: o Conexos casou um boleto (fin124) com este título.
                                É o que permite a remessa sair com código de barras — sem ele,
                                escolher BOLETO no lote é barrado na geração. */}
                            {t.temBoleto ? (
                              <Badge
                                variant="outline"
                                className="border-success/40 text-success"
                                title="Boleto DDA associado — código adicionado pelo ERP ao gerar a remessa"
                              >
                                <Barcode className="mr-1 size-3" aria-hidden />
                                boleto
                              </Badge>
                            ) : (
                              <span
                                className="text-xs text-muted-foreground"
                                title="Nenhum boleto DDA associado. Pagamento por TED/PIX/crédito, ou importe o arquivo DDA no fin124."
                              >
                                sem boleto
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col items-start gap-1">
                              {t.liberado ? (
                                <Badge variant="outline" className="border-success/40 text-success">
                                  aprovado
                                </Badge>
                              ) : (
                                <Badge variant="outline">bloqueado</Badge>
                              )}
                              {t.prontoParaRemessa === false ? (
                                <Badge
                                  variant="outline"
                                  className="border-warning/40 text-warning"
                                  title="Pode faltar cadastro de pagamento (banco/conta/modalidade). Validação real no envio."
                                >
                                  falta cadastro?
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{t.filCod}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <Paginacao aba={abaTitulos} />
              <p className="text-xs text-muted-foreground">
                {painel.ingestao.ultimaRunEm
                  ? `Carteira ingerida em ${new Date(painel.ingestao.ultimaRunEm).toLocaleString('pt-BR')}.`
                  : 'Sem ingestão ainda — clique em "Ingestão de dados".'}{' '}
                Selecione títulos de uma filial e clique em <strong>Criar lote</strong>.
              </p>
            </TabsContent>

            {/* ---- Lotes candidatos (RASCUNHO — falta finalizar) ---- */}
            <TabsContent value="lotes-candidatos" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Lotes a finalizar (rascunho) — manual ou automático. Revise antes de aprovar.
              </p>
              <FiltroBarra
                aba={abaCandidatos}
                buscaPlaceholder="Buscar por filial, quem criou ou credor…"
              />
              {abaCandidatos.total === 0 ? (
                <EmptyState
                  icon={<Layers className="size-6" />}
                  title="Nenhum lote candidato"
                  description='Clique em "Formar lotes automáticos" ou selecione títulos e crie um lote manual.'
                />
              ) : (
                <div className="space-y-3">
                  {abaCandidatos.slice.map((l) => (
                    <LoteCard
                      key={l.id}
                      lote={l}
                      busy={busy}
                      acao={acaoLote}
                      onAdicionar={setAdicionarLote}
                    />
                  ))}
                </div>
              )}
              <Paginacao aba={abaCandidatos} />
            </TabsContent>

            {/* ---- Lotes finalizados (aguardando retorno / de volta do Nexxera) ---- */}
            <TabsContent value="lotes-finalizados" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Lotes finalizados — prontos para virar remessa, com remessa gerada aguardando o
                retorno do banco, ou já conciliados.
              </p>
              <FiltroBarra
                aba={abaFinalizados}
                buscaPlaceholder="Buscar por filial, quem finalizou ou credor…"
              />
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                <div className="flex gap-1">
                  {(['todos', 'aguardando', 'remessa', 'retornado'] as const).map((s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={statusFin === s ? 'default' : 'outline'}
                      onClick={() => setStatusFin(s)}
                    >
                      {s === 'todos'
                        ? 'Todos'
                        : s === 'aguardando'
                          ? 'A gerar remessa'
                          : s === 'remessa'
                            ? 'Remessa gerada'
                            : 'Conciliados'}
                    </Button>
                  ))}
                </div>
              </div>
              {abaFinalizados.total === 0 ? (
                <EmptyState
                  icon={<Layers className="size-6" />}
                  title="Nenhum lote finalizado"
                  description="Finalize um lote candidato para ele aparecer aqui, aguardando o retorno do Nexxera."
                />
              ) : (
                <div className="space-y-3">
                  {abaFinalizados.slice.map((l) => (
                    <LoteCard key={l.id} lote={l} busy={busy} acao={acaoLote} />
                  ))}
                </div>
              )}
              <Paginacao aba={abaFinalizados} />
            </TabsContent>


            {/* ---- Lotes SISPAG nativos ---- */}
            <TabsContent value="lotes" className="space-y-3">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Banco / conta</TableHead>
                      <TableHead>Layout</TableHead>
                      <TableHead className="text-right">Títulos</TableHead>
                      <TableHead className="text-right">Soma</TableHead>
                      <TableHead>Envio</TableHead>
                      <TableHead>Retorno</TableHead>
                      <TableHead>Finalizado por</TableHead>
                      <TableHead>Filial</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {painel.lotes.map((l) => (
                      <TableRow key={`${l.filCod}:${l.flpCod}`}>
                        <TableCell className="font-medium">
                          {l.banco ?? '—'}
                          {l.conta ? <span className="text-muted-foreground"> · {l.conta}</span> : null}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {l.layoutConta ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{l.titulosCount}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatBRL(l.soma)}</TableCell>
                        <TableCell>
                          {l.envioConfirmado ? (
                            <Badge variant="outline" className="border-success/40 text-success">
                              enviado
                            </Badge>
                          ) : (
                            <Badge variant="outline">aberto</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {l.retornoProcessado ? (
                            <Badge variant="outline" className="border-info/40 text-info">
                              conciliado
                            </Badge>
                          ) : l.itensRetorno > 0 ? (
                            <Badge variant="outline" className="border-warning/40 text-warning">
                              {l.itensRetorno} itens
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{l.finalizadoPor ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{l.filCod}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {painel.lotes.length} lotes nativos (fin015) — a visão do ERP. Para gerar uma
                  remessa, use <strong>Gerar remessa (.REM)</strong> no lote finalizado, na aba{' '}
                  <strong>Lotes finalizados</strong>.
                </p>

              </div>
            </TabsContent>

            {/* ---- Retorno Lote (.RET) — fin052, read-only ---- */}
            <TabsContent value="retornos" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Arquivos de retorno (.RET) do Conexos (fin052), lidos <strong>ao vivo</strong>.
                  <strong> Processar</strong> manda o ERP parsear o arquivo e dar as baixas no
                  fin010; <strong> Conciliar</strong> só lê o resultado e traz para os nossos lotes.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={carregarRetornos} disabled={retornosLoading}>
                    <RefreshCcw className="size-4" /> {retornos === null ? 'Carregar retornos' : 'Recarregar'}
                  </Button>

                </div>
              </div>
              {retornosLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : retornos === null ? (
                <EmptyState
                  icon={<Layers className="size-6" />}
                  title="Retornos não carregados"
                  description='Clique em "Carregar retornos" para ler os arquivos .RET do Conexos ao vivo.'
                />
              ) : retornos.length === 0 ? (
                <EmptyState
                  icon={<Layers className="size-6" />}
                  title="Nenhum arquivo de retorno"
                  description="Não há .RET carregado no fin052 para as filiais/bancos configurados."
                />
              ) : (
                <>
                  <FiltroBarra
                    aba={abaRetornos}
                    buscaPlaceholder="Buscar por banco, config ou arquivo…"
                  />
                  {abaRetornos.total === 0 ? (
                    <EmptyState
                      icon={<Layers className="size-6" />}
                      title="Nenhum retorno para o filtro"
                      description="Ajuste a filial ou a busca para ver os arquivos .RET."
                    />
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Banco / config</TableHead>
                            <TableHead>Arquivo</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Rejeitados</TableHead>
                            <TableHead className="text-right">Erros</TableHead>
                            <TableHead>Filial</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {abaRetornos.slice.map((r) => (
                            <TableRow
                              key={`${r.filCod}:${r.bncCod}:${r.gtbCodSeq}:${r.garCodSeq}`}
                            >
                              <TableCell className="font-medium">
                                {r.banco ?? `bnc ${r.bncCod}`}
                                {r.configNome ? (
                                  <span className="text-muted-foreground"> · {r.configNome}</span>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {r.arquivo ?? `gar ${r.garCodSeq}`}
                              </TableCell>
                              <TableCell>
                                {r.statusProcessamento ? (
                                  <Badge variant="outline" className="border-success/40 text-success">
                                    processado
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">carregado</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {r.titulosRejeitados ? (
                                  <span
                                    className="text-warning"
                                    aria-label={`${r.titulosRejeitados} título(s) rejeitado(s)`}
                                  >
                                    {r.titulosRejeitados}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {r.erros ? (
                                  <span
                                    className="text-danger"
                                    aria-label={`${r.erros} erro(s) de parse`}
                                  >
                                    {r.erros}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{r.filCod}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  {/* Arquivo apenas CARREGADO não tem linha de detalhe: só
                                      depois de processado. Por isso "Processar" some quando
                                      o ERP já processou. */}
                                  {!r.statusProcessamento ? (
                                    <Button
                                      size="sm"
                                      disabled={busy}
                                      title="Manda o ERP parsear o .RET e gravar as baixas no fin010."
                                      onClick={() => conciliar(r, true)}
                                    >
                                      Processar e conciliar
                                    </Button>
                                  ) : null}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    title="Só lê o resultado já processado e traz para os nossos lotes."
                                    onClick={() => conciliar(r, false)}
                                  >
                                    Conciliar
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <Paginacao aba={abaRetornos} />
                </>
              )}
            </TabsContent>

          </Tabs>
        </>
      ) : null}
    </div>
  )
}

'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
  ArrowLeftRight,
  Banknote,
  CheckCircle2,
  DatabaseZap,
  Download,
  Layers,
  RefreshCw,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlocacaoExcedeSaldoError,
  buscarInvoicesPorProcesso,
  criarAlocacao,
  reconciliarAdiantamento,
  reconciliarLoteAutomaticas,
  removerAlocacao,
} from '@/lib/api'
import { isSessionExpiredError } from '@/lib/http'
import type {
  CasamentoSugerido,
  InvoiceBuscada,
  InvoiceEmAberto,
  PermutaPendente,
  ReconciliarResult,
} from '@/lib/types'
import { RELATORIOS_DISPONIVEIS } from '@/lib/types'
import { cn, formatNumber, ordenarPorEtapaPermuta } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { BorderosPanel } from './BorderosPanel'
import {
  FiltroStatus,
  type ItemHistorico,
  LOTE_MAX,
  PAGE_SIZE,
  PROCESSAMENTO_HABILITADO,
  SALDO_TOL,
  STATUS_OPCOES,
  formatRunWhen,
  parseBrl,
  somaPorMoeda,
} from './components/format'
import { KpiFooter } from './components/ui'
import { useTabelaFiltro } from './components/tabela-filtro'
import { usePermutasData } from './components/usePermutasData'
import { useIngestao } from './components/useIngestao'
import { useExportRelatorios } from './components/useExportRelatorios'
import { VisaoGeralTable } from './components/VisaoGeralTable'
import { AbaAutomaticas } from './components/AbaAutomaticas'
import { AbaMultiplas } from './components/AbaMultiplas'
import { AbaCrossOver } from './components/AbaCrossOver'
import { AbaCrossProcess } from './components/AbaCrossProcess'
import { AbaHistorico } from './components/AbaHistorico'

// Modais — code-split (next/dynamic). Sempre montados (fechados) na árvore; o chunk carrega
// no load da página, então estão prontos quando o analista abre — sem flash de loading visível.
const ConfirmarProcessamentoDialog = dynamic(() =>
  import('./components/ConfirmarProcessamentoDialog').then(
    (m) => m.ConfirmarProcessamentoDialog,
  ),
)
const ConfirmarLoteDialog = dynamic(() =>
  import('./components/ConfirmarLoteDialog').then((m) => m.ConfirmarLoteDialog),
)
const IngestaoDialog = dynamic(() =>
  import('./components/IngestaoDialog').then((m) => m.IngestaoDialog),
)
const AlocarDialog = dynamic(() => import('./components/AlocarDialog').then((m) => m.AlocarDialog))
const ReconciliarDialog = dynamic(() =>
  import('./components/ReconciliarDialog').then((m) => m.ReconciliarDialog),
)

export default function GestaoPermutasPage() {
  const { data, loading, statusPorAdto, carregarStatus, load } = usePermutasData()
  const [filtro, setFiltro] = React.useState<FiltroStatus>('todos')
  // Filtro de filial (busca no Conexos é por filial — facilita conferir lá).
  const [filtroFilial, setFiltroFilial] = React.useState<string>('todas')
  // Filtro de exportador (busca por trecho do nome, case-insensitive).
  const [filtroExportador, setFiltroExportador] = React.useState<string>('')
  // Vista de invoices: todas as finalizadas vs. só as "casadas" (processo com adiantamento).
  const [filtroInvoiceTipo, setFiltroInvoiceTipo] = React.useState<'todas' | 'casadas'>('todas')
  // Paginação da tabela de pendentes (50 por página).
  const [pagina, setPagina] = React.useState(1)
  // Vista da tabela principal: adiantamentos pendentes ou invoices em aberto
  // (dirigida pelos KPIs). 'invoices' é ativada pelo KPI "Invoices em aberto".
  const [vista, setVista] = React.useState<'adiantamentos' | 'invoices'>('adiantamentos')
  // Linha expandida (docCod) — mostra as micro-informações do adiantamento.
  const [expandido, setExpandido] = React.useState<string | null>(null)
  // Invoice expandida (docCod) na LISTA de invoices em aberto — micro-info.
  const [invoiceListExpandida, setInvoiceListExpandida] = React.useState<string | null>(null)
  // Invoice expandida (docCod) na aba de casamento sugerido — micro-info da invoice.
  const [invoiceExpandida, setInvoiceExpandida] = React.useState<string | null>(null)
  // Confirmação de processamento (modal) — o casamento inteiro (invoice + todos
  // os adiantamentos a abater). null = fechado.
  const [confirmacao, setConfirmacao] = React.useState<CasamentoSugerido | null>(null)

  // Modal de ingestão manual (ADR-0006): trigger entre os cron jobs + trilha de auditoria.
  const {
    ingestaoOpen,
    setIngestaoOpen,
    runs,
    runsLoading,
    ingestRunning,
    abrirIngestao,
    rodarIngestao,
  } = useIngestao(load)

  // Exportação de relatórios (.xlsx).
  const { exportando, exportar } = useExportRelatorios()

  const [processando, setProcessando] = React.useState<string | null>(null)

  // Execução em LOTE das automáticas (botão "Executar"): diálogo de confirmação + estado de execução.
  const [confirmLoteOpen, setConfirmLoteOpen] = React.useState(false)
  const [executandoLote, setExecutandoLote] = React.useState(false)

  // Alocação manual cross-process (Fase 2): adto + busca de invoice por processo.
  const [alocando, setAlocando] = React.useState<PermutaPendente | null>(null)
  const [buscaProcesso, setBuscaProcesso] = React.useState<string>('')
  const [invoicesBuscadas, setInvoicesBuscadas] = React.useState<InvoiceBuscada[] | null>(null)
  const [buscandoInv, setBuscandoInv] = React.useState(false)
  const [invoiceAloc, setInvoiceAloc] = React.useState<string>('')
  const [valorAloc, setValorAloc] = React.useState<string>('')
  const [salvandoAloc, setSalvandoAloc] = React.useState(false)

  // Processa o casamento confirmado = BAIXA REAL no fin010 (cria borderô), igual aos manuais.
  // Para cada adiantamento do grupo, chama o reconciliar (que AUTO-ALOCA a partir do casamento) →
  // borderô em CADASTRO. Os já processados são ignorados. (Regra 2026-06-24: Automáticas baixam.)
  //
  // REVERSÃO 2026-08-05 (ADR-0029): entre 2026-07-31 e 2026-08-05 este botão gerou a Solicitação de
  // Numerário (com299) em vez da baixa. A SN da Frente I (Permutas) e a SN da Frente IV (Recebimentos)
  // são processos DIFERENTES; a semelhança entre os serviços trocou os fios e o Processar quebrou em
  // produção. A SN dos Recebimentos segue viva na sua própria página.
  const confirmarProcessamento = React.useCallback(async () => {
    if (!confirmacao) return
    const c = confirmacao
    const pendentes = c.adiantamentos.filter((a) => a.processamentoStatus !== 'processado')
    setConfirmacao(null)
    setProcessando(c.invoice.docCod)
    try {
      let settled = 0
      let erros = 0
      let dryRun = false
      const borderos = new Set<number>()
      for (const adto of pendentes) {
        const r = await reconciliarAdiantamento(adto.docCod, { dryRun: false })
        if (r.dryRun) dryRun = true
        settled += r.resultados.filter((x) => x.status === 'settled').length
        erros += r.resultados.filter((x) => x.status === 'error').length
        if (r.borCod !== undefined) borderos.add(r.borCod)
      }
      if (dryRun) {
        toast.info('Escrita desabilitada no servidor (dry-run). Payload validado, sem baixa real.')
      } else {
        if (erros > 0) toast.error(`${erros} baixa(s) falharam — veja a aba Borderôs.`)
        if (settled > 0)
          toast.success(
            `Processo ${c.priCod}: ${settled} baixa(s) no fin010 (borderô${
              borderos.size === 1 ? ` ${[...borderos][0]}` : 's'
            }, EM CADASTRO). Revise e aprove em Borderôs.`,
          )
      }
      await load()
    } catch (err) {
      if (isSessionExpiredError(err)) return
      toast.error(
        `Falha ao processar o processo ${c.priCod}${err instanceof Error ? `: ${err.message}` : ''}`,
      )
    } finally {
      setProcessando(null)
    }
  }, [confirmacao, load])

  // Executa o PRÓXIMO LOTE de automáticas (até LOTE_MAX) — um request ao backend (`/reconciliar-lote`),
  // que itera server-side com continue-on-error e capa em LOTE_MAX. Manda os "próximos N" pendentes; ao
  // recarregar, os baixados ganham borderô e somem da contagem → o analista clica de novo até zerar. O
  // "Processar" individual segue intacto. Decisão 2026-06-25: ignora filtros; lotes de 10 em 10.
  const executarLote = React.useCallback(
    async (docCods: string[], totalPendentes: number) => {
      setConfirmLoteOpen(false)
      setExecutandoLote(true)
      try {
        const r = await reconciliarLoteAutomaticas({ dryRun: false, adiantamentoDocCods: docCods })
        const restantes = Math.max(0, totalPendentes - r.totalCasos)
        const sufixoRestante = restantes > 0 ? ` Restam ${restantes} — clique em Executar de novo.` : ''
        if (r.dryRun) {
          toast.info('Escrita desabilitada no servidor (dry-run). Payloads validados, sem baixa real.')
        } else {
          if (r.totalSettled > 0)
            toast.success(
              `${r.totalSettled} baixa(s) no fin010 em ${r.borderos.length} borderô(s) (EM CADASTRO).${sufixoRestante}`,
            )
          if (r.totalErros > 0)
            toast.error(`${r.totalErros} baixa(s) falharam — os casos seguem pendentes para retry.`)
          if (r.totalSettled === 0 && r.totalErros === 0)
            toast.info('Nada a executar — as automáticas já estavam processadas.')
        }
        await load()
      } catch (err) {
        if (isSessionExpiredError(err)) return
        toast.error(`Falha ao executar o lote${err instanceof Error ? `: ${err.message}` : ''}`)
      } finally {
        setExecutandoLote(false)
      }
    },
    [load],
  )

  // --- Alocação manual (Fase 2) ---
  // A busca é SEMPRE escopada à filial do adiantamento — o priCod não é único entre
  // filiais (ex.: "523" filial 4 = ZHEJIANG VOB, "523" filial 6 = outra empresa).
  const buscarAloc = React.useCallback(
    async (priCodArg?: string, filCodArg?: number) => {
      const priCod = (priCodArg ?? buscaProcesso).trim()
      const filCod = filCodArg ?? alocando?.filCod
      if (!priCod || filCod == null) return
      setBuscandoInv(true)
      try {
        // Passa o docCod do adiantamento → o `jaAlocado` de cada invoice exclui
        // este adto, refletindo o disponível real da invoice compartilhada (N:M).
        setInvoicesBuscadas(await buscarInvoicesPorProcesso(priCod, filCod, alocando?.docCod))
        setInvoiceAloc('')
      } catch {
        setInvoicesBuscadas([])
        toast.error('Falha ao buscar invoices no Conexos.')
      } finally {
        setBuscandoInv(false)
      }
    },
    [buscaProcesso, alocando],
  )

  const abrirAlocar = React.useCallback(
    (p: PermutaPendente) => {
      setAlocando(p)
      setInvoiceAloc('')
      setValorAloc('')
      setInvoicesBuscadas(null)
      // Múltiplas/cross-over = MESMO processo → pré-preenche e já busca o próprio
      // processo. Cross-process casa com OUTRO processo → deixa em branco.
      const priProprio = p.tipoPermuta !== 'cross-process' ? p.detalhe?.priCod : undefined
      setBuscaProcesso(priProprio ?? '')
      if (priProprio) void buscarAloc(priProprio, p.filCod)
    },
    [buscarAloc],
  )

  const adicionarAloc = React.useCallback(async () => {
    if (!alocando || !invoiceAloc) return
    const inv = invoicesBuscadas?.find((i) => i.docCod === invoiceAloc)
    if (!inv) return
    const valor = parseBrl(valorAloc)
    if (!(Number.isFinite(valor) && valor > 0)) {
      toast.error('Informe um valor a alocar válido.')
      return
    }
    setSalvandoAloc(true)
    try {
      await criarAlocacao(alocando.docCod, {
        invoiceDocCod: inv.docCod,
        invoicePriCod: inv.priCod,
        valorAlocado: valor,
      })
      toast.success(`Alocado ${formatNumber(valor)} na invoice ${inv.docCod}.`)
      setInvoiceAloc('')
      setValorAloc('')
      await load()
    } catch (err) {
      if (isSessionExpiredError(err)) return
      if (err instanceof AlocacaoExcedeSaldoError) {
        toast.warning(err.message)
      } else {
        toast.error(`Falha ao alocar${err instanceof Error ? ` — ${err.message}` : ''}.`)
      }
    } finally {
      setSalvandoAloc(false)
    }
  }, [alocando, invoiceAloc, invoicesBuscadas, valorAloc, load])

  const removerAloc = React.useCallback(
    async (invoiceDocCod: string) => {
      if (!alocando) return
      try {
        await removerAlocacao(alocando.docCod, invoiceDocCod)
        toast.success(`Alocação da invoice ${invoiceDocCod} removida.`)
        await load()
      } catch (err) {
        if (isSessionExpiredError(err)) return
        toast.error(`Falha ao remover${err instanceof Error ? ` — ${err.message}` : ''}.`)
      }
    },
    [alocando, load],
  )

  // --- Reconciliação / baixa no ERP fin010 (Fase 3, ADR-0013) ---
  // Abre o modal SEMPRE em dry-run primeiro: o backend monta/loga o payload sem POST
  // (preview do borderô). A execução real é gated server-side (CONEXOS_WRITE_ENABLED +
  // CONEXOS_DRY_RUN) — o botão "Executar baixa" só age de verdade quando o backend permite.
  const [reconcilAdto, setReconcilAdto] = React.useState<PermutaPendente | null>(null)
  const [reconcilResult, setReconcilResult] = React.useState<ReconciliarResult | null>(null)
  const [reconcilLoading, setReconcilLoading] = React.useState(false)
  // Data do borderô (YYYY-MM-DD). Default = data da D.I/DUIMP; o analista ajusta quando o período
  // contábil da D.I está fechado (ERP recusa com DATA_BLOQUEADA_PELA_CONTABILIDADE).
  const [reconcilData, setReconcilData] = React.useState('')

  const abrirReconciliar = React.useCallback(async (p: PermutaPendente) => {
    setReconcilAdto(p)
    setReconcilResult(null)
    setReconcilData(
      p.detalhe?.declaracao?.dataBase?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    )
    setReconcilLoading(true)
    try {
      const result = await reconciliarAdiantamento(p.docCod, { dryRun: true })
      setReconcilResult(result)
    } catch (err) {
      if (isSessionExpiredError(err)) {
        setReconcilAdto(null)
        return
      }
      toast.error(`Falha no preview da baixa${err instanceof Error ? ` — ${err.message}` : ''}.`)
      setReconcilAdto(null)
    } finally {
      setReconcilLoading(false)
    }
  }, [])

  const executarReconciliar = React.useCallback(async () => {
    if (!reconcilAdto) return
    setReconcilLoading(true)
    try {
      // Data do borderô escolhida pelo analista (UTC midnight epoch-ms).
      const [y, m, d] = reconcilData.split('-').map(Number)
      const dataMovto =
        y && m && d ? Date.UTC(y, m - 1, d) : undefined
      // Idempotência é POR ESTADO DA ALOCAÇÃO (server-side, via atualizado_em): a mesma alocação
      // já baixada NÃO relança; re-alocar (ou adicionar nova) habilita um novo lançamento.
      const result = await reconciliarAdiantamento(reconcilAdto.docCod, {
        dryRun: false,
        ...(dataMovto !== undefined ? { dataMovto } : {}),
      })
      setReconcilResult(result)
      if (result.dryRun) {
        toast.info('Escrita desabilitada no servidor (dry-run). Payload validado, sem baixa real.')
      } else {
        const ok = result.resultados.filter((r) => r.status === 'settled').length
        const erros = result.resultados.filter((r) => r.status === 'error').length
        if (erros > 0) toast.error(`${erros} baixa(s) falharam — veja o detalhe.`)
        if (ok > 0)
          toast.success(
            `${ok} baixa(s) no borderô ${result.borCod} (EM CADASTRO). Revise e aprove em Borderôs.`,
          )
        await load()
      }
    } catch (err) {
      if (isSessionExpiredError(err)) return
      toast.error(`Falha ao executar a baixa${err instanceof Error ? ` — ${err.message}` : ''}.`)
    } finally {
      setReconcilLoading(false)
    }
  }, [reconcilAdto, reconcilData, load])

  // Reflete os dados frescos no modal de alocação após cada load().
  const alocandoAtual =
    alocando != null
      ? ((data?.pendentes ?? []).find((p) => p.docCod === alocando.docCod) ?? alocando)
      : null

  // Filiais distintas presentes nos dados (para o seletor de filial). UNIÃO de adiantamentos E
  // invoices: filiais que só têm invoice (sem adiantamento PROFORMA) — ex.: filial 6 — também precisam
  // ser selecionáveis, senão suas invoices ficam visíveis em "Todas as filiais" mas impossíveis de filtrar.
  const filiais = React.useMemo(() => {
    const s = new Set<number>()
    for (const p of data?.pendentes ?? []) s.add(p.filCod)
    for (const i of data?.invoicesEmAberto ?? []) s.add(i.filCod)
    return [...s].sort((a, b) => a - b)
  }, [data])

  // Invoice casada de cada adiantamento (a partir dos casamentos automáticos) —
  // usado no detalhe p/ o analista ver a cobertura (adto × invoice).
  const invoiceByAdto = React.useMemo(() => {
    const m = new Map<string, InvoiceEmAberto>()
    for (const c of data?.casamentos ?? []) {
      for (const a of c.adiantamentos) m.set(a.docCod, c.invoice)
    }
    return m
  }, [data])

  // Pendente por docCod — usado no modal de confirmação p/ puxar a variação.
  const pendenteByDocCod = React.useMemo(() => {
    const m = new Map<string, PermutaPendente>()
    for (const p of data?.pendentes ?? []) m.set(p.docCod, p)
    return m
  }, [data])

  // Busca por CLIENTE (importador) — preferência dos analistas; também casa exportador como fallback.
  const expBusca = filtroExportador.trim().toLowerCase()
  const casaBusca = (cliente?: string, exportador?: string) =>
    expBusca === '' ||
    (cliente ?? '').toLowerCase().includes(expBusca) ||
    (exportador ?? '').toLowerCase().includes(expBusca)
  const pendentesFiltrados = (data?.pendentes ?? []).filter(
    (p) =>
      (filtro === 'todos' || p.status === filtro) &&
      (filtroFilial === 'todas' || String(p.filCod) === filtroFilial) &&
      casaBusca(p.importador, p.exportador),
  )
  // "Casada" = invoice cujo processo (priCod) tem adiantamento pendente — a visão pré-universo.
  const priCodsComAdto = new Set(
    (data?.pendentes ?? []).map((p) => p.detalhe?.priCod).filter(Boolean) as string[],
  )
  // Invoices em aberto (vista 'invoices') — filtros de filial/cliente + Todas vs. Só casadas.
  const invoicesFiltradas = (data?.invoicesEmAberto ?? []).filter(
    (i) =>
      (filtroFilial === 'todas' || String(i.filCod) === filtroFilial) &&
      casaBusca(i.importador, i.exportador) &&
      (filtroInvoiceTipo === 'todas' || (i.priCod != null && priCodsComAdto.has(i.priCod))),
  )

  // Paginação: 50 linhas por página. Base muda conforme a vista ativa.
  const listaFiltrada = vista === 'invoices' ? invoicesFiltradas : pendentesFiltrados
  const totalPaginas = Math.max(1, Math.ceil(listaFiltrada.length / PAGE_SIZE))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const sliceInicio = (paginaAtual - 1) * PAGE_SIZE
  const pendentesPagina = pendentesFiltrados.slice(sliceInicio, sliceInicio + PAGE_SIZE)
  const invoicesPagina = invoicesFiltradas.slice(sliceInicio, sliceInicio + PAGE_SIZE)
  // Trocar filtro/filial volta à 1ª página (nos handlers → evita setState-in-effect).
  const mudarFiltro = (f: FiltroStatus) => {
    setFiltro(f)
    setVista('adiantamentos')
    setPagina(1)
  }
  const verInvoices = () => {
    setVista('invoices')
    setPagina(1)
  }
  const mudarFilial = (v: string) => {
    setFiltroFilial(v)
    setPagina(1)
  }
  const mudarExportador = (v: string) => {
    setFiltroExportador(v)
    setPagina(1)
  }

  // Listas-base por tipo de permuta (sem filtro de filial — cada aba tem o SEU
  // próprio filtro + paginação via useTabelaFiltro). Os contadores das abas usam
  // estas listas completas.
  const casamentoManualBase = (data?.pendentes ?? []).filter(
    (p) => p.status === 'casamento-manual',
  )
  //  - múltiplas  = 1 adiantamento → N invoices (mesmo processo).
  //  - cross-over = N adiantamentos ↔ M invoices (mesmo processo).
  const multiplas = casamentoManualBase.filter((p) => p.tipoPermuta === 'multiplas')
  const crossOver = casamentoManualBase.filter((p) => p.tipoPermuta === 'cross-over')
  // Cross-process = cliente-filtro (invoice em OUTRO processo) — alocação manual.
  const crossProcess = (data?.pendentes ?? []).filter((p) => p.status === 'permuta-manual')
  // Casamentos automáticos (sugeridos).
  const casamentosSugeridos = data?.casamentos ?? []

  // Resumo do lote de automáticas (para o diálogo de confirmação do botão "Executar"):
  // adiantamentos ainda SEM borderô vinculado (executáveis) + total a ser usado. Cobre TODAS as
  // automáticas (ignora filtros da tela) — o backend reconcilia o mesmo conjunto.
  const loteResumo = React.useMemo(() => {
    // Pendentes = adtos das automáticas SEM borderô vinculado e não-processados. Dedup por docCod.
    const vistos = new Set<string>()
    const pendentes: { docCod: string; valorASerUsado?: number; moeda?: string }[] = []
    for (const c of casamentosSugeridos) {
      for (const a of c.adiantamentos) {
        if (statusPorAdto[a.docCod] || a.processamentoStatus === 'processado') continue
        if (vistos.has(a.docCod)) continue
        vistos.add(a.docCod)
        pendentes.push(a)
      }
    }
    // Próximo lote = os primeiros LOTE_MAX pendentes (o backend capa no mesmo número).
    const proximos = pendentes.slice(0, LOTE_MAX)
    const totalUsd = proximos.reduce((s, a) => s + (a.valorASerUsado ?? 0), 0)
    return {
      casos: casamentosSugeridos.length,
      adtos: pendentes.length,
      proximosN: proximos.length,
      proximosDocCods: proximos.map((a) => a.docCod),
      totalUsd,
      moeda: proximos[0]?.moeda ?? 'USD',
    }
  }, [casamentosSugeridos, statusPorAdto])

  // Regra 2026-06-24 — múltiplas AUTOMÁTICAS (adto cobre todas as invoices, Σ ≤ adto) já vêm como
  // CASAMENTOS sintéticos do backend (pré-distribuídos) → aparecem na tabela de casamentos da aba
  // Automáticas, com "Processar", como um caso simples. Aqui só tiramos elas da aba Múltiplas
  // (manuais = Σ invoices > adto). Cross-over e cross-process continuam separados.
  const multiplasManuais = multiplas.filter((p) => p.autoElegivel !== true)

  // EXECUTADO = adiantamento já tem borderô vinculado (aguardando finalização OU finalizado). Estes
  // SAEM das abas de trabalho e vão para a aba "Histórico" — as abas de trabalho mostram só o que falta
  // processar/alocar/baixar (deixa de poluir com o que já foi permutado).
  const adtoExecutado = (docCod: string): boolean => statusPorAdto[docCod] !== undefined
  // Um casamento (Automáticas) ainda é "de trabalho" enquanto tiver ALGUM adiantamento sem borderô.
  const casamentoTrabalho = (c: CasamentoSugerido): boolean =>
    c.adiantamentos.some((a) => !adtoExecutado(a.docCod))

  // Manual (Múltipla/Cross-over/Cross-process): só SAI da aba de trabalho quando TOTALMENTE permutado —
  // tem borderô E não sobra saldo a permutar (saldoRestante ≈ 0). Baixa PARCIAL (sobrou saldo p/ alocar
  // mais invoices) CONTINUA na aba; o que foi lançado vai pra Borderôs + Histórico. Cancelar remove o
  // vínculo → reaparece (igual às automáticas). saldoRestante = saldo negociado − Σ alocações (as
  // alocações persistem após a baixa; o saldo do adto só zera de fato quando tudo é alocado).
  const permutaManualCompleta = (p: PermutaPendente): boolean =>
    adtoExecutado(p.docCod) && p.saldoRestante !== undefined && p.saldoRestante <= SALDO_TOL

  const casamentosTrabalho = casamentosSugeridos.filter(casamentoTrabalho)
  const multiplasTrabalho = multiplasManuais.filter((p) => !permutaManualCompleta(p))
  const crossOverTrabalho = crossOver.filter((p) => !permutaManualCompleta(p))
  const crossProcessTrabalho = crossProcess.filter((p) => !permutaManualCompleta(p))

  // Filtro (filial + busca) + paginação por aba — só as NÃO executadas.
  const abaSimples = useTabelaFiltro(
    casamentosTrabalho,
    (c) => c.invoice.filCod,
    (c) => `${c.priCod} ${c.invoice.importador ?? ''} ${c.invoice.exportador} ${c.invoice.referencia ?? ''}`,
  )
  const abaMultiplas = useTabelaFiltro(
    multiplasTrabalho,
    (p) => p.filCod,
    (p) => `${p.docCod} ${p.importador ?? ''} ${p.exportador}`,
  )
  const abaCrossOver = useTabelaFiltro(
    crossOverTrabalho,
    (p) => p.filCod,
    (p) => `${p.docCod} ${p.importador ?? ''} ${p.exportador}`,
  )
  const abaCrossProcess = useTabelaFiltro(
    crossProcessTrabalho,
    (p) => p.filCod,
    (p) => `${p.docCod} ${p.importador ?? ''} ${p.exportador}`,
  )

  // HISTÓRICO — tudo que já foi executado (tem borderô), unificado das 4 categorias. Read-only: as
  // ações (aprovar/cancelar/estornar) ficam na aba Borderôs. Ordem: aguardando aprovação no topo,
  // finalizadas no fundo; dentro de cada grupo, borderô mais recente primeiro.
  const historico: ItemHistorico[] = []
  for (const c of casamentosSugeridos) {
    for (const a of c.adiantamentos) {
      const v = statusPorAdto[a.docCod]
      if (!v) continue
      historico.push({
        key: `auto-${a.docCod}-${v.borCod}`,
        tipo: 'Automática',
        filCod: c.invoice.filCod,
        priCod: c.priCod,
        cliente: c.invoice.importador ?? '',
        exportador: c.invoice.exportador,
        adtoDocCod: a.docCod,
        // `valorASerUsado` zera quando a automática FINALIZA (a invoice foi abatida). Nesse caso usa o
        // valor negociado do PRÓPRIO adiantamento (estável), pra não mostrar 0 no histórico.
        valor:
          (a.valorASerUsado ?? 0) > 0
            ? a.valorASerUsado
            : (pendenteByDocCod.get(a.docCod)?.valorMoedaNegociada ?? a.valorASerUsado ?? null),
        moeda: a.moeda ?? c.invoice.moeda,
        borCod: v.borCod,
        finalizado: v.permutaStatus === 'finalizado',
        busca: `${c.priCod} ${c.invoice.importador ?? ''} ${a.docCod} ${v.borCod}`,
      })
    }
  }
  const pushPendentesHistorico = (lista: PermutaPendente[], tipo: string) => {
    for (const p of lista) {
      const v = statusPorAdto[p.docCod]
      if (!v) continue
      historico.push({
        key: `${tipo}-${p.docCod}-${v.borCod}`,
        tipo,
        filCod: p.filCod,
        priCod: p.detalhe?.priCod ?? '',
        cliente: p.importador ?? '',
        exportador: p.exportador,
        adtoDocCod: p.docCod,
        // "Só o que foi lançado": soma das alocações (o que entrou no borderô), não o adto inteiro.
        // Sem alocações detalhadas, cai no valor negociado do adto.
        valor:
          p.alocacoes && p.alocacoes.length > 0
            ? p.alocacoes.reduce((s, al) => s + al.valorAlocado, 0)
            : p.valorMoedaNegociada,
        moeda: p.moeda,
        borCod: v.borCod,
        finalizado: v.permutaStatus === 'finalizado',
        busca: `${p.docCod} ${p.importador ?? ''} ${v.borCod}`,
      })
    }
  }
  pushPendentesHistorico(multiplasManuais, 'Múltipla')
  pushPendentesHistorico(crossOver, 'Cross-over')
  pushPendentesHistorico(crossProcess, 'Cross-process')
  historico.sort((a, b) => (b.borCod ?? 0) - (a.borCod ?? 0)) // borderô mais recente primeiro
  const historicoOrdenado = ordenarPorEtapaPermuta(historico, (h) => [
    h.finalizado ? 'finalizada' : 'aguardando-aprovacao',
  ])
  const abaHistorico = useTabelaFiltro(
    historicoOrdenado,
    (h) => h.filCod,
    (h) => h.busca,
  )

  // Consolidação por MOEDA NEGOCIADA por card: USD como valor principal, demais
  // moedas (EUR, …) menores embaixo. Soma `valorMoedaNegociada`; itens sem
  // detalhe de moeda (ex.: não-pagos → null) não entram na soma.
  const pend = data?.pendentes ?? []
  const moedaTotais = {
    pendentes: somaPorMoeda(pend),
    elegiveis: somaPorMoeda(pend.filter((p) => p.status === 'elegivel')),
    casamentoManual: somaPorMoeda(pend.filter((p) => p.status === 'casamento-manual')),
    permutaManual: somaPorMoeda(pend.filter((p) => p.status === 'permuta-manual')),
    jaPermutado: somaPorMoeda(pend.filter((p) => p.status === 'ja-permutado')),
    bloqueadas: somaPorMoeda(pend.filter((p) => p.status === 'bloqueada')),
    invoicesEmAberto: somaPorMoeda(data?.invoicesEmAberto ?? []),
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestão de Permutas"
        subtitle="Adiantamentos PROFORMA pendentes de permuta e invoices em aberto — casamento e baixa assistidos (Frente I)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {data?.geradoEm ? (
              <span
                className="mr-1 whitespace-nowrap text-xs text-muted-foreground"
                title="Conclusão da última ingestão bem-sucedida"
              >
                últ. ingestão: {formatRunWhen(data.geradoEm)}
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden /> Atualizar
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/permutas/clientes-filtro" title="Cadastrar clientes para permuta manual">
                <Users aria-hidden /> Clientes filtro
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/permutas/borderos" title="Gestão de borderôs (revisão / status no ERP)">
                <Banknote aria-hidden /> Borderôs
              </Link>
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  title="Exportar os relatórios do painel para Excel (.xlsx)"
                  disabled={exportando !== null}
                >
                  <Download aria-hidden /> Exportar
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" aria-labelledby="exportar-titulo" className="w-72 p-1">
                <p
                  id="exportar-titulo"
                  className="px-2 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  Exportar para Excel (.xlsx)
                </p>
                {RELATORIOS_DISPONIVEIS.map((r) => (
                  <button
                    key={r.tipo}
                    type="button"
                    onClick={() => void exportar(r.tipo, r.label)}
                    disabled={exportando !== null}
                    title={r.descricao}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {exportando === r.tipo ? (
                      <Spinner className="size-4 shrink-0" aria-hidden />
                    ) : (
                      <Download className="size-4 shrink-0" aria-hidden />
                    )}
                    <span className="truncate">{r.label}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              onClick={abrirIngestao}
              title="Rodar a ingestão de dados do Conexos agora (entre os horários do cron)"
            >
              <DatabaseZap aria-hidden /> Ingestão de dados
            </Button>
          </div>
        }
      />

      {loading && !data ? (
        <LoadingSkeleton />
      ) : !data ? (
        <EmptyState title="Não foi possível carregar a gestão de permutas" />
      ) : (
        <>
          {/* Topo = RESUMO (contadores). Os tipos de permuta (simples/múltiplas/
              cross-over/cross-process) viram abas na área de trabalho abaixo. */}
          <KPIGrid columns={4}>
            <SimpleKPI
              color="info"
              label="Adiantamentos pendentes"
              value={data.totais.pendentes}
              footer={<KpiFooter totais={moedaTotais.pendentes}>PROFORMA aguardando permuta</KpiFooter>}
              tooltip="Mostrar todos os adiantamentos pendentes"
              active={vista === 'adiantamentos' && filtro === 'todos'}
              onClick={() => mudarFiltro('todos')}
            />
            <SimpleKPI
              color="info"
              label="Invoices em aberto"
              value={data.totais.invoicesEmAberto}
              footer={<KpiFooter totais={moedaTotais.invoicesEmAberto}>finalizadas, a casar</KpiFooter>}
              tooltip="Ver as invoices em aberto (com detalhes)"
              active={vista === 'invoices'}
              onClick={verInvoices}
            />
            <SimpleKPI
              color="info"
              label="Já permutado"
              value={data.totais.jaPermutado}
              footer={<KpiFooter totais={moedaTotais.jaPermutado}>concluído (permuta anterior)</KpiFooter>}
              tooltip="Filtrar a tabela pelos já permutados"
              active={vista === 'adiantamentos' && filtro === 'ja-permutado'}
              onClick={() => mudarFiltro('ja-permutado')}
            />
            <SimpleKPI
              color="danger"
              label="Bloqueadas"
              value={data.totais.bloqueadas}
              footer={<KpiFooter totais={moedaTotais.bloqueadas}>pendência de gate</KpiFooter>}
              tooltip="Filtrar a tabela pelas bloqueadas"
              active={vista === 'adiantamentos' && filtro === 'bloqueada'}
              onClick={() => mudarFiltro('bloqueada')}
            />
          </KPIGrid>

          {/* Filtros — filial (busca no Conexos é por filial), status e exportador. */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Filial</span>
              <Select value={filtroFilial} onValueChange={mudarFilial}>
                <SelectTrigger className="w-44" aria-label="Filtrar por filial">
                  <SelectValue placeholder="Todas as filiais" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas as filiais</SelectItem>
                  {filiais.map((f) => (
                    <SelectItem key={f} value={String(f)}>
                      Filial {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {vista === 'invoices' ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">Invoices</span>
                <Select
                  value={filtroInvoiceTipo}
                  onValueChange={(v) => setFiltroInvoiceTipo(v as 'todas' | 'casadas')}
                >
                  <SelectTrigger className="w-56" aria-label="Filtrar invoices">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as invoices</SelectItem>
                    <SelectItem value="casadas">Só casadas (com adiantamento)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-muted-foreground">Status</span>
                <Select value={filtro} onValueChange={(v) => mudarFiltro(v as FiltroStatus)}>
                  <SelectTrigger className="w-56" aria-label="Filtrar por status">
                    <SelectValue placeholder="Todos os status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPCOES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Cliente</span>
              <Input
                value={filtroExportador}
                onChange={(e) => mudarExportador(e.target.value)}
                placeholder="Buscar cliente…"
                aria-label="Filtrar por cliente"
              />
            </div>
          </div>

          {/* Visão geral — adiantamentos pendentes OU invoices em aberto (vista) */}
          <Card>
            <CardHeader>
              <CardTitle>
                {vista === 'invoices'
                  ? 'Invoices em aberto'
                  : 'Adiantamentos pendentes de permuta'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <VisaoGeralTable
                vista={vista}
                filtro={filtro}
                listaFiltrada={listaFiltrada}
                invoicesPagina={invoicesPagina}
                pendentesPagina={pendentesPagina}
                invoiceListExpandida={invoiceListExpandida}
                setInvoiceListExpandida={setInvoiceListExpandida}
                expandido={expandido}
                setExpandido={setExpandido}
                invoiceByAdto={invoiceByAdto}
                abrirAlocar={abrirAlocar}
                paginaAtual={paginaAtual}
                totalPaginas={totalPaginas}
                setPagina={setPagina}
              />
            </CardContent>
          </Card>

          {/* Aviso: processamento bloqueado até o write-back no Conexos. */}
          {!PROCESSAMENTO_HABILITADO ? (
            <div className="rounded-lg border border-warning/30 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground">
              <strong>Processamento temporariamente indisponível.</strong> A baixa/lançamento das
              permutas está bloqueado até a integração de publicação (write-back) no Conexos. Você
              pode revisar os casamentos, valores e a variação cambial — o lançamento será
              habilitado quando a escrita dos dados no Conexos estiver pronta.
            </div>
          ) : null}

          {/* Casamento — sugerido (auto 1:N) × manual (N:M), alternados por aba */}
          <Card>
            <Tabs
              defaultValue="automaticas"
              onValueChange={(v) => {
                // Auto-reload ao abrir uma aba de trabalho/histórico: rebusca os vínculos (status) do
                // NOSSO banco — é o que move as linhas entre trabalho/histórico e atualiza os badges.
                // (A aba Borderôs já se recarrega sozinha ao montar.)
                if (v !== 'borderos') void carregarStatus()
              }}
            >
              <CardHeader>
                <TabsList>
                  <TabsTrigger value="automaticas">
                    <ArrowLeftRight className="size-4" aria-hidden /> Automáticas (
                    {casamentosTrabalho.length})
                  </TabsTrigger>
                  <TabsTrigger value="multiplas">
                    <Layers className="size-4" aria-hidden /> Múltiplas ({multiplasTrabalho.length})
                  </TabsTrigger>
                  <TabsTrigger value="cross-over">
                    <Layers className="size-4" aria-hidden /> Cross-over ({crossOverTrabalho.length})
                  </TabsTrigger>
                  <TabsTrigger value="cross-process">
                    <ArrowLeftRight className="size-4" aria-hidden /> Cross-process (
                    {crossProcessTrabalho.length})
                  </TabsTrigger>
                  <TabsTrigger value="borderos">
                    <Banknote className="size-4" aria-hidden /> Borderôs
                  </TabsTrigger>
                  <TabsTrigger value="historico">
                    <CheckCircle2 className="size-4" aria-hidden /> Histórico ({historico.length})
                  </TabsTrigger>
                </TabsList>
              </CardHeader>
              <CardContent>
                <TabsContent value="multiplas" className="space-y-4">
                  <AbaMultiplas
                    aba={abaMultiplas}
                    statusPorAdto={statusPorAdto}
                    abrirAlocar={abrirAlocar}
                    abrirReconciliar={abrirReconciliar}
                    loading={loading}
                    onAtualizar={() => void load()}
                  />
                </TabsContent>

                <TabsContent value="cross-over" className="space-y-4">
                  <AbaCrossOver
                    aba={abaCrossOver}
                    statusPorAdto={statusPorAdto}
                    abrirAlocar={abrirAlocar}
                    abrirReconciliar={abrirReconciliar}
                    loading={loading}
                    onAtualizar={() => void load()}
                  />
                </TabsContent>

                <TabsContent value="cross-process" className="space-y-4">
                  <AbaCrossProcess
                    aba={abaCrossProcess}
                    statusPorAdto={statusPorAdto}
                    abrirAlocar={abrirAlocar}
                    abrirReconciliar={abrirReconciliar}
                    loading={loading}
                    onAtualizar={() => void load()}
                  />
                </TabsContent>

                <TabsContent value="automaticas" className="space-y-4">
                  <AbaAutomaticas
                    aba={abaSimples}
                    statusPorAdto={statusPorAdto}
                    invoiceExpandida={invoiceExpandida}
                    setInvoiceExpandida={setInvoiceExpandida}
                    processando={processando}
                    setConfirmacao={setConfirmacao}
                    loteResumo={loteResumo}
                    executandoLote={executandoLote}
                    setConfirmLoteOpen={setConfirmLoteOpen}
                    loading={loading}
                    onAtualizar={() => void load()}
                  />
                </TabsContent>

                {/* Borderôs in-place (lazy: o Radix só monta o conteúdo da aba ativa). */}
                <TabsContent value="borderos">
                  <BorderosPanel embedded />
                </TabsContent>

                <TabsContent value="historico" className="space-y-4">
                  <AbaHistorico
                    aba={abaHistorico}
                    loading={loading}
                    onAtualizar={() => void load()}
                  />
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

          {/* Modal de confirmação do processamento (checkout) */}
          <ConfirmarProcessamentoDialog
            confirmacao={confirmacao}
            onClose={() => setConfirmacao(null)}
            pendenteByDocCod={pendenteByDocCod}
            confirmarProcessamento={confirmarProcessamento}
          />

          {/* Confirmação do lote — "Executar todas" as automáticas de uma vez */}
          <ConfirmarLoteDialog
            open={confirmLoteOpen}
            onOpenChange={setConfirmLoteOpen}
            loteResumo={loteResumo}
            executandoLote={executandoLote}
            executarLote={executarLote}
          />

          {/* Modal de ingestão manual de dados (ADR-0006) */}
          <IngestaoDialog
            open={ingestaoOpen}
            setOpen={setIngestaoOpen}
            ingestRunning={ingestRunning}
            runs={runs}
            runsLoading={runsLoading}
            rodarIngestao={rodarIngestao}
          />

          {/* Modal de alocação manual cross-process (Fase 2) */}
          <AlocarDialog
            alocandoAtual={alocandoAtual}
            onClose={() => setAlocando(null)}
            buscaProcesso={buscaProcesso}
            setBuscaProcesso={setBuscaProcesso}
            buscarAloc={buscarAloc}
            buscandoInv={buscandoInv}
            invoicesBuscadas={invoicesBuscadas}
            invoiceAloc={invoiceAloc}
            setInvoiceAloc={setInvoiceAloc}
            valorAloc={valorAloc}
            setValorAloc={setValorAloc}
            salvandoAloc={salvandoAloc}
            adicionarAloc={adicionarAloc}
            removerAloc={removerAloc}
          />

          {/* Baixa no ERP fin010 (Fase 3) — preview (dry-run) → executar */}
          <ReconciliarDialog
            reconcilAdto={reconcilAdto}
            onClose={() => {
              setReconcilAdto(null)
              setReconcilResult(null)
            }}
            reconcilResult={reconcilResult}
            reconcilLoading={reconcilLoading}
            reconcilData={reconcilData}
            setReconcilData={setReconcilData}
            executarReconciliar={executarReconciliar}
          />
        </>
      )}
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <KPIGrid columns={4}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </KPIGrid>
      <Skeleton className="h-64" />
    </div>
  )
}

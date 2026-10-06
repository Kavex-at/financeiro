'use client'

import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  DatabaseZap,
  Layers,
  Lock,
  LogOut,
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
  fetchLotes,
  fetchRetornos,
  fetchSispagPainel,
  fetchIngestaoRuns,
  finalizarLote,
  formarLotes,
  formatErpDay,
  IngestaoPagamentosEmAndamentoError,
  retirarDoLote,
  type PagamentoIngestaoRun,
  reabrirLote,
  ConciliacaoEmDuvidaError,
  DebitDateFrozenError,
  DebitDateOutsideWindowError,
  LoteAnteriorCanceladoError,
  RemessaEmAndamentoError,
  BoletoSemCodigoBarrasError,
  RemessaEmDuvidaError,
  type TituloSemBoleto,
  removerItem,
  runIngestaoPagamentos,
  type LotePagamento,
  type SispagPainel,
  type TituloAPagar,
} from '@/lib/sispag'
import { FiltroBarra, Paginacao, useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'
import {
  chavesComBoleto,
  diaDoRetorno,
  filtroCandidatos,
  filtroFinalizados,
  filtroLotesNativos,
  filtroRetornos,
  filtroTitulos,
  formatarDia,
  ROTULO_DATA,
  TITULO_BOLETO_LOTE,
} from './components/filtrosAbas'
import { AdicionarTituloDialog } from './components/AdicionarTituloDialog'
import { BoletosDdaTab } from './components/BoletosDdaTab'
import { BoletosDoTituloDialog } from './components/BoletosDoTituloDialog'
import { ConfirmarProcessarRetornoDialog } from './components/ConfirmarAcaoDialog'
import { IngestaoDialog } from './components/IngestaoDialog'
import { useCarteiraAoAbrir } from './useCarteiraAoAbrir'
import { LoteCard } from './components/LoteCard'
import { ExportarTitulosBarra, useSelecaoRemessas } from './components/ExportarTitulosBarra'
import { RetirarDoLoteDialog } from './components/RetirarDoLoteDialog'
import { MoverParaLoteDialog } from './components/MoverParaLoteDialog'
import { motivoSelecaoBloqueada, podeSelecionar } from './components/moverParaLote'
import { useCriarLoteManual } from './components/useCriarLoteManual'
import { alternarTodos, estadoSelecionarTodos } from './components/selecionarTodos'
import { paginaDoLote, rotuloLote, textoBuscaLote } from './components/loteDoTitulo'
import { ExigePermissao } from '@/components/auth/ExigePermissao'
import { usePermissoes } from '@/lib/auth/PermissoesProvider'
import { PERMISSAO } from '@/lib/permissoes'

const keyOf = (t: TituloAPagar) => `${t.filCod}:${t.docCod}:${t.titCod}`
const textoBuscaTitulo = (t: TituloAPagar) => `${t.credor ?? ''} ${t.docCod}/${t.titCod} ${t.banco ?? ''}`

/** Lotes candidatos por página na aba "Lotes candidatos" (o link da linha do título usa). */
const LOTES_POR_PAGINA = 8

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
 * Estado de erro das abas de lotes. Existe para que "o endpoint falhou" nunca se pareça com
 * "não há lote" — as duas coisas pedem ações opostas de quem opera.
 */
function LotesIndisponiveis({
  erro,
  onRecarregar,
}: {
  erro: string
  onRecarregar: () => Promise<void>
}) {
  const [recarregando, setRecarregando] = React.useState(false)
  const recarregar = async () => {
    setRecarregando(true)
    try {
      await onRecarregar()
    } finally {
      setRecarregando(false)
    }
  }
  return (
    <EmptyState
      role="alert"
      icon={<AlertTriangle className="size-6 text-danger" />}
      title="Não foi possível carregar os lotes"
      description={`${erro} A lista não está vazia: ela não carregou. Tente de novo; se persistir, avise o time.`}
      action={
        <Button size="sm" variant="outline" onClick={recarregar} disabled={recarregando}>
          <RefreshCcw className="size-4" />
          {recarregando ? 'Recarregando…' : 'Tentar de novo'}
        </Button>
      }
    />
  )
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
  // Flag primeiro (I8), permissão depois: com a frente desligada, ninguém vê o painel.
  return (
    <ExigePermissao permissao={PERMISSAO.SISPAG_VER}>
      <SispagPanel />
    </ExigePermissao>
  )
}

function SispagPanel() {
  // ADR-0053: toda ação da tela exige `sispag:executar`. Sem ela (ou enquanto carrega), os botões
  // SOMEM — nunca ficam desabilitados (R11). A aba Boletos DDA fica para quem vê a página
  // (`sispag:ver`); só o "Atualizar DDA" dentro dela exige executar.
  const { carregando: carregandoPermissoes, tem } = usePermissoes()
  const podeExecutar = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXECUTAR)
  // ADR-0061: a tela de exceções de destino só aparece para quem tem `sispag:excecao`.
  const podeExcecao = !carregandoPermissoes && tem(PERMISSAO.SISPAG_EXCECAO)
  const [painel, setPainel] = React.useState<SispagPainel | null>(null)
  const [lotes, setLotes] = React.useState<LotePagamento[]>([])
  const [lotesErro, setLotesErro] = React.useState<string | null>(null)
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
  // "Processar e conciliar" faz o ERP gravar baixas no fin010: só depois da confirmação.
  const [processarRetorno, setProcessarRetorno] = React.useState<ArquivoRetorno | null>(null)
  const [runs, setRuns] = React.useState<PagamentoIngestaoRun[] | null>(null)
  const [runsLoading, setRunsLoading] = React.useState(false)
  // Abas controladas: o link do lote na linha do título (ADR-0050) troca de aba.
  const [aba, setAba] = React.useState('titulos')
  const [tituloDda, setTituloDda] = React.useState<TituloSemBoleto | null>(null)
  const [loteEmFoco, setLoteEmFoco] = React.useState<string | null>(null)
  const [retirando, setRetirando] = React.useState<TituloAPagar | null>(null)
  const [salvandoRetirada, setSalvandoRetirada] = React.useState(false)

  // Os lotes vêm de outro endpoint (`/sispag/lotes`) e podem falhar sozinhos. Falha NÃO vira
  // lista vazia: em 2026-09-23 o endpoint quebrou (coluna da 0061 ainda sem migrar) e a tela
  // mostrou "0 lotes" — indistinguível de "não há lote". O erro fica em `lotesErro` e as abas
  // de lotes dizem que não carregaram; a lista anterior é mantida, mas não exibida.
  const recarregarLotes = React.useCallback(async () => {
    try {
      setLotes(await fetchLotes())
      setLotesErro(null)
    } catch (e) {
      if (isSessionExpiredError(e)) return
      setLotesErro(e instanceof Error ? e.message : 'Falha ao carregar os lotes.')
    }
  }, [])

  const carregar = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // `recarregarLotes` não lança: a falha dos lotes não derruba o painel inteiro.
      const [p] = await Promise.all([fetchSispagPainel(), recarregarLotes()])
      setPainel(p)
    } catch (e) {
      // Sessão expirada tem dono: o SessionExpiredModal. Se renderizarmos o nosso
      // EmptyState aqui, ele cobre o modal e o usuário fica sem caminho para o login.
      if (isSessionExpiredError(e)) return
      setError(e instanceof Error ? e.message : 'Falha ao carregar o painel.')
    } finally {
      setLoading(false)
    }
  }, [recarregarLotes])

  // Relê só o painel, sem o spinner de página inteira do `carregar` — a analista continua na
  // aba em que estava depois de retirar um título do lote.
  const recarregarPainel = React.useCallback(async () => {
    try {
      setPainel(await fetchSispagPainel())
    } catch {
      /* mantém o painel anterior */
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

  // ADR-0060: com o painel já na tela (dados gravados), pede o refresh se a carteira estiver
  // defasada e recarrega o painel — sem spinner — quando a ingestão termina.
  const { situacao: refresh, aviso: avisoRefresh } = useCarteiraAoAbrir({
    habilitado: !loading && painel !== null,
    aoAtualizar: recarregarPainel,
  })

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
    textoBuscaTitulo,
    undefined,
    filtroTitulos,
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
  const buscaLote = textoBuscaLote
  // Boleto do item vem da carteira (o item não carrega o flag) — memo: entra nas deps do filtro.
  const extrasCandidatos = React.useMemo(
    () => filtroCandidatos(chavesComBoleto(painel?.titulos ?? [])),
    [painel?.titulos],
  )
  const abaCandidatos = useTabelaFiltro(
    lotesRascunho,
    (l) => l.filCod,
    buscaLote,
    LOTES_POR_PAGINA,
    extrasCandidatos,
  )

  /** Link do lote na linha do título: abre a aba de candidatos na página do lote e o destaca. */
  const irParaLote = (loteId: string) => {
    const pagina = paginaDoLote(
      lotesRascunho.map((l) => l.id),
      loteId,
      LOTES_POR_PAGINA,
    )
    if (pagina === null) {
      toast.warning('Lote não encontrado na lista', {
        description: 'A lista de lotes pode estar desatualizada. Clique em atualizar e tente de novo.',
      })
      return
    }
    abaCandidatos.setFilial('todas')
    abaCandidatos.setBusca('')
    abaCandidatos.limparFiltros() // data e boleto também — senão o lote pode estar escondido
    abaCandidatos.setPagina(pagina)
    setAba('lotes-candidatos')
    setLoteEmFoco(loteId)
  }

  const trocarAba = (valor: string) => {
    setAba(valor)
    if (valor !== 'lotes-candidatos') setLoteEmFoco(null)
  }

  const chaveDe = (t: TituloAPagar) => ({ filCod: t.filCod, docCod: t.docCod, titCod: t.titCod })

  const confirmarRetirada = async () => {
    if (!retirando) return
    setSalvandoRetirada(true)
    try {
      await retirarDoLote(chaveDe(retirando))
      toast.success('Título retirado do lote', {
        description: 'Ele já pode ser incluído em outro lote.',
      })
      setRetirando(null)
      await Promise.all([recarregarPainel(), recarregarLotes()])
    } catch (e) {
      if (isSessionExpiredError(e)) return
      toast.error('Não foi possível retirar o título do lote', {
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSalvandoRetirada(false)
    }
  }

  const finFiltrados = lotesFinalizados.filter((l) =>
    statusFin === 'aguardando'
      ? l.status === 'FINALIZADO'
      : statusFin === 'remessa'
        ? l.status === 'REMESSA_GERADA'
        : statusFin === 'retornado'
          ? l.status === 'RETORNADO' || l.status === 'BAIXADO'
          : true,
  )
  const abaFinalizados = useTabelaFiltro(
    finFiltrados,
    (l) => l.filCod,
    buscaLote,
    8,
    filtroFinalizados,
  )
  // Export dos títulos das remessas (lote C): seleção nos cards da aba Finalizados.
  const selecaoRemessas = useSelecaoRemessas()
  // Retornos (.RET) do fin052 — mesmo kit (filial + busca + paginação) das demais abas.
  const abaRetornos = useTabelaFiltro(
    retornos ?? [],
    (r) => r.filCod,
    (r) => `${r.banco ?? ''} ${r.configNome ?? ''} ${r.arquivo ?? ''}`,
    undefined,
    filtroRetornos,
  )
  // Lançamento Lote (REM) — lotes nativos do fin015 que o painel já trouxe; filtro no cliente.
  const abaRem = useTabelaFiltro(
    painel?.lotes ?? [],
    (l) => l.filCod,
    (l) => `${l.banco ?? ''} ${l.conta ?? ''} ${l.layoutConta ?? ''} ${l.finalizadoPor ?? ''}`,
    undefined,
    filtroLotesNativos,
  )

  const selTitulos = titulos.filter((t) => selecionados.has(keyOf(t)))
  const totalSelecionado = selTitulos.reduce((acc, t) => acc + t.valor, 0)

  const toggle = (t: TituloAPagar) => {
    // ADR-0064: título em lote RASCUNHO pode ser selecionado (ele se move para o lote novo);
    // em lote finalizado ou com remessa gerada, não.
    if (!podeSelecionar(t)) return
    setSelecionados((prev) => {
      const next = new Set(prev)
      const k = keyOf(t)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  // ADR-0064: "selecionar todos" vale para TODAS as linhas do filtro (todas as páginas).
  const todosDoFiltro = estadoSelecionarTodos(
    abaTitulos.filtrados,
    selecionados,
  )

  const loteManual = useCriarLoteManual({
    selecionados: selTitulos,
    lotes,
    aoConcluir: async () => {
      setSelecionados(new Set())
      await Promise.all([recarregarLotes(), recarregarPainel()])
    },
  })

  const acaoLote = async (
    fn: (opts?: { confirmarNovoLote?: boolean }) => Promise<unknown>,
    // Função quando a confirmação depende do QUE ACONTECEU. "Remessa gerada" e
    // "simulação em dry-run" não podem ter a mesma mensagem num botão que move dinheiro.
    okMsg: string | ((resultado: unknown) => { titulo: string; descricao?: string }),
  ) => {
    setBusy(true)
    try {
      const resultado = await fn()
      // O painel também muda: a linha do título mostra o lote em que está (ADR-0050).
      await Promise.all([recarregarLotes(), recarregarPainel()])
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
      } else if (e instanceof DebitDateOutsideWindowError) {
        // Nada foi escrito no ERP: a data não cabe na janela do lote (ADR-0049). A mensagem do
        // backend já nomeia o título que limita e a janela permitida.
        toast.warning('Data de débito fora da janela', {
          description: `${e.message} Abra "Gerar remessa" de novo para escolher outra data.`,
          duration: 20000,
        })
      } else if (e instanceof DebitDateFrozenError) {
        // O lote nativo já nasceu no Conexos com outra data: trocar exige cancelá-lo no fin015.
        toast.warning('Data de débito já fixada no Conexos (fin015)', {
          description: e.message,
          duration: 30000,
        })
      } else if (e instanceof BoletoSemCodigoBarrasError) {
        // Nada foi escrito no ERP. A analista confere valor e data dos boletos DDA do título.
        toast.warning('Boleto sem DDA associado', {
          description: e.message,
          duration: 30000,
          action: {
            label: 'Ver boletos DDA',
            onClick: () => setTituloDda(e.titulo),
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
            {podeExecutar ? (
              <Button
                size="sm"
                onClick={abrirIngestao}
                title="Ver as últimas ingestões (cron/manual) e rodar sob demanda"
              >
                <DatabaseZap aria-hidden /> Ingestão de dados
              </Button>
            ) : null}
            {podeExcecao ? (
              <Button variant="outline" size="sm" asChild>
                <Link href="/sispag/excecoes">Exceções de destino</Link>
              </Button>
            ) : null}
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

      <MoverParaLoteDialog
        plano={loteManual.plano}
        totalSelecionados={loteManual.totalConfirmacao}
        onClose={loteManual.cancelar}
        salvando={loteManual.criando}
        onConfirmar={loteManual.confirmar}
      />

      <RetirarDoLoteDialog
        titulo={retirando}
        onClose={() => setRetirando(null)}
        salvando={salvandoRetirada}
        onConfirmar={() => void confirmarRetirada()}
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
          <span role="status" aria-live="polite">
            {refresh === 'atualizando' ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {' '}
                · <Spinner /> atualizando a carteira…
              </span>
            ) : refresh === 'falhou' ? (
              <span className="text-warning">
                {' '}
                · não foi possível atualizar agora
                {avisoRefresh ? ` (${avisoRefresh})` : ''}; mostrando a última carteira gravada
              </span>
            ) : null}
          </span>
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
              value={
                lotesErro
                  ? '—'
                  : lotes.filter((l) => l.status !== 'CANCELADO').length.toLocaleString('pt-BR')
              }
              color="info"
              footer={
                lotesErro
                  ? 'não foi possível carregar'
                  : `${lotes.filter((l) => l.status === 'FINALIZADO').length} finalizados`
              }
            />
          </KPIGrid>

          <Tabs value={aba} onValueChange={trocarAba}>
            <TabsList>
              <TabsTrigger value="titulos">Títulos a pagar</TabsTrigger>
              <TabsTrigger value="lotes-candidatos">
                Lotes candidatos ({lotesErro ? '—' : lotesRascunho.length})
              </TabsTrigger>
              <TabsTrigger value="lotes-finalizados">
                Finalizados ({lotesErro ? '—' : lotesFinalizados.length})
              </TabsTrigger>
              <TabsTrigger value="lotes">Lançamento Lote (REM) - Conexos</TabsTrigger>
              <TabsTrigger value="retornos">Retorno Lote (RET) - Conexos</TabsTrigger>
              <TabsTrigger value="boletos-dda">Boletos DDA (fin124)</TabsTrigger>
            </TabsList>

            {/* ---- Boletos DDA (fin124) — carrega ao abrir a aba; basta `sispag:ver` ---- */}
            <TabsContent value="boletos-dda">
              <BoletosDdaTab />
            </TabsContent>

            {/* ---- Títulos a pagar ---- */}
            <TabsContent value="titulos" className="space-y-3">
              <FiltroBarra
                aba={abaTitulos}
                buscaPlaceholder="Buscar por credor, documento ou banco…"
                rotuloData={ROTULO_DATA.titulos}
                filtroBoleto
              />
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
                  {/* aria-live: o "selecionar todos" marca linhas de outras páginas — anuncia a contagem. */}
                  <span className="text-xs text-muted-foreground" aria-live="polite">
                    {selecionados.size > 0
                      ? `${selecionados.size} sel. · ${formatBRL(totalSelecionado)}`
                      : ''}
                  </span>
                  {podeExecutar ? (
                    <>
                      <Button size="sm" variant="outline" onClick={formar} disabled={formando}>
                        <Layers className="size-4" />{' '}
                        {formando ? 'Formando…' : 'Formar lotes automáticos'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={selecionados.size === 0 || busy || loteManual.criando}
                        onClick={loteManual.iniciar}
                      >
                        <Layers className="size-4" /> Criar lote ({selecionados.size})
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              {abaTitulos.total === 0 ? (
                <EmptyState
                  icon={titulos.length === 0 ? <DatabaseZap className="size-6" /> : undefined}
                  title={titulos.length === 0 ? 'Carteira vazia' : 'Nenhum título encontrado'}
                  description={
                    titulos.length === 0
                      ? 'Clique em "Ingestão de dados" para carregar os títulos a pagar do Conexos.'
                      : 'Ajuste a faixa, a filial, o vencimento, o boleto ou a busca acima.'
                  }
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {podeExecutar ? (
                          <TableHead className="w-10">
                            <Checkbox
                              checked={todosDoFiltro.marcado}
                              onCheckedChange={() =>
                                setSelecionados((prev) => alternarTodos(todosDoFiltro, prev))
                              }
                              disabled={todosDoFiltro.bloqueio !== undefined}
                              aria-label={
                                todosDoFiltro.bloqueio ??
                                `selecionar os ${todosDoFiltro.chaves.length} títulos do filtro`
                              }
                              title={
                                todosDoFiltro.bloqueio ??
                                `Seleciona os ${todosDoFiltro.chaves.length} títulos do filtro, em todas as páginas.`
                              }
                            />
                          </TableHead>
                        ) : null}
                        <TableHead>Credor</TableHead>
                        <TableHead>Documento</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Boleto</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead>Filial</TableHead>
                        <TableHead>
                          <span className="sr-only">Ações</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {abaTitulos.slice.map((t) => (
                        <TableRow key={keyOf(t)}>
                          {podeExecutar ? (
                            <TableCell>
                              <Checkbox
                                checked={selecionados.has(keyOf(t))}
                                onCheckedChange={() => toggle(t)}
                                disabled={!podeSelecionar(t)}
                                aria-label={motivoSelecaoBloqueada(t) ?? 'selecionar título'}
                                title={
                                  motivoSelecaoBloqueada(t) ??
                                  (t.loteRascunho
                                    ? 'Está num lote em rascunho: ao criar o lote, ele sai de lá e entra no novo.'
                                    : undefined)
                                }
                              />
                            </TableCell>
                          ) : null}
                          <TableCell className="max-w-[18rem] truncate font-medium">
                            <span
                              className={t.emLote || t.loteComprometido ? 'text-muted-foreground' : undefined}
                            >
                              {t.credor ?? '—'}
                            </span>
                            {t.loteRascunho ? (
                              <Button
                                variant="link"
                                size="sm"
                                className="ml-2 h-auto p-0 text-xs"
                                onClick={() => t.loteRascunho && irParaLote(t.loteRascunho.id)}
                                title="Abrir o lote em que este título está."
                              >
                                <Layers className="size-3" aria-hidden />
                                {rotuloLote(t.loteRascunho)}
                              </Button>
                            ) : t.loteComprometido ? (
                              <Badge
                                variant="outline"
                                className="ml-2 border-muted text-muted-foreground"
                                title={motivoSelecaoBloqueada(t)}
                              >
                                <Lock className="mr-1 size-3" aria-hidden />
                                {t.loteComprometido.status === 'FINALIZADO'
                                  ? 'lote finalizado'
                                  : 'remessa gerada'}
                              </Badge>
                            ) : t.emLote ? (
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
                                {formatErpDay(t.vencimento)}
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
                          <TableCell className="text-right">
                            {t.loteRascunho && podeExecutar ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy || salvandoRetirada}
                                onClick={() => setRetirando(t)}
                              >
                                <LogOut className="size-4" aria-hidden /> Retirar do lote
                              </Button>
                            ) : null}
                          </TableCell>
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
                buscaPlaceholder="Buscar por documento, credor, filial ou quem criou…"
                rotuloData={ROTULO_DATA.candidatos}
                filtroBoleto
                tituloBoleto={TITULO_BOLETO_LOTE}
              />
              {lotesErro ? (
                <LotesIndisponiveis erro={lotesErro} onRecarregar={recarregarLotes} />
              ) : abaCandidatos.total === 0 ? (
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
                      {...(podeExecutar ? { onAdicionar: setAdicionarLote } : {})}
                      destacado={loteEmFoco === l.id}
                    />
                  ))}
                </div>
              )}
              <Paginacao aba={abaCandidatos} />
            </TabsContent>

            {/* ---- Lotes finalizados (a gerar remessa / remessa gerada / conciliados) ---- */}
            <TabsContent value="lotes-finalizados" className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Lotes finalizados — prontos para virar remessa, com remessa gerada aguardando o
                retorno do banco, ou já conciliados.
              </p>
              <FiltroBarra
                aba={abaFinalizados}
                buscaPlaceholder="Buscar por documento, credor, filial ou quem finalizou…"
                rotuloData={ROTULO_DATA.finalizados}
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
              {lotesErro ? (
                <LotesIndisponiveis erro={lotesErro} onRecarregar={recarregarLotes} />
              ) : abaFinalizados.total === 0 ? (
                <EmptyState
                  icon={<Layers className="size-6" />}
                  title="Nenhum lote finalizado"
                  description="Finalize um lote candidato para ele aparecer aqui, pronto para gerar a remessa."
                />
              ) : (
                <div className="space-y-3">
                  <ExportarTitulosBarra
                    lotes={finFiltrados}
                    selecionados={selecaoRemessas.selecionados}
                    onDefinir={selecaoRemessas.definir}
                  />
                  {abaFinalizados.slice.map((l) => (
                    <LoteCard
                      key={l.id}
                      lote={l}
                      busy={busy}
                      acao={acaoLote}
                      selecionado={selecaoRemessas.selecionados.has(l.id)}
                      onSelecionar={selecaoRemessas.alternar}
                    />
                  ))}
                </div>
              )}
              <Paginacao aba={abaFinalizados} />
            </TabsContent>


            {/* ---- Lotes SISPAG nativos ---- */}
            <TabsContent value="lotes" className="space-y-3">
              <FiltroBarra
                aba={abaRem}
                buscaPlaceholder="Buscar por banco, conta, layout ou quem finalizou…"
                rotuloData={ROTULO_DATA.rem}
              />
              {abaRem.total === 0 && painel.lotes.length > 0 ? (
                <EmptyState
                  icon={<Layers className="size-6" />}
                  title="Nenhum lote para o filtro"
                  description="Ajuste a filial, a data de crédito ou a busca acima."
                />
              ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Banco / conta</TableHead>
                      <TableHead>Layout</TableHead>
                      <TableHead className="text-right">Títulos</TableHead>
                      <TableHead className="text-right">Soma</TableHead>
                      <TableHead>{ROTULO_DATA.rem}</TableHead>
                      <TableHead>Envio</TableHead>
                      <TableHead>Retorno</TableHead>
                      <TableHead>Finalizado por</TableHead>
                      <TableHead>Filial</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {abaRem.slice.map((l) => (
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
                        <TableCell className="text-xs text-muted-foreground">
                          {l.dataCredito ? formatErpDay(l.dataCredito) : '—'}
                        </TableCell>
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
              )}
              <Paginacao aba={abaRem} />
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
                    rotuloData={ROTULO_DATA.retornos}
                  />
                  {abaRetornos.total === 0 ? (
                    <EmptyState
                      icon={<Layers className="size-6" />}
                      title="Nenhum retorno para o filtro"
                      description="Ajuste a filial, a data ou a busca para ver os arquivos .RET."
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
                            <TableHead>{ROTULO_DATA.retornos}</TableHead>
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
                              <TableCell className="text-xs text-muted-foreground">
                                {formatarDia(diaDoRetorno(r))}
                              </TableCell>
                              <TableCell className="text-muted-foreground">{r.filCod}</TableCell>
                              <TableCell className="text-right">
                                {podeExecutar ? (
                                <div className="flex justify-end gap-2">
                                  {/* Arquivo apenas CARREGADO não tem linha de detalhe: só
                                      depois de processado. Por isso "Processar" some quando
                                      o ERP já processou. */}
                                  {!r.statusProcessamento ? (
                                    <Button
                                      size="sm"
                                      disabled={busy}
                                      title="Manda o ERP parsear o .RET e gravar as baixas no fin010."
                                      onClick={() => setProcessarRetorno(r)}
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
                                ) : null}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <Paginacao aba={abaRetornos} />
                  {processarRetorno ? (
                    <ConfirmarProcessarRetornoDialog
                      retorno={processarRetorno}
                      onOpenChange={(open) => {
                        if (!open) setProcessarRetorno(null)
                      }}
                      busy={busy}
                      onConfirmar={() => void conciliar(processarRetorno, true)}
                    />
                  ) : null}
                </>
              )}
            </TabsContent>

          </Tabs>
          <BoletosDoTituloDialog titulo={tituloDda} onClose={() => setTituloDda(null)} />
        </>
      ) : null}
    </div>
  )
}

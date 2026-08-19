'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Archive,
  Banknote,
  Copy,
  Coins,
  Landmark,
  ListChecks,
  RefreshCcw,
  Upload,
  UserSearch,
} from 'lucide-react'
import { toast } from 'sonner'
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
import { Button } from '@/components/ui/button'
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { formatBRL } from '@/lib/utils'
import {
  arquivarTransacao,
  fetchPainelEnriquecimento,
  fetchPainelRecebimentos,
  type PainelStatusFiltro,
  type RecebimentosPainel,
  type TransacaoBancaria,
} from '@/lib/recebimentos'
import { FiltroBarra, Paginacao, useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'
import {
  MatchClassificacaoBadge,
  ModalidadeBadge,
  TransacaoStatusBadge,
} from './components/status-badges'
import { AcoesLinhaMenu } from './components/AcoesLinhaMenu'
import { FalhasTable } from './components/FalhasTable'
import { NdeTable } from './components/NdeTable'
import { AlocarProcessosDialog } from './components/AlocarProcessosDialog'
import { ImportarExtratoDialog } from './components/ImportarExtratoDialog'

/** Formata uma data ISO (ou undefined) para pt-BR curta (UTC — dia estável). */
const fmtData = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'

/**
 * Filtro de status da tabela — `'pendentes'` (default), `'todas'`, ou um status do enum.
 *
 * `'pendentes'` = tudo que NÃO está `processada`. É o default porque a tela é uma fila de trabalho:
 * o que o analista abre para ver é o que falta fazer, não o histórico. Ver `'todas'` continua a um
 * clique (ADR-0033).
 *
 * Aplicado no SERVIDOR desde a ADR-0034. Filtrar no cliente rodava sobre a página já capada em 500
 * linhas: o histórico processado consumia a cota da fila de trabalho, e um crédito antigo com
 * problema ficava fora da tela justamente na aba feita para mostrá-lo.
 */
type StatusFiltro = PainelStatusFiltro

/**
 * Botões de status oferecidos na carteira.
 *
 * `conciliada` e `manual` ficaram DE FORA (ADR-0034): nenhum caminho de código os escreve até o
 * Módulo 2 (motor de matching), então o botão devolveria lista vazia sempre. Um filtro que nunca
 * casa ensina o analista a desconfiar de todos os outros.
 */
const STATUS_BOTOES: readonly StatusFiltro[] = [
  'pendentes',
  'todas',
  'importada',
  'parcial',
  'processada',
  'erro',
]

/**
 * Rota `/recebimentos` — liberada em produção desde a v0.20.0 (ADR-0028). Não há
 * mais tela de bloqueio: o único freio é o kill-switch do backend
 * (`RECEBIMENTOS_ENABLED=false` → `recebimentosGate` responde 403), que a UI
 * mostra como erro de carregamento em vez de esconder a frente inteira.
 */
export default function RecebimentosPage() {
  return <RecebimentosPanel />
}

/**
 * Larguras por coluna da carteira — data, contraparte, ref., conta, valor, status, modalidade,
 * match, correlationId, ações. Aproximam o conteúdo real para a página não pular lateralmente
 * quando os dados entram no lugar do skeleton.
 */
const LARGURAS_CARTEIRA = [
  'w-16',
  'w-40',
  'w-20',
  'w-28',
  'w-20',
  'w-24',
  'w-28',
  'w-20',
  'w-32',
  'w-16',
]

/**
 * Tratamento de RECARGA: os dados continuam na tela, apagados e inertes.
 *
 * `patterns.md §8.1` proíbe overlay/backdrop sobre dados já visíveis, então nada de spinner gigante
 * — só opacidade e o bloqueio de clique, que evita o analista agir sobre uma linha que está prestes
 * a mudar. Quem sinaliza QUE algo acontece é o botão clicado, que fica com spinner próprio.
 */
const CLASSE_ATUALIZANDO = 'pointer-events-none opacity-60 transition-opacity'

/**
 * Skeleton da PRIMEIRA carga — mesma contagem de KPIs, mesmas 10 colunas e mesma altura de linha
 * da tela final (`docs/design-system/skeleton.md`: "skeleton reflete o shape final").
 *
 * Só aparece quando não há nada a preservar. Recarga com carteira na tela usa tratamento
 * não-destrutivo, nunca este skeleton — ver `atualizando` no painel.
 */
function PainelSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Carregando painel">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* 6 cards — os mesmos que a tela mostra depois (ADR-0034 tirou Conciliadas e Fila manual). */}
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-lg" aria-hidden />
      <div className="flex flex-wrap gap-1" aria-hidden>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <TableSkeleton
        columns={10}
        rows={10}
        larguras={LARGURAS_CARTEIRA}
        aria-label="Carregando a carteira de créditos"
      />
    </div>
  )
}

/**
 * O que disparou a busca em voo — o botão clicado precisa mostrar que é ELE que está trabalhando.
 *
 * Sem isso, um clique em "parcial" some com a tabela e não diz qual controle respondeu ao clique; o
 * analista clica de novo achando que não pegou.
 */
type AcaoEmVoo =
  | { tipo: 'recarregar' }
  | { tipo: 'status'; valor: StatusFiltro }
  | { tipo: 'arquivadas' }

function RecebimentosPanel() {
  const [painel, setPainel] = React.useState<RecebimentosPainel | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  /** Falha de RECARGA, com carteira já na tela — vira faixa, não estado de erro (ver `carregar`). */
  const [erroAtualizacao, setErroAtualizacao] = React.useState<string | null>(null)
  const [enriquecendo, setEnriquecendo] = React.useState(false)
  /** O enriquecimento falhou nesta carga — vira sinal discreto na coluna, nunca um toast. */
  const [enriquecimentoIndisponivel, setEnriquecimentoIndisponivel] = React.useState(false)
  const [acaoEmVoo, setAcaoEmVoo] = React.useState<AcaoEmVoo | null>(null)
  const [statusFiltro, setStatusFiltro] = React.useState<StatusFiltro>('pendentes')
  const [verArquivadas, setVerArquivadas] = React.useState(false)
  const [arquivando, setArquivando] = React.useState<string | null>(null)
  const [aba, setAba] = React.useState('transacoes')
  const [alocarTxn, setAlocarTxn] = React.useState<TransacaoBancaria | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)

  /**
   * Sequência da busca em voo. O analista troca de filtro mais rápido do que o backend responde, e
   * sem isto a resposta de um filtro antigo, chegando depois, pintaria a tela por cima do filtro
   * novo — numa carteira financeira, mostrar a lista errada sob o rótulo certo é o pior desfecho.
   */
  const requisicao = React.useRef(0)
  /** `true` depois da primeira carga bem-sucedida — decide erro-de-tela x faixa de erro. */
  const temPainel = React.useRef(false)

  /**
   * Segunda etapa da carga (ADR-0038): modalidade prevista + aba NDe hidratada, tudo que depende de
   * ler o ERP. Roda DEPOIS que a carteira já está na tela e SUBSTITUI o que recebe.
   *
   * Falha em silêncio de propósito: os dados que importam vieram do Postgres e já estão
   * renderizados. Um toast vermelho aqui alarmaria o analista sobre uma coluna auxiliar enquanto a
   * carteira, correta, está bem na frente dele.
   */
  const enriquecer = React.useCallback(
    async (id: number, opts: { arquivadas: boolean; status: StatusFiltro }) => {
      setEnriquecendo(true)
      setEnriquecimentoIndisponivel(false)
      try {
        const extra = await fetchPainelEnriquecimento(opts)
        if (id !== requisicao.current) return
        setPainel((prev) =>
          prev === null
            ? prev
            : {
                ...prev,
                transacoes: prev.transacoes.map((t) => {
                  const prevista = extra.modalidades[t.id]
                  return prevista === undefined ? t : { ...t, modalidade: prevista }
                }),
                ndes: extra.ndes,
                kpis: { ...prev.kpis, ndePendentes: extra.ndePendentes },
              },
        )
      } catch {
        // Sem toast: a carteira veio do Postgres e está correta na tela; alarmar sobre uma coluna
        // auxiliar assustaria o analista à toa. Mas TAMBÉM não pode passar por sucesso — falha
        // engolida aqui é indistinguível de "cliente sem palpite", e é neste caminho que mora a
        // reconciliação do SEFAZ. O estado vira um aviso discreto no cabeçalho da coluna.
        if (id === requisicao.current) setEnriquecimentoIndisponivel(true)
      } finally {
        if (id === requisicao.current) setEnriquecendo(false)
      }
    },
    [],
  )

  const carregar = React.useCallback(async () => {
    const id = ++requisicao.current
    const opts = { arquivadas: verArquivadas, status: statusFiltro }
    setCarregando(true)
    setErroAtualizacao(null)
    try {
      const novo = await fetchPainelRecebimentos(opts)
      if (id !== requisicao.current) return
      setPainel(novo)
      setError(null)
      temPainel.current = true
      void enriquecer(id, opts)
    } catch (e) {
      if (id !== requisicao.current) return
      const msg = e instanceof Error ? e.message : 'Falha ao carregar o painel.'
      // Primeira carga: não há o que preservar, a tela inteira vira o erro. Recarga: a carteira já
      // está na frente do analista, e apagá-la por uma falha de rede troca dado velho por nenhum.
      if (temPainel.current) setErroAtualizacao(msg)
      else setError(msg)
    } finally {
      if (id === requisicao.current) {
        setCarregando(false)
        setAcaoEmVoo(null)
      }
    }
  }, [verArquivadas, statusFiltro, enriquecer])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  /** Primeira carga = ainda não há nada a preservar; só ela mostra skeleton. */
  const primeiraCarga = carregando && painel === null
  /** Recarga com dados na tela: a tabela FICA, apagada e inerte (nunca volta a skeleton). */
  const atualizando = carregando && painel !== null

  /** Troca o filtro de status (server-side) marcando qual botão disparou a busca. */
  const aplicarStatus = (proximo: StatusFiltro) => {
    if (proximo === statusFiltro || carregando) return
    setAcaoEmVoo({ tipo: 'status', valor: proximo })
    setStatusFiltro(proximo)
  }

  const transacoes = painel?.transacoes ?? []

  /**
   * Total da JANELA, não da página — soma os KPIs, que o backend conta sobre tudo.
   *
   * Usar `transacoes.length` aqui faria o rótulo da aba encolher a cada filtro aplicado, dando a
   * impressão de que créditos sumiram da carteira quando só a lista foi filtrada.
   */
  const totalNaJanela = painel
    ? painel.kpis.importadas +
      painel.kpis.conciliadas +
      painel.kpis.parciais +
      painel.kpis.filaManual +
      painel.kpis.erro +
      painel.kpis.processadas
    : 0

  // Filial + busca + paginação — mesmo kit do painel de Permutas/SISPAG (consistência de UX).
  const abaTransacoes = useTabelaFiltro(
    transacoes,
    (t) => t.filCod,
    (t) => `${t.contraparte ?? ''} ${t.referenciaBancaria ?? ''} ${t.correlationId} ${t.tipo}`,
  )

  /**
   * Arquiva/desarquiva e RECARREGA o painel.
   *
   * Recarrega em vez de mexer na lista em memória de propósito: arquivar muda os KPIs (o crédito sai
   * do "a distribuir"), e atualizar a linha sem os totais deixaria a tela internamente inconsistente
   * — a pior forma de erro num painel financeiro.
   */
  const alternarArquivo = async (t: TransacaoBancaria, arquivar: boolean) => {
    setArquivando(t.id)
    try {
      await arquivarTransacao(t.id, arquivar)
      toast.success(arquivar ? 'Crédito arquivado' : 'Crédito desarquivado', {
        description: arquivar
          ? 'Saiu da carteira e dos totais. Veja em "Arquivadas".'
          : 'Voltou para a carteira e para os totais.',
      })
      await carregar()
    } catch (e) {
      toast.error('Não foi possível concluir', {
        description: e instanceof Error ? e.message : 'Tente de novo.',
      })
    } finally {
      setArquivando(null)
    }
  }

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success('correlationId copiado', { description: texto })
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  /** KPI click → aplica filtro de status e leva à aba correspondente (page-as-maestro). */
  const filtrarPorStatus = (status: StatusFiltro) => {
    // A aba de falhas tem fonte própria (busca sem o teto da carteira), então o KPI de erro leva
    // até ela em vez de filtrar a tabela principal.
    if (status === 'erro') {
      setAba('falhas')
      return
    }
    aplicarStatus(statusFiltro === status ? 'todas' : status)
    setAba('transacoes')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gestão de Adiantamentos"
        subtitle={
          painel?.ultimaIngestao
            ? `Conciliação de créditos bancários (Frente IV) · carteira de ${new Date(
                painel.ultimaIngestao,
              ).toLocaleString('pt-BR')}`
            : 'Conciliação de créditos bancários (Frente IV).'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" aria-hidden /> Importar extrato
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAcaoEmVoo({ tipo: 'recarregar' })
                void carregar()
              }}
              disabled={carregando}
              aria-busy={acaoEmVoo?.tipo === 'recarregar' || undefined}
            >
              {acaoEmVoo?.tipo === 'recarregar' ? (
                <Spinner className="size-4" />
              ) : (
                <RefreshCcw className="size-4" aria-hidden />
              )}
              Recarregar
            </Button>
          </div>
        }
      />

      {primeiraCarga ? (
        <PainelSkeleton />
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" aria-hidden />}
          title="Não foi possível carregar"
          description={error}
          action={
            <Button size="sm" variant="outline" onClick={() => void carregar()}>
              <RefreshCcw className="size-4" aria-hidden /> Tentar de novo
            </Button>
          }
        />
      ) : painel ? (
        <>
          {erroAtualizacao !== null ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
              <div className="flex-1">
                <span className="font-medium">Não foi possível atualizar.</span> {erroAtualizacao} A
                carteira abaixo é a da última carga bem-sucedida.
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setAcaoEmVoo({ tipo: 'recarregar' })
                  void carregar()
                }}
                disabled={carregando}
              >
                <RefreshCcw className="size-4" aria-hidden /> Tentar de novo
              </Button>
            </div>
          ) : null}

          {painel.truncado ? (
            <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/5 p-3 text-sm">
              <Landmark className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
              <div>
                <span className="font-medium">Lista parcial.</span> Há mais créditos na janela do que
                cabem nesta página — os mais recentes vêm primeiro. Os KPIs acima contam a janela
                inteira, não só o que está listado.
              </div>
            </div>
          ) : null}

          <div className={atualizando ? CLASSE_ATUALIZANDO : undefined} aria-busy={atualizando}>
          <KPIGrid columns={4}>
            <SimpleKPI
              label="Importadas"
              value={painel.kpis.importadas.toLocaleString('pt-BR')}
              color="info"
              active={statusFiltro === 'importada'}
              onClick={() => filtrarPorStatus('importada')}
              tooltip="Transações importadas, ainda não conciliadas."
              footer="a conciliar"
            />
            {/*
              "Conciliadas" e "Fila manual" saíram da tela na ADR-0034: dependem do motor de
              matching (Módulo 2), que não existe, então os cards eram permanentemente zero — e um
              KPI sempre-zero ensina o analista que os números da tela são decorativos. Os campos
              continuam na API e no enum, prontos para quando o Módulo 2 chegar.
            */}
            <SimpleKPI
              label="Parciais"
              value={painel.kpis.parciais.toLocaleString('pt-BR')}
              color="warning"
              active={statusFiltro === 'parcial'}
              onClick={() => filtrarPorStatus('parcial')}
              tooltip="Parte do crédito já foi baixada no ERP — resta saldo a alocar."
              footer="com saldo"
            />
            <SimpleKPI
              label="Processadas"
              value={painel.kpis.processadas.toLocaleString('pt-BR')}
              color="success"
              active={statusFiltro === 'processada'}
              onClick={() => filtrarPorStatus('processada')}
              tooltip="Alocação executada até o fim. Fora da fila de trabalho por default."
              footer="concluídas"
            />
            <SimpleKPI
              label="Erro"
              value={painel.kpis.erro.toLocaleString('pt-BR')}
              color="danger"
              onClick={() => filtrarPorStatus('erro')}
              tooltip="A última execução falhou. Abre a aba Falhas."
              footer="ver falhas"
            />
            <SimpleKPI
              label="Valor não alocado"
              value={formatBRL(painel.kpis.valorNaoAlocado)}
              color="default"
              tooltip="Σ das diferenças não alocadas dos recebimentos."
              footer="a distribuir"
            />
            <SimpleKPI
              label="NDe pendentes"
              value={painel.kpis.ndePendentes.toLocaleString('pt-BR')}
              color="warning"
              onClick={() => setAba('nde')}
              tooltip="Notas de Débito Eletrônica ainda não emitidas."
              footer="a emitir"
            />
          </KPIGrid>
          </div>

          <Tabs value={aba} onValueChange={setAba}>
            <TabsList>
              <TabsTrigger value="transacoes">Transações ({totalNaJanela})</TabsTrigger>
              <TabsTrigger value="falhas">Falhas ({painel.kpis.erro})</TabsTrigger>
              <TabsTrigger value="conciliacoes">
                Conciliações ({painel.recebimentos.length})
              </TabsTrigger>
              <TabsTrigger value="nde">NDe ({painel.ndes.length})</TabsTrigger>
              <TabsTrigger value="ingestoes">Ingestões</TabsTrigger>
            </TabsList>

            {/* ---- Transações ---- */}
            <TabsContent value="transacoes" className="space-y-3">
              <FiltroBarra
                aba={abaTransacoes}
                buscaPlaceholder="Buscar por contraparte, referência ou correlationId…"
              />
              <div className="flex flex-wrap items-center gap-1">
                {STATUS_BOTOES.map((s) => {
                  const disparou = acaoEmVoo?.tipo === 'status' && acaoEmVoo.valor === s
                  return (
                    <Button
                      key={s}
                      size="sm"
                      variant={statusFiltro === s ? 'default' : 'outline'}
                      disabled={carregando}
                      aria-busy={disparou || undefined}
                      onClick={() => aplicarStatus(s)}
                    >
                      {disparou ? <Spinner className="size-4" /> : null}
                      {s === 'todas' ? 'Todas' : s === 'pendentes' ? 'A processar' : s}
                    </Button>
                  )
                })}
                <Button
                  size="sm"
                  variant={verArquivadas ? 'default' : 'outline'}
                  onClick={() => {
                    setAcaoEmVoo({ tipo: 'arquivadas' })
                    setVerArquivadas((v) => !v)
                  }}
                  disabled={carregando}
                  aria-busy={acaoEmVoo?.tipo === 'arquivadas' || undefined}
                  aria-pressed={verArquivadas}
                >
                  {acaoEmVoo?.tipo === 'arquivadas' ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Archive className="size-4" aria-hidden />
                  )}
                  {verArquivadas ? 'Vendo arquivadas' : 'Arquivadas'}
                </Button>
              </div>

              <div
                className={atualizando ? CLASSE_ATUALIZANDO : undefined}
                aria-busy={atualizando}
              >
              {abaTransacoes.total === 0 ? (
                <EmptyState
                  icon={<Banknote className="size-6" aria-hidden />}
                  title={
                    transacoes.length === 0 ? 'Nenhuma transação' : 'Nenhuma transação encontrada'
                  }
                  description={
                    transacoes.length === 0
                      ? 'As transações bancárias aparecem aqui após a ingestão do Nexxera.'
                      : 'Ajuste o status, a filial ou a busca acima.'
                  }
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Contraparte</TableHead>
                        <TableHead>Ref. banc.</TableHead>
                        {/* A antiga coluna "Tipo" era constante: o painel só devolve
                            CRÉDITO, então ela nunca dizia nada. A conta é o que o
                            analista precisa para bater a linha contra um extrato. */}
                        <TableHead>Conta</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>
                          <span className="inline-flex items-center gap-1.5">
                            Modalidade
                            {/* A previsão vem numa segunda chamada (ADR-0038). O spinner aponta a
                                coluna que ainda vai preencher, em vez de deixar "—" parecendo
                                resposta final. */}
                            {enriquecendo ? (
                              <Spinner className="size-3" aria-label="Carregando modalidade" />
                            ) : enriquecimentoIndisponivel ? (
                              <span
                                className="text-xs font-normal text-muted-foreground"
                                title="Não foi possível ler a previsão de modalidade no ERP nesta carga. A carteira e os valores não dependem dela; recarregue para tentar de novo."
                              >
                                (indisponível)
                              </span>
                            ) : null}
                          </span>
                        </TableHead>
                        <TableHead>Match</TableHead>
                        <TableHead>correlationId</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {abaTransacoes.slice.map((t: TransacaoBancaria) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtData(t.dataMovimento)}
                          </TableCell>
                          <TableCell className="max-w-[16rem] truncate font-medium">
                            {t.contraparte ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {t.referenciaBancaria ?? '—'}
                          </TableCell>
                          <TableCell className="max-w-[14rem] truncate text-xs text-muted-foreground">
                            {t.contaDescricao ?? (t.gerNum != null ? `Conta ${t.gerNum}` : '—')}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatBRL(t.valor)}
                          </TableCell>
                          <TableCell>
                            <TransacaoStatusBadge status={t.status} />
                          </TableCell>
                          <TableCell>
                            <ModalidadeBadge modalidade={t.modalidade} />
                          </TableCell>
                          <TableCell>
                            <MatchClassificacaoBadge classificacao={t.classificacaoMatch} />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              <span className="font-mono text-xs text-muted-foreground">
                                {t.correlationId}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => void copiar(t.correlationId)}
                                aria-label={`Copiar correlationId ${t.correlationId}`}
                                title="Copiar correlationId"
                              >
                                <Copy className="size-3" aria-hidden />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {/* Crédito já processado não se aloca de novo — o botão sai, o menu fica. */}
                              {t.status !== 'processada' && !t.arquivadaEm ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setAlocarTxn(t)}
                                  aria-label={`Alocar processos para a transação ${t.contraparte ?? t.id}`}
                                >
                                  <Coins className="size-4" aria-hidden /> Alocar
                                </Button>
                              ) : null}
                              <AcoesLinhaMenu
                                rotuloLinha={`a transação de ${t.contraparte ?? t.id}`}
                                arquivada={Boolean(t.arquivadaEm)}
                                emAndamento={arquivando === t.id}
                                onArquivar={() => void alternarArquivo(t, true)}
                                onDesarquivar={() => void alternarArquivo(t, false)}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              </div>
              <Paginacao aba={abaTransacoes} />
            </TabsContent>

            {/* ---- Conciliações (placeholder Fase 3) ---- */}
            <TabsContent value="conciliacoes" className="space-y-3">
              <EmptyState
                icon={<ListChecks className="size-6" aria-hidden />}
                title="Conciliações em breve"
                description="A visão do ciclo de vida dos recebimentos (rascunho → aprovado → executado) chega na Fase 3."
              />
            </TabsContent>

            {/* ---- Falhas (ADR-0034) ---- */}
            <TabsContent value="falhas" className="space-y-3">
              {/* Monta só quando a aba abre: a busca é própria (sem o teto da carteira) e o painel
                  normal não deve pagá-la enquanto ninguém olha. */}
              {aba === 'falhas' ? <FalhasTable onAlocar={setAlocarTxn} /> : null}
            </TabsContent>

            {/* ---- NDe ---- */}
            <TabsContent value="nde" className="space-y-3">
              <NdeTable ndes={painel.ndes} />
            </TabsContent>

            {/* ---- Ingestões (placeholder) ---- */}
            <TabsContent value="ingestoes" className="space-y-3">
              <EmptyState
                icon={<RefreshCcw className="size-6" aria-hidden />}
                title="Histórico de ingestões em breve"
                description="A trilha das rodadas de ingestão (cron/manual) chega junto do Módulo 1."
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}

      <AlocarProcessosDialog
        transacao={alocarTxn}
        open={alocarTxn !== null}
        onOpenChange={(o) => {
          if (!o) setAlocarTxn(null)
        }}
        onProcessado={() => void carregar()}
      />

      <ImportarExtratoDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void carregar()}
      />
    </div>
  )
}

'use client'

import * as React from 'react'
import {
  AlertTriangle,
  Banknote,
  Copy,
  Coins,
  Landmark,
  ListChecks,
  Lock,
  RefreshCcw,
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
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { isRecebimentosEnabled } from '@/lib/features'
import { formatBRL } from '@/lib/utils'
import {
  fetchPainelRecebimentos,
  type RecebimentosPainel,
  type TransacaoBancaria,
  type TransacaoBancariaStatus,
} from '@/lib/recebimentos'
import { FiltroBarra, Paginacao, useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'
import {
  MatchClassificacaoBadge,
  TransacaoStatusBadge,
} from './components/status-badges'
import { NdeTable } from './components/NdeTable'
import { AlocarProcessosDialog } from './components/AlocarProcessosDialog'

/** Formata uma data ISO (ou undefined) para pt-BR curta (UTC — dia estável). */
const fmtData = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'

/** Filtro de status da tabela de transações — 'todas' + os status do enum. */
type StatusFiltro = 'todas' | TransacaoBancariaStatus

/**
 * Guard de acesso (bloqueio via URL): quando a Frente IV está desligada (produção,
 * por padrão), a rota `/recebimentos` mostra a tela de bloqueio em vez do painel. A
 * API também nega (`recebimentosGate` → 403), então esconder aqui é UX, não a barreira.
 */
export default function RecebimentosPage() {
  if (!isRecebimentosEnabled()) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Recebimentos"
          subtitle="Conciliação de créditos bancários (Frente IV)."
        />
        <EmptyState
          icon={<Lock className="size-8" aria-hidden />}
          title="Recebimentos indisponível"
          description="Esta frente ainda não está liberada em produção. Fale com o time se precisar de acesso."
        />
      </div>
    )
  }
  return <RecebimentosPanel />
}

function PainelSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando painel">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function RecebimentosPanel() {
  const [painel, setPainel] = React.useState<RecebimentosPainel | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [statusFiltro, setStatusFiltro] = React.useState<StatusFiltro>('todas')
  const [aba, setAba] = React.useState('transacoes')
  const [alocarTxn, setAlocarTxn] = React.useState<TransacaoBancaria | null>(null)

  const carregar = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPainel(await fetchPainelRecebimentos())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar o painel.')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const transacoes = painel?.transacoes ?? []
  const transacoesFiltradas = React.useMemo(
    () => (statusFiltro === 'todas' ? transacoes : transacoes.filter((t) => t.status === statusFiltro)),
    [transacoes, statusFiltro],
  )

  // Filial + busca + paginação — mesmo kit do painel de Permutas/SISPAG (consistência de UX).
  const abaTransacoes = useTabelaFiltro(
    transacoesFiltradas,
    (t) => t.filCod,
    (t) => `${t.contraparte ?? ''} ${t.referenciaBancaria ?? ''} ${t.correlationId} ${t.tipo}`,
  )

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
    setStatusFiltro((prev) => (prev === status ? 'todas' : status))
    setAba(status === 'manual' ? 'fila-manual' : 'transacoes')
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recebimentos"
        subtitle={
          painel?.ultimaIngestao
            ? `Conciliação de créditos bancários (Frente IV) · carteira de ${new Date(
                painel.ultimaIngestao,
              ).toLocaleString('pt-BR')}`
            : 'Conciliação de créditos bancários (Frente IV).'
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void carregar()}
            disabled={loading}
          >
            <RefreshCcw className="size-4" aria-hidden /> Recarregar
          </Button>
        }
      />

      {loading ? (
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
            <SimpleKPI
              label="Conciliadas"
              value={painel.kpis.conciliadas.toLocaleString('pt-BR')}
              color="success"
              active={statusFiltro === 'conciliada'}
              onClick={() => filtrarPorStatus('conciliada')}
              tooltip="Casadas com confiança."
              footer="casadas 1:1"
            />
            <SimpleKPI
              label="Parciais"
              value={painel.kpis.parciais.toLocaleString('pt-BR')}
              color="warning"
              active={statusFiltro === 'parcial'}
              onClick={() => filtrarPorStatus('parcial')}
              tooltip="Casamento parcial — resta saldo."
              footer="com saldo"
            />
            <SimpleKPI
              label="Fila manual"
              value={painel.kpis.filaManual.toLocaleString('pt-BR')}
              color="permuta"
              active={statusFiltro === 'manual'}
              onClick={() => filtrarPorStatus('manual')}
              tooltip="Match incerto — nunca auto-baixa. Aguarda o analista."
              footer="⚠ aguardando análise"
            />
            <SimpleKPI
              label="Erro"
              value={painel.kpis.erro.toLocaleString('pt-BR')}
              color="danger"
              active={statusFiltro === 'erro'}
              onClick={() => filtrarPorStatus('erro')}
              tooltip="Falha reprocessável."
              footer="reprocessável"
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

          <Tabs value={aba} onValueChange={setAba}>
            <TabsList>
              <TabsTrigger value="transacoes">Transações ({transacoes.length})</TabsTrigger>
              <TabsTrigger value="conciliacoes">
                Conciliações ({painel.recebimentos.length})
              </TabsTrigger>
              <TabsTrigger value="fila-manual">Fila manual ({painel.kpis.filaManual})</TabsTrigger>
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
                {(['todas', 'importada', 'conciliada', 'parcial', 'manual', 'erro'] as const).map(
                  (s) => (
                    <Button
                      key={s}
                      size="sm"
                      variant={statusFiltro === s ? 'default' : 'outline'}
                      onClick={() => setStatusFiltro(s)}
                    >
                      {s === 'todas' ? 'Todas' : s}
                    </Button>
                  ),
                )}
              </div>

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
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Status</TableHead>
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
                          <TableCell className="text-muted-foreground">{t.tipo}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatBRL(t.valor)}
                          </TableCell>
                          <TableCell>
                            <TransacaoStatusBadge status={t.status} />
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
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAlocarTxn(t)}
                              aria-label={`Alocar processos para a transação ${t.contraparte ?? t.id}`}
                            >
                              <Coins className="size-4" aria-hidden /> Alocar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
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

            {/* ---- Fila manual (placeholder Fase 2) ---- */}
            <TabsContent value="fila-manual" className="space-y-3">
              <EmptyState
                icon={<UserSearch className="size-6" aria-hidden />}
                title="Fila manual em breve"
                description="A fila de exceções (matches incertos que nunca auto-baixam) chega na Fase 2."
              />
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
      />
    </div>
  )
}

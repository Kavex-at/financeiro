'use client'

import * as React from 'react'
import { AlertTriangle, Activity, BellOff, RefreshCcw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/ui/page-header'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { isSessionExpiredError } from '@/lib/http'
import {
  type FontePainel,
  type OperacaoPainel,
  fetchOperacao,
  formatarDuracao,
  formatarIdade,
  reconhecerAlerta,
} from '@/lib/operacao'
import {
  EstadoConfigBadge,
  RunStatusBadge,
  SeveridadeBadge,
  SituacaoBadge,
} from './components/status-badges'

const fmtHora = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/**
 * `/operacao` — Painel de Operação (ADR-0042).
 *
 * A tela que se abre **durante** um incidente. Duas consequências de desenho:
 *
 * 1. **Não depende do ERP** (I4). Se dependesse, falharia junto com aquilo que costuma ser a causa
 *    do incidente.
 * 2. **Ausência de sinal nunca é pintada como saúde.** `nunca-executou` e `sem-trilha` têm chip
 *    próprio; o reaper aparece listado como cego em vez de omitido. Uma tela de operação que
 *    esconde o que não sabe é pior do que não ter tela.
 */
export default function OperacaoPage() {
  const [painel, setPainel] = React.useState<OperacaoPainel | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<string | null>(null)
  const [reconhecendo, setReconhecendo] = React.useState<number | null>(null)
  const [aba, setAba] = React.useState('pipelines')

  const carregar = React.useCallback(async () => {
    setCarregando(true)
    try {
      setPainel(await fetchOperacao())
      setErro(null)
    } catch (e) {
      if (isSessionExpiredError(e)) return
      // Sem fixture de segurança: uma tela de operação que finge saúde quando a API não
      // responde é pior do que uma tela quebrada.
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o painel de operação.')
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const reconhecer = async (id: number) => {
    setReconhecendo(id)
    try {
      await reconhecerAlerta(id)
      toast.success('Alerta reconhecido')
      await carregar()
    } catch (e) {
      if (isSessionExpiredError(e)) return
      toast.error('Não foi possível reconhecer', {
        description: e instanceof Error ? e.message : 'Tente de novo.',
      })
    } finally {
      setReconhecendo(null)
    }
  }

  // Fonte que falhou volta vazia do backend: o número dela é DESCONHECIDO, não zero.
  const erros = painel?.erros ?? []
  const falhaDe = (fonte: FontePainel) => erros.find((e) => e.fonte === fonte)
  const falhaPipelines = falhaDe('pipelines')
  const falhaAlertas = falhaDe('alertas')
  const falhaConfig = falhaDe('configuracao')
  const pipelines = painel?.pipelines ?? []
  const parados = pipelines.filter((p) => p.situacao === 'parado').length
  const cegos = pipelines.filter(
    (p) => p.situacao === 'sem-trilha' || p.situacao === 'nunca-executou',
  ).length
  const configAusente =
    (painel?.configuracao.totalAusentesObrigatorias ?? 0) +
    (painel?.configuracao.totalAusentesSilenciosas ?? 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operação"
        subtitle="Saúde dos pipelines, alertas abertos e diagnóstico de configuração. Não depende do ERP."
        actions={
          <div className="flex items-center gap-2">
            {painel?.geradoEm ? (
              <span className="mr-1 whitespace-nowrap text-xs text-muted-foreground">
                lido em {fmtHora(painel.geradoEm)}
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando}>
              {carregando ? <Spinner className="size-4" /> : <RefreshCcw className="size-4" aria-hidden />}
              Recarregar
            </Button>
          </div>
        }
      />

      {carregando && painel === null ? (
        <PainelSkeleton />
      ) : erro !== null ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" aria-hidden />}
          title="Não foi possível carregar"
          description={erro}
          action={
            <Button size="sm" variant="outline" onClick={() => void carregar()}>
              <RefreshCcw className="size-4" aria-hidden /> Tentar de novo
            </Button>
          }
        />
      ) : painel ? (
        <>
          {erros.length > 0 ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle/40 p-3 text-sm text-warning-foreground"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">
                  Parte do painel não pôde ser lida — os números dessas partes não significam zero.
                </p>
                <ul className="list-disc pl-4">
                  {erros.map((e) => (
                    <li key={e.fonte}>{e.mensagem}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <KPIGrid columns={4}>
            <SimpleKPI
              label="Pipelines parados"
              value={falhaPipelines ? '—' : parados}
              color={falhaPipelines ? 'default' : parados > 0 ? 'danger' : 'success'}
              footer={falhaPipelines ? 'não foi possível ler' : 'sem sucesso dentro do limite'}
              tooltip="Pipelines cuja última execução bem-sucedida é mais antiga que o limite da cadência."
            />
            <SimpleKPI
              label="Alertas abertos"
              value={falhaAlertas ? '—' : painel.alertas.length}
              color={painel.alertas.length > 0 ? 'warning' : 'default'}
              footer={falhaAlertas ? 'não foi possível ler' : 'ainda não reconhecidos'}
            />
            <SimpleKPI
              label="Config a resolver"
              value={falhaConfig ? '—' : configAusente}
              color={
                falhaConfig
                  ? 'default'
                  : painel.configuracao.totalAusentesObrigatorias > 0
                    ? 'danger'
                    : configAusente > 0
                      ? 'warning'
                      : 'success'
              }
              footer={falhaConfig ? 'não foi possível ler' : 'obrigatórias + silenciosas'}
              tooltip="Vars ausentes que impedem o funcionamento ou degradam uma regra sem avisar."
            />
            <SimpleKPI
              label="Sem visibilidade"
              value={falhaPipelines ? '—' : cegos}
              color={cegos > 0 ? 'warning' : 'default'}
              footer={falhaPipelines ? 'não foi possível ler' : 'sem trilha ou nunca executou'}
              tooltip="Jobs que o painel NÃO consegue vigiar. Listados de propósito — omiti-los afirmaria cobertura que não existe."
            />
          </KPIGrid>

          <Tabs value={aba} onValueChange={setAba}>
            <TabsList>
              <TabsTrigger value="pipelines">
                <Activity className="size-4" aria-hidden /> Pipelines ({falhaPipelines ? '—' : pipelines.length})
              </TabsTrigger>
              <TabsTrigger value="alertas">
                <AlertTriangle className="size-4" aria-hidden /> Alertas ({falhaAlertas ? '—' : painel.alertas.length})
              </TabsTrigger>
              <TabsTrigger value="config">
                <Settings2 className="size-4" aria-hidden /> Configuração
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pipelines" className="space-y-3">
              {falhaPipelines ? (
                <FonteIndisponivel mensagem={falhaPipelines.mensagem} onRetry={carregar} />
              ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table aria-label="Saúde dos pipelines">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pipeline</TableHead>
                      <TableHead>Cadência</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Último sucesso</TableHead>
                      <TableHead>Última run</TableHead>
                      <TableHead>Duração</TableHead>
                      <TableHead>Métricas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pipelines.map((p) => (
                      <TableRow key={p.pipeline}>
                        <TableCell className="font-medium">
                          {p.rotulo}
                          {!p.distinguePartial && p.situacao !== 'sem-trilha' ? (
                            <span
                              className="ml-2 text-xs font-normal text-muted-foreground"
                              title="Esta fonte não distingue execução parcial: uma run com filial falhada é indistinguível de uma run limpa. Cegueira herdada, não sinal de saúde."
                            >
                              (não distingue parcial)
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{p.cadencia}</TableCell>
                        <TableCell>
                          <SituacaoBadge situacao={p.situacao} />
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.situacao === 'sem-trilha' ? (
                            <span className="text-muted-foreground">não registra execução</span>
                          ) : (
                            <>
                              {formatarIdade(p.idadeDesdeUltimoSucessoMs)}
                              {p.limiteStalenessMs !== undefined ? (
                                <span className="ml-1 text-muted-foreground">
                                  (limite {formatarIdade(p.limiteStalenessMs).replace('há ', '')})
                                </span>
                              ) : null}
                            </>
                          )}
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={p.ultimaRun?.status} />
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-muted-foreground">
                          {formatarDuracao(p.ultimaRun?.duracaoMs)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {p.ultimaRun
                            ? Object.entries(p.ultimaRun.metricas)
                                .map(([k, v]) => `${k}: ${v}`)
                                .join(' · ') || '—'
                            : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              )}
            </TabsContent>

            <TabsContent value="alertas" className="space-y-3">
              {falhaAlertas ? (
                <FonteIndisponivel mensagem={falhaAlertas.mensagem} onRetry={carregar} />
              ) : painel.alertas.length === 0 ? (
                <EmptyState
                  icon={<BellOff className="size-6" aria-hidden />}
                  title="Nenhum alerta aberto"
                  description="Alertas aparecem aqui quando um pipeline falha, fica parado ou uma configuração obrigatória some."
                />
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <Table aria-label="Alertas abertos">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Quando</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Alvo</TableHead>
                        <TableHead>Severidade</TableHead>
                        <TableHead>Detalhe</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {painel.alertas.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="text-xs text-muted-foreground">
                            {fmtHora(a.criadoEm)}
                          </TableCell>
                          <TableCell className="font-medium">{a.tipo}</TableCell>
                          <TableCell className="font-mono text-xs">{a.alvo}</TableCell>
                          <TableCell>
                            <SeveridadeBadge severidade={a.severidade} />
                          </TableCell>
                          <TableCell className="max-w-[28rem] text-xs text-muted-foreground">
                            {typeof a.detalhe.consequencia === 'string'
                              ? a.detalhe.consequencia
                              : typeof a.detalhe.erro === 'string'
                                ? a.detalhe.erro
                                : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={reconhecendo === a.id}
                              onClick={() => void reconhecer(a.id)}
                            >
                              {reconhecendo === a.id ? <Spinner className="size-4" /> : null}
                              Reconhecer
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="config" className="space-y-3">
              {falhaConfig ? (
                <FonteIndisponivel mensagem={falhaConfig.mensagem} onRetry={carregar} />
              ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Diagnóstico de configuração</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Só a classificação — nenhum valor é lido ou exibido, nem para vars que não são
                    segredo.
                  </p>
                  {painel.configuracao.modoAutenticacao ? (
                    <p className="mb-3 text-sm" data-testid="modo-autenticacao">
                      Autenticação:{' '}
                      <strong>
                        {painel.configuracao.modoAutenticacao === 'supabase'
                          ? 'Supabase Auth'
                          : 'login próprio (local)'}
                      </strong>{' '}
                      <span className="text-muted-foreground">(AUTH_PROVIDER)</span>
                    </p>
                  ) : null}
                  <div className="overflow-x-auto rounded-lg border">
                    <Table aria-label="Diagnóstico de configuração">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Variável</TableHead>
                          <TableHead>Frente</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Criticidade</TableHead>
                          <TableHead>Se faltar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {painel.configuracao.vars.map((v) => (
                          <TableRow key={v.nome}>
                            <TableCell className="font-mono text-xs">
                              {v.nome}
                              {v.segredo ? (
                                <span className="ml-2 text-muted-foreground" title="Segredo: o valor nunca é lido nem exibido.">
                                  🔒
                                </span>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{v.frente}</TableCell>
                            <TableCell>
                              <EstadoConfigBadge estado={v.estado} />
                            </TableCell>
                            <TableCell className="text-xs">
                              {v.criticidade === 'degrada-silenciosamente' ? (
                                <span className="text-warning-foreground">degrada em silêncio</span>
                              ) : (
                                <span className="text-muted-foreground">{v.criticidade}</span>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[32rem] text-xs text-muted-foreground">
                              {v.consequenciaSeAusente}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              )}
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  )
}

/** A fonte desta aba falhou: diz isso em vez de "Nenhum alerta aberto" ou uma tabela vazia. */
function FonteIndisponivel({ mensagem, onRetry }: { mensagem: string; onRetry: () => Promise<void> }) {
  return (
    <EmptyState
      icon={<AlertTriangle className="size-6" aria-hidden />}
      title="Não foi possível ler esta parte do painel"
      description={mensagem}
      action={
        <Button size="sm" variant="outline" onClick={() => void onRetry()}>
          <RefreshCcw className="size-4" aria-hidden /> Tentar de novo
        </Button>
      }
    />
  )
}

function PainelSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Carregando o painel de operação">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-md" aria-hidden />
      <TableSkeleton columns={7} rows={4} aria-label="Carregando os pipelines" />
    </div>
  )
}

'use client'

import * as React from 'react'
import { AlertTriangle, BarChart3, RefreshCcw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
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
  METRICA,
  type MetricasCicloLeitura,
  absolutoDoRotulo,
  agruparPorSemana,
  fetchMetricasCiclo,
  formatarDiaLocal,
  formatarMetrica,
  formatarMomentoLocal,
} from '@/lib/metricas'

/**
 * `/metricas` — quanto trabalho o sistema fez pela operação, por semana (ADR-0045).
 *
 * Mesma fonte do report semanal da Columbia (`GET /metricas/ciclo`), então tela e report não
 * divergem. Duas regras de desenho:
 *
 * 1. **Número parcial nunca parece fechado.** A semana em curso aparece, mas sempre com "parcial até
 *    <dia, hora>". Os KPIs mostram a última semana FECHADA; só enquanto nenhuma fechou mostram a em
 *    curso, e o título diz isso.
 * 2. **O percentual nunca aparece sozinho.** O absoluto ("12 de 13 tentativas") vem junto: "100%"
 *    de uma tentativa conta outra história que "100%" de cinquenta.
 */
export default function MetricasPage() {
  const [leitura, setLeitura] = React.useState<MetricasCicloLeitura | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<string | null>(null)

  const carregar = React.useCallback(async () => {
    setCarregando(true)
    try {
      setLeitura(await fetchMetricasCiclo())
      setErro(null)
    } catch (e) {
      if (isSessionExpiredError(e)) return
      setErro(e instanceof Error ? e.message : 'Falha ao carregar as métricas.')
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const semanas = React.useMemo(() => agruparPorSemana(leitura?.metricas ?? []), [leitura])
  // KPIs: a última semana fechada; enquanto nenhuma fechou, a em curso (marcada no título).
  const ultima = semanas.find((s) => !s.parcial) ?? semanas[0]
  const serieInicio = leitura ? formatarDiaLocal(leitura.serieInicio, true) : '—'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Métricas"
        subtitle="Quanto trabalho o sistema fez pela operação, por semana (sexta 20:00 a sexta 20:00). Valores gravados no momento de cada operação."
        actions={
          <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={carregando}>
            {carregando ? <Spinner className="size-4" /> : <RefreshCcw className="size-4" aria-hidden />}
            Recarregar
          </Button>
        }
      />

      {carregando && leitura === null ? (
        <MetricasSkeleton />
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
      ) : leitura && ultima === undefined ? (
        <EmptyState
          icon={<BarChart3 className="size-6" aria-hidden />}
          title="Nenhuma semana iniciada ainda"
          description={`A série começa em ${serieInicio}, sexta às 20:00.`}
        />
      ) : leitura && ultima ? (
        <>
          <section aria-labelledby="ultima-semana" className="space-y-3">
            <h2 id="ultima-semana" className="text-2xl font-semibold leading-tight">
              {ultima.parcial ? 'Semana em andamento' : 'Semana'} de {formatarDiaLocal(ultima.janelaInicio)} a{' '}
              {formatarDiaLocal(ultima.janelaFim, true)}
            </h2>
            {ultima.parcial ? (
              <p className="text-xs text-muted-foreground">
                Parcial até {formatarMomentoLocal(ultima.apuradoAte)}. Os números mudam até a semana fechar, na
                sexta às 20:00.
              </p>
            ) : null}
            <KPIGrid columns={4}>
              <SimpleKPI
                label="Permutas concluídas"
                value={formatarMetrica(ultima.porChave[METRICA.PERMUTAS_PCT])}
                footer={
                  absolutoDoRotulo(ultima.porChave[METRICA.PERMUTAS_PCT]?.rotulo ?? '') ??
                  'sem tentativas na semana'
                }
                tooltip="Baixas cujo borderô está finalizado no ERP, sobre todas as tentativas da semana."
              />
              <SimpleKPI
                label="Valor baixado em permutas"
                value={formatarMetrica(ultima.porChave[METRICA.PERMUTAS_RS])}
                footer="borderôs finalizados"
              />
              <SimpleKPI
                label="Adiantamentos concluídos"
                value={formatarMetrica(ultima.porChave[METRICA.RECEBIMENTOS_PCT])}
                footer={
                  absolutoDoRotulo(ultima.porChave[METRICA.RECEBIMENTOS_PCT]?.rotulo ?? '') ??
                  'sem tentativas na semana'
                }
                tooltip="Créditos de cliente alocados até a NDe sem erro, sobre todas as tentativas da semana."
              />
              <SimpleKPI
                label="Valor alocado em adiantamentos"
                value={formatarMetrica(ultima.porChave[METRICA.RECEBIMENTOS_RS])}
                footer="créditos de cliente"
              />
            </KPIGrid>
          </section>

          <section aria-labelledby="historico" className="space-y-3">
            <h2 id="historico" className="text-2xl font-semibold leading-tight">
              Histórico
            </h2>
            <div className="overflow-x-auto rounded-lg border">
              <Table aria-label="Métricas por semana">
                <TableHeader>
                  <TableRow>
                    <TableHead>Semana</TableHead>
                    <TableHead className="text-right">Permutas concluídas</TableHead>
                    <TableHead className="text-right">Valor baixado</TableHead>
                    <TableHead className="text-right">Adiantamentos concluídos</TableHead>
                    <TableHead className="text-right">Valor alocado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {semanas.map((s) => (
                    <TableRow key={s.janelaInicio}>
                      <TableCell className="whitespace-nowrap font-medium">
                        {formatarDiaLocal(s.janelaInicio)} a {formatarDiaLocal(s.janelaFim, true)}
                        {s.parcial ? (
                          <span className="block text-xs font-normal text-muted-foreground">
                            em andamento · parcial até {formatarMomentoLocal(s.apuradoAte)}
                          </span>
                        ) : null}
                      </TableCell>
                      <CelulaPercentual metrica={s.porChave[METRICA.PERMUTAS_PCT]} />
                      <TableCell className="text-right tabular-nums">
                        {formatarMetrica(s.porChave[METRICA.PERMUTAS_RS])}
                      </TableCell>
                      <CelulaPercentual metrica={s.porChave[METRICA.RECEBIMENTOS_PCT]} />
                      <TableCell className="text-right tabular-nums">
                        {formatarMetrica(s.porChave[METRICA.RECEBIMENTOS_RS])}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">
              Série iniciada em {serieInicio}. Sem comparação com o processo manual: ele não foi medido.
            </p>
          </section>
        </>
      ) : null}
    </div>
  )
}

function CelulaPercentual({ metrica }: { metrica: Parameters<typeof formatarMetrica>[0] }) {
  const absoluto = metrica ? absolutoDoRotulo(metrica.rotulo) : undefined
  return (
    <TableCell className="text-right tabular-nums">
      {formatarMetrica(metrica)}
      {absoluto ? <span className="block text-xs text-muted-foreground">{absoluto}</span> : null}
    </TableCell>
  )
}

function MetricasSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Carregando as métricas">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <TableSkeleton columns={5} rows={4} aria-label="Carregando o histórico" />
    </div>
  )
}

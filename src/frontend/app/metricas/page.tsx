'use client'

import * as React from 'react'
import { AlertTriangle, BarChart3, RefreshCcw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { KPICard } from '@/components/ui/kpi-card'
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
import { ExigePermissao } from '@/components/auth/ExigePermissao'
import { PERMISSAO } from '@/lib/permissoes'

/** Guard de página (ADR-0053): sem `metricas:ver`, só o estado "sem acesso"; os dados nem são buscados. */
export default function MetricasPage() {
  return (
    <ExigePermissao permissao={PERMISSAO.METRICAS_VER}>
      <MetricasPageConteudo />
    </ExigePermissao>
  )
}

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
function MetricasPageConteudo() {
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
        subtitle="Quanto trabalho o sistema fez pela operação, por semana (sexta 18:00 a sexta 18:00). Valores gravados no momento de cada operação."
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
          description={`A série começa em ${serieInicio}, sexta às 18:00.`}
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
                sexta às 18:00.
              </p>
            ) : null}
            {/* Uma coluna por frente: o valor em R$ em destaque e a taxa de conclusão logo abaixo. */}
            <div data-slot="kpi-grid" className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FrenteKPI
                frente="Permutas"
                color="permuta"
                rotuloValor="Valor baixado"
                valor={ultima.porChave[METRICA.PERMUTAS_RS]}
                notaValor="borderôs finalizados"
                rotuloTaxa="Baixas concluídas"
                taxa={ultima.porChave[METRICA.PERMUTAS_PCT]}
                semTaxa="sem tentativas na semana"
                tooltip="Baixas cujo borderô está finalizado no ERP, sobre todas as tentativas da semana."
              />
              <FrenteKPI
                frente="Adiantamentos"
                color="info"
                rotuloValor="Valor alocado"
                valor={ultima.porChave[METRICA.RECEBIMENTOS_RS]}
                notaValor="créditos de cliente"
                rotuloTaxa="Alocações concluídas"
                taxa={ultima.porChave[METRICA.RECEBIMENTOS_PCT]}
                semTaxa="sem tentativas na semana"
                tooltip="Créditos de cliente alocados até a NDe sem erro, sobre todas as tentativas da semana."
              />
              <FrenteKPI
                frente="Pagamentos (SISPAG)"
                color="primary"
                rotuloValor="Valor aceito"
                valor={ultima.porChave[METRICA.SISPAG_RS]}
                notaValor="títulos agendados ou pagos"
                rotuloTaxa="Aceitos pelo banco"
                taxa={ultima.porChave[METRICA.SISPAG_PCT]}
                semTaxa="sem remessa na semana"
                tooltip="Títulos de remessa SISPAG gerada na semana que o banco agendou ou pagou, sobre todos os títulos enviados. Aceite que chega depois atualiza a semana da remessa."
              />
            </div>
          </section>

          <section aria-labelledby="historico" className="space-y-3">
            <h2 id="historico" className="text-2xl font-semibold leading-tight">
              Histórico
            </h2>
            <div
              className="overflow-x-auto rounded-lg border"
              role="region"
              aria-label="Histórico de métricas"
              tabIndex={0}
            >
              <Table aria-label="Métricas por semana">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead rowSpan={2} className="align-bottom">
                      Semana
                    </TableHead>
                    <TableHead colSpan={2} scope="colgroup" className="border-l text-center text-xs uppercase tracking-wider text-muted-foreground">
                      Permutas
                    </TableHead>
                    <TableHead colSpan={2} scope="colgroup" className="border-l text-center text-xs uppercase tracking-wider text-muted-foreground">
                      Adiantamentos
                    </TableHead>
                    <TableHead colSpan={2} scope="colgroup" className="border-l text-center text-xs uppercase tracking-wider text-muted-foreground">
                      Pagamentos (SISPAG)
                    </TableHead>
                  </TableRow>
                  <TableRow>
                    <TableHead className="border-l text-right">Concluídas</TableHead>
                    <TableHead className="text-right">Valor baixado</TableHead>
                    <TableHead className="border-l text-right">Concluídos</TableHead>
                    <TableHead className="text-right">Valor alocado</TableHead>
                    <TableHead className="border-l text-right">Aceitos</TableHead>
                    <TableHead className="text-right">Valor aceito</TableHead>
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
                      <CelulaPercentual metrica={s.porChave[METRICA.SISPAG_PCT]} />
                      <TableCell className="text-right tabular-nums">
                        {formatarMetrica(s.porChave[METRICA.SISPAG_RS])}
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

type Metrica = Parameters<typeof formatarMetrica>[0]

const barraCor = {
  permuta: 'bg-permuta',
  info: 'bg-info',
  primary: 'bg-primary',
} as const

/**
 * Um card por frente. O R$ é o número grande; a taxa vem logo abaixo, sempre com o absoluto
 * ("12 de 13 tentativas") e uma barra fina — compacto, sem o vão de seis cards soltos.
 */
function FrenteKPI({
  frente,
  color,
  rotuloValor,
  valor,
  notaValor,
  rotuloTaxa,
  taxa,
  semTaxa,
  tooltip,
}: {
  frente: string
  color: keyof typeof barraCor
  rotuloValor: string
  valor: Metrica
  notaValor: string
  rotuloTaxa: string
  taxa: Metrica
  semTaxa: string
  tooltip: string
}) {
  const absoluto = taxa ? absolutoDoRotulo(taxa.rotulo) : undefined
  const largura = taxa ? Math.min(100, Math.max(0, taxa.valor)) : 0
  return (
    <KPICard.Root color={color} tooltip={tooltip} aria-label={frente} className="gap-3">
      <KPICard.Header>
        <KPICard.Dot color={color} />
        <KPICard.Label>{frente}</KPICard.Label>
      </KPICard.Header>
      <div className="space-y-0.5">
        <KPICard.Value className="tabular-nums">{formatarMetrica(valor)}</KPICard.Value>
        <KPICard.Footer>
          {rotuloValor} · {notaValor}
        </KPICard.Footer>
      </div>
      <div className="space-y-1.5 border-t pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">{rotuloTaxa}</span>
          <span className="text-lg font-semibold tabular-nums">{formatarMetrica(taxa)}</span>
        </div>
        {/* O trilho aparece mesmo sem taxa, para as três colunas ficarem alinhadas. */}
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={`h-full rounded-full ${barraCor[color]}`} style={{ width: `${largura}%` }} />
        </div>
        <KPICard.Footer>{absoluto ?? semTaxa}</KPICard.Footer>
      </div>
    </KPICard.Root>
  )
}

function CelulaPercentual({ metrica }: { metrica: Metrica }) {
  const absoluto = metrica ? absolutoDoRotulo(metrica.rotulo) : undefined
  return (
    <TableCell className="border-l text-right tabular-nums">
      {formatarMetrica(metrica)}
      {absoluto ? <span className="block text-xs text-muted-foreground">{absoluto}</span> : null}
    </TableCell>
  )
}

function MetricasSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Carregando as métricas">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
      <TableSkeleton columns={7} rows={4} aria-label="Carregando o histórico" />
    </div>
  )
}

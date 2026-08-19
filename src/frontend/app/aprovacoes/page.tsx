'use client'

import * as React from 'react'
import { AlertTriangle, FileSearch, RefreshCcw } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { KPIGrid, SimpleKPI } from '@/components/ui/kpi-card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { formatBRL, formatDate, formatNumber } from '@/lib/utils'
import { fetchFiliais } from '@/lib/api'
import {
  fetchAprovacoes,
  STATUS_WORKFLOW_VALORES,
  type AprovacaoListItem,
  type AprovacoesListResponse,
  type StatusWorkflow,
} from '@/lib/aprovacoes'
import {
  FiltroBarra,
  Paginacao,
  type TabelaFiltro,
} from '@/app/permutas/components/tabela-filtro'
import {
  EtapasAbertasBadge,
  LacunasIndicador,
  ParadaHaBadge,
  StatusWorkflowBadge,
} from './components/status-badges'
import { SnapshotFaixa } from './components/snapshot-faixa'
import { TrilhaDrawer } from './components/TrilhaDrawer'

/** Tamanho da página — a paginação é do SERVIDOR (ver `carregar`). */
const PAGE_SIZE = 25

/** Atraso do debounce da busca textual: cada tecla viraria um request sem ele. */
const BUSCA_DEBOUNCE_MS = 300

/** Filtro de status: um dos estados do workflow, ou `todos`. */
type StatusFiltro = StatusWorkflow | 'todos'

const STATUS_ROTULOS: Record<StatusWorkflow, string> = {
  AGUARDANDO: 'Aguardando',
  APROVADO: 'Aprovado',
  REJEITADO: 'Rejeitado',
  INDETERMINADO: 'Indeterminado',
  SEM_WORKFLOW: 'Sem workflow',
}

/** Valor monetário sem truncar (taste-profile) — BRL formatado; outra moeda vem prefixada. */
const fmtValor = (valor?: number, moeda?: string): string => {
  if (valor === undefined) return '—'
  if (moeda === undefined || moeda === 'BRL') return formatBRL(valor)
  return `${moeda} ${formatNumber(valor)}`
}

/**
 * Rota `/aprovacoes` — painel READ-ONLY da trilha de aprovação de títulos a pagar (Frente V).
 *
 * A tela não escreve nada em lugar nenhum: ela lê o snapshot do ERP que vive no nosso Postgres.
 */
export default function AprovacoesPage() {
  return <AprovacoesPainel />
}

function PainelSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando trilha de aprovações">
      <Skeleton className="h-14 w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      {/* O esqueleto imita a forma do que vai chegar: uma tabela de linhas, não um bloco só. */}
      <div className="space-y-1 rounded-lg border p-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  )
}

/**
 * Célula "Etapa atual": nome da etapa (com a alçada abaixo) e o `+N` quando o título tem mais
 * de uma etapa aberta ao mesmo tempo. `etapaAtual` é a pendente MAIS ANTIGA, não a única.
 */
function EtapaAtualCelula({ item }: { item: AprovacaoListItem }) {
  const etapa = item.etapaAtual
  const principal = etapa?.nome ?? etapa?.alcada
  if (principal === undefined || principal === '') {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <>
      <div className="flex items-center gap-1">
        <span>{principal}</span>
        <EtapasAbertasBadge abertas={item.etapasAbertas} />
      </div>
      {etapa?.nome !== undefined && etapa.alcada !== undefined ? (
        <span className="block text-xs text-muted-foreground">{etapa.alcada}</span>
      ) : null}
    </>
  )
}

function AprovacoesPainel() {
  const [resposta, setResposta] = React.useState<AprovacoesListResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  /**
   * Título cuja trilha está aberta no drawer — `null` = drawer fechado.
   *
   * O id é a chave natural (`filCod:docCod:titCod`), não o índice da linha: trocar de página ou
   * de filtro não pode fazer o drawer passar a mostrar a trilha de outro documento.
   */
  const [trilhaId, setTrilhaId] = React.useState<string | null>(null)

  // ── Estado dos filtros. TUDO daqui vira query string: filtro e paginação são do SERVIDOR.
  // O `useTabelaFiltro` das outras frentes NÃO serve aqui: ele filtra e pagina 100% em memória,
  // o que pressupõe a lista inteira no cliente. Só a filial 2 tem ~23.6k títulos em 12 meses —
  // baixar isso derrubaria a tela e o backend. Reusamos os COMPONENTES visuais (`FiltroBarra`,
  // `Paginacao`) montando o objeto `TabelaFiltro` a partir da resposta do servidor.
  const [pagina, setPagina] = React.useState(1)
  const [filial, setFilialEstado] = React.useState('todas')
  const [status, setStatusEstado] = React.useState<StatusFiltro>('todos')
  const [fornecedorCod, setFornecedorCodEstado] = React.useState('')
  const [emissaoDe, setEmissaoDeEstado] = React.useState('')
  const [emissaoAte, setEmissaoAteEstado] = React.useState('')
  /** O que está digitado (controla o input, atualiza a cada tecla). */
  const [buscaTexto, setBuscaTexto] = React.useState('')
  /** O que já foi para o servidor (atualiza depois do debounce). */
  const [buscaAplicada, setBuscaAplicada] = React.useState('')
  const [filiaisApi, setFiliaisApi] = React.useState<number[]>([])

  const buscaTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(
    () => () => {
      if (buscaTimer.current !== null) clearTimeout(buscaTimer.current)
    },
    [],
  )

  const carregar = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setResposta(
        await fetchAprovacoes({
          page: pagina,
          pageSize: PAGE_SIZE,
          filCod: filial === 'todas' ? undefined : Number(filial),
          status: status === 'todos' ? undefined : status,
          fornecedorCod: fornecedorCod.trim() === '' ? undefined : Number(fornecedorCod),
          emissaoDe: emissaoDe === '' ? undefined : emissaoDe,
          emissaoAte: emissaoAte === '' ? undefined : emissaoAte,
          busca: buscaAplicada === '' ? undefined : buscaAplicada,
        }),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao carregar a trilha de aprovações.')
    } finally {
      setLoading(false)
    }
  }, [pagina, filial, status, fornecedorCod, emissaoDe, emissaoAte, buscaAplicada])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  // As filiais do dropdown vêm do ERP (lista completa), não das linhas da página — com paginação
  // server-side a página atual mostraria só um recorte, e o analista não conseguiria filtrar pela
  // filial que justamente não aparece nela. Se a chamada falhar, cai para as filiais visíveis.
  React.useEffect(() => {
    let vivo = true
    fetchFiliais()
      .then((r) => {
        if (vivo) setFiliaisApi(r.filiais.map((f) => f.filCod))
      })
      .catch(() => {
        /* silencioso: o fallback abaixo cobre o dropdown */
      })
    return () => {
      vivo = false
    }
  }, [])

  // Memoizado: sem isto o `?? []` cria um array novo a cada render e derruba os `useMemo` abaixo.
  const items = React.useMemo(() => resposta?.items ?? [], [resposta])
  const total = resposta?.total ?? 0
  const pageSize = resposta?.pageSize ?? PAGE_SIZE
  const paginaAtual = resposta?.page ?? pagina
  const totalPaginas = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))

  const filiaisOpcoes = React.useMemo(
    () =>
      [...new Set([...filiaisApi, ...items.map((i) => i.filCod)])]
        .filter((f) => Number.isFinite(f))
        .sort((a, b) => a - b),
    [filiaisApi, items],
  )

  /** Trocar qualquer filtro volta para a primeira página — senão a página 7 de outro recorte. */
  const setFilial = React.useCallback((v: string) => {
    setFilialEstado(v)
    setPagina(1)
  }, [])

  const setBusca = React.useCallback((v: string) => {
    setBuscaTexto(v)
    if (buscaTimer.current !== null) clearTimeout(buscaTimer.current)
    buscaTimer.current = setTimeout(() => {
      setBuscaAplicada(v.trim())
      setPagina(1)
    }, BUSCA_DEBOUNCE_MS)
  }, [])

  const setStatus = React.useCallback((v: StatusFiltro) => {
    setStatusEstado(v)
    setPagina(1)
  }, [])

  const setFornecedorCod = React.useCallback((v: string) => {
    // Só dígitos: o contrato recebe `fornecedorCod` numérico. Nome do fornecedor vai na busca.
    setFornecedorCodEstado(v.replace(/\D/g, ''))
    setPagina(1)
  }, [])

  const setEmissaoDe = React.useCallback((v: string) => {
    setEmissaoDeEstado(v)
    setPagina(1)
  }, [])

  const setEmissaoAte = React.useCallback((v: string) => {
    setEmissaoAteEstado(v)
    setPagina(1)
  }, [])

  /**
   * Adaptador para os componentes visuais de `tabela-filtro` (mesma barra e mesmo rodapé das
   * outras frentes). `slice` é a página que o servidor mandou — NÃO é re-fatiada aqui.
   */
  const aba: TabelaFiltro<AprovacaoListItem> = React.useMemo(
    () => ({
      filial,
      busca: buscaTexto,
      setFilial,
      setBusca,
      pagina,
      setPagina,
      filiais: filiaisOpcoes,
      slice: items,
      total,
      totalPaginas,
      paginaAtual,
      pageSize,
    }),
    [
      filial,
      buscaTexto,
      setFilial,
      setBusca,
      pagina,
      filiaisOpcoes,
      items,
      total,
      totalPaginas,
      paginaAtual,
      pageSize,
    ],
  )

  const temFiltroAtivo =
    filial !== 'todas' ||
    status !== 'todos' ||
    fornecedorCod !== '' ||
    emissaoDe !== '' ||
    emissaoAte !== '' ||
    buscaAplicada !== ''

  const limparFiltros = () => {
    setFilialEstado('todas')
    setStatusEstado('todos')
    setFornecedorCodEstado('')
    setEmissaoDeEstado('')
    setEmissaoAteEstado('')
    setBuscaTexto('')
    setBuscaAplicada('')
    setPagina(1)
  }

  // Contagens da PÁGINA, rotuladas como tais. O contrato não devolve agregados por status, e
  // inventar um total global a partir de 25 linhas seria precisão que o dado não tem.
  const aguardandoNaPagina = items.filter((i) => i.statusWorkflow === 'AGUARDANDO').length
  const indeterminadosNaPagina = items.filter((i) => i.statusWorkflow === 'INDETERMINADO').length
  const comLacunasNaPagina = items.filter((i) => i.lacunas.length > 0).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trilha de Aprovações"
        subtitle="Títulos a pagar e seu percurso de bloqueio/liberação no Conexos (Frente V). Painel somente leitura."
        actions={
          <div className="flex items-center gap-2">
            {/*
              Trocar filtro ou página refaz o fetch no servidor. Enquanto ele volta, a tabela
              antiga continua na tela (melhor que piscar um esqueleto) — mas precisa DIZER que o
              que está ali já é passado, senão o analista lê o resultado do filtro anterior como
              se fosse o novo.
            */}
            {loading && resposta !== null ? (
              <span
                role="status"
                aria-live="polite"
                className="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <RefreshCcw className="size-3 animate-spin" aria-hidden /> Atualizando…
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void carregar()} disabled={loading}>
              <RefreshCcw className="size-4" aria-hidden /> Recarregar
            </Button>
          </div>
        }
      />

      {loading && resposta === null ? (
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
      ) : (
        <>
          <SnapshotFaixa snapshotEm={resposta?.snapshotEm} />

          <KPIGrid columns={4}>
            <SimpleKPI
              label="Títulos no filtro"
              value={total.toLocaleString('pt-BR')}
              color="default"
              tooltip="Total contado pelo servidor sobre TODO o filtro atual — não só sobre a página exibida."
              footer="no filtro atual"
            />
            <SimpleKPI
              label="Aguardando"
              value={aguardandoNaPagina.toLocaleString('pt-BR')}
              color="info"
              tooltip="Títulos desta página com alguma etapa pendente. É contagem da PÁGINA: o contrato não devolve agregados por status."
              footer="nesta página"
            />
            <SimpleKPI
              label="Indeterminados"
              value={indeterminadosNaPagina.toLocaleString('pt-BR')}
              color="permuta"
              tooltip="Títulos desta página com etapa cujo status o ERP não explica (pendência PV-01). Não são erros da tela — são perguntas em aberto."
              footer="nesta página"
            />
            <SimpleKPI
              label="Com lacunas"
              value={comLacunasNaPagina.toLocaleString('pt-BR')}
              color="warning"
              tooltip="Títulos desta página em que falta algum dado para a leitura ser completa. Passe o mouse na coluna Lacunas para ver o quê."
              footer="nesta página"
            />
          </KPIGrid>

          {/* ---- Filtros (todos server-side) ---- */}
          <div className="space-y-3">
            <FiltroBarra
              aba={aba}
              buscaPlaceholder="Buscar por documento, título ou fornecedor…"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="aprovacoes-emissao-de">
                  Emissão de
                </label>
                <DatePicker
                  id="aprovacoes-emissao-de"
                  value={emissaoDe}
                  onChange={setEmissaoDe}
                  className="w-44"
                  max={emissaoAte === '' ? undefined : emissaoAte}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="aprovacoes-emissao-ate">
                  Emissão até
                </label>
                <DatePicker
                  id="aprovacoes-emissao-ate"
                  value={emissaoAte}
                  onChange={setEmissaoAte}
                  className="w-44"
                  min={emissaoDe === '' ? undefined : emissaoDe}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="aprovacoes-fornecedor">
                  Cód. do fornecedor
                </label>
                <Input
                  id="aprovacoes-fornecedor"
                  inputMode="numeric"
                  value={fornecedorCod}
                  onChange={(e) => setFornecedorCod(e.target.value)}
                  placeholder="ex.: 10432"
                  className="w-44"
                />
              </div>
              {temFiltroAtivo ? (
                <Button variant="ghost" size="sm" onClick={limparFiltros}>
                  Limpar filtros
                </Button>
              ) : null}
            </div>

            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Filtrar por status do workflow"
            >
              <Button
                size="sm"
                variant={status === 'todos' ? 'default' : 'outline'}
                aria-pressed={status === 'todos'}
                onClick={() => setStatus('todos')}
              >
                Todos
              </Button>
              {STATUS_WORKFLOW_VALORES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={status === s ? 'default' : 'outline'}
                  aria-pressed={status === s}
                  onClick={() => setStatus(s)}
                >
                  {STATUS_ROTULOS[s]}
                </Button>
              ))}
            </div>
          </div>

          {/* ---- Grid ---- */}
          {items.length === 0 ? (
            <EmptyState
              icon={<FileSearch className="size-6" aria-hidden />}
              title={temFiltroAtivo ? 'Nenhum título com esses filtros' : 'Nenhum título na base'}
              description={
                temFiltroAtivo
                  ? 'Ajuste o período de emissão, a filial, o status ou a busca acima.'
                  : 'A trilha é populada pela ingestão do Conexos. Enquanto ela não roda para a janela configurada, não há títulos a exibir.'
              }
              action={
                temFiltroAtivo ? (
                  <Button size="sm" variant="outline" onClick={limparFiltros}>
                    Limpar filtros
                  </Button>
                ) : null
              }
            />
          ) : (
            <div
              className={`overflow-x-auto rounded-lg border transition-opacity ${
                loading ? 'opacity-60' : ''
              }`}
              aria-busy={loading}
            >
              <Table aria-label="Títulos a pagar e sua trilha de aprovação">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Documento</TableHead>
                    <TableHead scope="col">Título</TableHead>
                    <TableHead scope="col">Filial</TableHead>
                    <TableHead scope="col">Fornecedor</TableHead>
                    <TableHead scope="col" className="text-right">Valor</TableHead>
                    {/*
                      Emissão — e NÃO "finalização". O marco que o cliente usou para definir o
                      aceite ("o documento foi finalizado às 10:00") é `docDtaFinalizacao`, que a
                      projeção do ERP não expõe hoje (PV-04). Rotular emissão como finalização
                      seria mentir sobre exatamente o dado mais sensível da tela.
                    */}
                    <TableHead scope="col">Emissão</TableHead>
                    <TableHead scope="col">Vencimento</TableHead>
                    <TableHead scope="col">Status do workflow</TableHead>
                    <TableHead scope="col">Etapa atual</TableHead>
                    <TableHead scope="col">Aprovador atual</TableHead>
                    <TableHead
                      scope="col"
                      title="Espera EM CURSO da etapa pendente — o relógio ainda está correndo. Não é a duração de uma etapa concluída."
                    >
                      Parada há
                    </TableHead>
                    <TableHead scope="col" title="Etapas concluídas de etapas totais deste título.">
                      Aprovações
                    </TableHead>
                    <TableHead scope="col" title="O que este título não nos diz.">Lacunas</TableHead>
                    <TableHead scope="col">Trilha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    /*
                      O clique na linha é uma conveniência REDUNDANTE de mouse, nunca o único
                      caminho: toda linha carrega o botão "Ver trilha" (última coluna), que é
                      focável, anunciado por leitor de tela e ativado por Enter/Espaço. Como a
                      ação existe inteira ali, nenhuma funcionalidade fica inacessível por
                      teclado (WCAG 2.1.1).
                      Não colocamos `role="button"`/`tabIndex` no `<tr>` de propósito: isso
                      destruiria a semântica de linha da tabela (WCAG 1.3.1) e criaria um segundo
                      tab-stop mudo, ao lado do botão que já faz a mesma coisa — pior para quem
                      navega por teclado, não melhor.
                    */
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => setTrilhaId(item.id)}
                    >
                      <TableCell className="font-medium">{item.documentoNumero ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.tituloNumero ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{item.filCod}</TableCell>
                      <TableCell className="max-w-[18rem]">
                        <span className="block truncate" title={item.fornecedorNome ?? undefined}>
                          {item.fornecedorNome ?? '—'}
                        </span>
                        {item.fornecedorCod !== undefined ? (
                          <span className="text-xs text-muted-foreground">
                            cód. {item.fornecedorCod}
                          </span>
                        ) : null}
                      </TableCell>
                      {/* Valor monetário nunca truncado (taste-profile) — separador de milhar completo. */}
                      <TableCell className="whitespace-nowrap text-right tabular-nums">
                        {fmtValor(item.valor, item.moeda)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {item.dataEmissao ? formatDate(item.dataEmissao) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {item.dataVencimento ? formatDate(item.dataVencimento) : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusWorkflowBadge status={item.statusWorkflow} />
                      </TableCell>
                      <TableCell>
                        <EtapaAtualCelula item={item} />
                      </TableCell>
                      <TableCell className="max-w-[14rem]">
                        <span
                          className="block truncate"
                          title={item.etapaAtual?.responsavelNome ?? undefined}
                        >
                          {item.etapaAtual?.responsavelNome ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ParadaHaBadge segundos={item.etapaAtual?.paradaHaSegundos} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <span
                          title={`${item.etapasConcluidas} de ${item.etapasTotais} etapas concluídas.`}
                        >
                          {item.etapasConcluidas}/{item.etapasTotais}
                        </span>
                      </TableCell>
                      <TableCell>
                        <LacunasIndicador lacunas={item.lacunas} />
                      </TableCell>
                      {/*
                        A linha inteira abre o drawer (é o gesto que o analista espera numa
                        tabela densa), mas um `onClick` em `<tr>` não é alcançável por teclado
                        nem anunciado por leitor de tela. Este botão é o caminho acessível de
                        verdade — mesma ação, com foco, `Enter`/`Espaço` e rótulo que diz de
                        QUAL documento é a trilha.
                      */}
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Ver trilha de aprovação do documento ${
                            item.documentoNumero ?? item.id
                          }`}
                          onClick={() => setTrilhaId(item.id)}
                        >
                          Ver trilha
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <Paginacao aba={aba} />
        </>
      )}

      <TrilhaDrawer
        id={trilhaId}
        open={trilhaId !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setTrilhaId(null)
        }}
      />
    </div>
  )
}

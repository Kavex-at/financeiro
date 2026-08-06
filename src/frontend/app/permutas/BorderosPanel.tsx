'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Ban, CheckCircle2, ChevronRight, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelarBordero,
  excluirBaixaBordero,
  fetchBaixasErp,
  excluirBorderoInteiro,
  fetchBorderos,
  finalizarBordero,
  invalidarBorderosMemo,
} from '@/lib/api'
import { isSessionExpiredError } from '@/lib/http'
import type { BorderoResumo, BorderoSituacao } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn, formatNumber, ordenarBorderosPainel } from '@/lib/utils'

type FiltroSituacao = 'todos' | 'abertos' | 'finalizados' | 'cancelados'

const SITUACAO_LABEL: Record<BorderoSituacao, string> = {
  EM_CADASTRO: 'Em aberto',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
  ESTORNADO: 'Estornado',
  REMOVIDO: 'Removido',
  INDISPONIVEL: 'Indisponível',
}

const situacaoBadge = (s: BorderoSituacao) => {
  const cls =
    s === 'FINALIZADO'
      ? 'border-success/40 bg-success-subtle text-success-foreground'
      : s === 'EM_CADASTRO'
        ? 'border-warning/40 bg-warning-subtle text-warning-foreground'
        : s === 'ESTORNADO' || s === 'REMOVIDO' || s === 'CANCELADO'
          ? 'border-destructive/40 bg-destructive/10 text-destructive'
          : 'border-border bg-muted text-muted-foreground'
  return <Badge className={cn('border-transparent', cls)}>{SITUACAO_LABEL[s]}</Badge>
}

const formatWhen = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  } catch {
    return iso
  }
}

/**
 * Painel de gestão de borderôs (Fase 3.1) — revisão/aprovação dos borderôs de permuta criados no
 * `fin010`. Lista a trilha local enriquecida com o STATUS VIVO do ERP. Reutilizado na rota
 * `/permutas/borderos` (`embedded=false`, com PageHeader) e como aba "Borderôs" na Gestão de
 * Permutas (`embedded=true`, só a toolbar de Atualizar).
 */
export function BorderosPanel({ embedded = false }: { embedded?: boolean }) {
  const [borderos, setBorderos] = React.useState<BorderoResumo[] | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [filtro, setFiltro] = React.useState<FiltroSituacao>('todos')
  const [borderoBusca, setBorderoBusca] = React.useState('')
  const [usuarioFiltro, setUsuarioFiltro] = React.useState('todos')
  const [filialFiltro, setFilialFiltro] = React.useState('todos')
  const [dataInicio, setDataInicio] = React.useState('')
  const [dataFim, setDataFim] = React.useState('')
  const [expandido, setExpandido] = React.useState<number | null>(null)
  const [pagina, setPagina] = React.useState(1)
  // Revalidação ao vivo em background (stale-while-revalidate): true enquanto o refresh do ERP roda
  // por baixo, com o cache já exibido. Alimenta o chip "atualizando…".
  const [atualizando, setAtualizando] = React.useState(false)

  // Atualizar = refresh AO VIVO no ERP (regrava o cache). A carga inicial lê do CACHE (rápido).
  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      setBorderos(await fetchBorderos(true))
    } catch {
      toast.error('Falha ao carregar os borderôs.')
      setBorderos([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Carga inicial STALE-WHILE-REVALIDATE: mostra o CACHE na hora (live=false, vem do banco em ms) e
  // revalida AO VIVO no ERP em background (live=true), atualizando a lista quando volta. Mata a espera
  // do refresh multi-filial sem perder o frescor — a tela abre instantânea.
  React.useEffect(() => {
    let active = true
    void (async () => {
      // 1) cache imediato → renderiza já
      try {
        const cached = await fetchBorderos(false)
        if (active) setBorderos(cached)
      } catch {
        if (active) setBorderos([])
      } finally {
        if (active) setLoading(false)
      }
      // 2) revalida ao vivo no ERP, por baixo (mantém o cache exibido se falhar)
      if (!active) return
      setAtualizando(true)
      try {
        const fresh = await fetchBorderos(true)
        if (active) setBorderos(fresh)
      } catch {
        // mantém o cache já exibido — sem toast (revalidação silenciosa)
      } finally {
        if (active) setAtualizando(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Cache das baixas do ERP por borderô (lazy, só p/ os SEM trilha ao expandir).
  const [baixasErp, setBaixasErp] = React.useState<
    Record<number, Array<{ invoiceDocCod: string; bxaCodSeq: number; valorLiquido?: number }>>
  >({})
  const carregarBaixasErp = React.useCallback(
    async (borCod: number, filCod: number) => {
      if (baixasErp[borCod]) return
      try {
        const b = await fetchBaixasErp(borCod, filCod)
        setBaixasErp((cur) => ({ ...cur, [borCod]: b }))
      } catch {
        setBaixasErp((cur) => ({ ...cur, [borCod]: [] }))
      }
    },
    [baixasErp],
  )

  // Opções dinâmicas (distintas) para os selects de usuário e filial.
  const usuarios = [...new Set((borderos ?? []).map((b) => b.criadoPor).filter(Boolean))].sort() as string[]
  const filiais = [...new Set((borderos ?? []).map((b) => b.filCod))].sort((a, b) => a - b)

  const borderoNorm = borderoBusca.trim()
  // Ordena: EM ABERTO da nossa trilha no topo; resto (nossos finalizados + ERP) por data desc.
  const lista = ordenarBorderosPainel(
    (borderos ?? [])
      .filter((b) =>
        filtro === 'todos'
          ? true
          : filtro === 'finalizados'
            ? b.situacao === 'FINALIZADO'
            : filtro === 'cancelados'
              ? b.situacao === 'CANCELADO'
              : b.situacao === 'EM_CADASTRO',
      )
      .filter((b) => borderoNorm === '' || String(b.borCod).includes(borderoNorm))
      .filter((b) => usuarioFiltro === 'todos' || b.criadoPor === usuarioFiltro)
      .filter((b) => filialFiltro === 'todos' || String(b.filCod) === filialFiltro)
      .filter((b) => {
        // Filtro por intervalo (inclusivo). Compara só a parte YYYY-MM-DD.
        if (dataInicio === '' && dataFim === '') return true
        const dia = (b.criadoEm ?? '').slice(0, 10)
        if (dia === '') return false
        if (dataInicio !== '' && dia < dataInicio) return false
        if (dataFim !== '' && dia > dataFim) return false
        return true
      }),
  )

  // Paginação (50/página) sobre a lista filtrada.
  const PAGE_SIZE = 50
  const totalPaginas = Math.max(1, Math.ceil(lista.length / PAGE_SIZE))
  const paginaAtual = Math.min(pagina, totalPaginas)
  const listaPagina = lista.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE)
  // Volta pra página 1 sempre que os filtros mudam (evita página vazia).
  React.useEffect(() => {
    setPagina(1)
  }, [filtro, borderoBusca, usuarioFiltro, filialFiltro, dataInicio, dataFim])

  const filtroAtivo =
    filtro !== 'todos' ||
    borderoBusca !== '' ||
    usuarioFiltro !== 'todos' ||
    filialFiltro !== 'todos' ||
    dataInicio !== '' ||
    dataFim !== ''
  const limparFiltros = () => {
    setFiltro('todos')
    setBorderoBusca('')
    setUsuarioFiltro('todos')
    setFilialFiltro('todos')
    setDataInicio('')
    setDataFim('')
  }

  const totais = {
    todos: borderos?.length ?? 0,
    abertos: (borderos ?? []).filter((b) => b.situacao === 'EM_CADASTRO').length,
    finalizados: (borderos ?? []).filter((b) => b.situacao === 'FINALIZADO').length,
    cancelados: (borderos ?? []).filter((b) => b.situacao === 'CANCELADO').length,
  }

  // Ação com confirmação via modal (excluir baixa / excluir borderô / aprovar / cancelar / liberar).
  const [executando, setExecutando] = React.useState(false)
  const [confirmaAcao, setConfirmaAcao] = React.useState<
    | { tipo: 'baixa'; borCod: number; invoiceDocCod: string }
    | { tipo: 'bordero'; borCod: number; filCod: number }
    | { tipo: 'finalizar'; borCod: number; filCod: number }
    | { tipo: 'cancelar'; borCod: number; filCod: number }
    | null
  >(null)

  const confirmarAcao = async () => {
    if (!confirmaAcao) return
    setExecutando(true)
    try {
      if (confirmaAcao.tipo === 'baixa') {
        await excluirBaixaBordero(confirmaAcao.borCod, confirmaAcao.invoiceDocCod)
        toast.success(`Baixa da invoice ${confirmaAcao.invoiceDocCod} excluída.`)
      } else if (confirmaAcao.tipo === 'bordero') {
        await excluirBorderoInteiro(confirmaAcao.borCod, confirmaAcao.filCod)
        toast.success(`Borderô ${confirmaAcao.borCod} excluído (com todas as baixas).`)
      } else if (confirmaAcao.tipo === 'finalizar') {
        await finalizarBordero(confirmaAcao.borCod, confirmaAcao.filCod)
        toast.success(`Borderô ${confirmaAcao.borCod} finalizado/aprovado.`)
      } else {
        await cancelarBordero(confirmaAcao.borCod, confirmaAcao.filCod)
        toast.success(`Borderô ${confirmaAcao.borCod} cancelado.`)
      }
      setConfirmaAcao(null)
      // A ação já atualizou o cache no servidor → recarrega do CACHE (rápido), invalidando o memo.
      invalidarBorderosMemo()
      setBorderos(await fetchBorderos(false))
    } catch (err) {
      if (isSessionExpiredError(err)) return
      toast.error(`Falha${err instanceof Error ? ` — ${err.message}` : ''}.`)
    } finally {
      setExecutando(false)
    }
  }

  return (
    <div className="space-y-6">
      {embedded ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Revisão dos borderôs de permuta criados no fin010 — status ao vivo do Conexos.
          </p>
          <div className="flex items-center gap-2">
            {atualizando && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <RefreshCw className="size-3 animate-spin" aria-hidden /> atualizando…
              </span>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw aria-hidden /> Atualizar
            </Button>
          </div>
        </div>
      ) : (
        <PageHeader
          title="Borderôs"
          subtitle="Revisão dos borderôs de permuta criados no fin010 — status ao vivo do Conexos (em aberto / finalizado / estornado)."
          actions={
            <div className="flex items-center gap-2">
              {atualizando && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <RefreshCw className="size-3 animate-spin" aria-hidden /> atualizando…
                </span>
              )}
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                <RefreshCw aria-hidden /> Atualizar
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/permutas">
                  <ArrowLeft aria-hidden /> Voltar ao painel
                </Link>
              </Button>
            </div>
          }
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Borderô
          <Input
            value={borderoBusca}
            onChange={(e) => setBorderoBusca(e.target.value)}
            placeholder="Nº do borderô"
            inputMode="numeric"
            aria-label="Filtrar por borderô"
            className="w-40"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Usuário
          <Select value={usuarioFiltro} onValueChange={setUsuarioFiltro}>
            <SelectTrigger className="w-52" aria-label="Filtrar por usuário">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {usuarios.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Filial
          <Select value={filialFiltro} onValueChange={setFilialFiltro}>
            <SelectTrigger className="w-32" aria-label="Filtrar por filial">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              {filiais.map((f) => (
                <SelectItem key={f} value={String(f)}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Situação
          <Select value={filtro} onValueChange={(v) => setFiltro(v as FiltroSituacao)}>
            <SelectTrigger className="w-48" aria-label="Filtrar por situação">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas ({totais.todos})</SelectItem>
              <SelectItem value="abertos">Em aberto ({totais.abertos})</SelectItem>
              <SelectItem value="finalizados">Finalizados ({totais.finalizados})</SelectItem>
              <SelectItem value="cancelados">Cancelados ({totais.cancelados})</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Data inicial
          <Input
            type="date"
            value={dataInicio}
            max={dataFim || undefined}
            onChange={(e) => setDataInicio(e.target.value)}
            aria-label="Filtrar a partir da data"
            className="w-44"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Data final
          <Input
            type="date"
            value={dataFim}
            min={dataInicio || undefined}
            onChange={(e) => setDataFim(e.target.value)}
            aria-label="Filtrar até a data"
            className="w-44"
          />
        </label>

        {filtroAtivo && (
          <Button variant="ghost" size="sm" onClick={limparFiltros}>
            Limpar
          </Button>
        )}
        <span className="pb-2 text-sm text-muted-foreground">
          {lista.length} de {totais.todos}
          {totais.todos >= 500 ? ' (500 mais recentes)' : ''}
        </span>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <EmptyState
          title="Nenhum borderô"
          description="Ainda não há borderôs de permuta criados por aqui (ou nenhum bate o filtro)."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Borderô</TableHead>
              <TableHead>Filial</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Baixas</TableHead>
              <TableHead className="text-right">Total baixado</TableHead>
              <TableHead>Criado por</TableHead>
              <TableHead>Data</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {listaPagina.map((b) => {
              const aberto = expandido === b.borCod
              return (
                <React.Fragment key={b.borCod}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => {
                      const next = aberto ? null : b.borCod
                      setExpandido(next)
                      // Borderô sem trilha → busca as baixas DO ERP p/ ver o detalhe.
                      if (next !== null && !b.daTrilha) void carregarBaixasErp(b.borCod, b.filCod)
                    }}
                  >
                    <TableCell>
                      <ChevronRight
                        aria-hidden
                        className={cn('size-4 transition-transform', aberto && 'rotate-90')}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{b.borCod}</TableCell>
                    <TableCell>{b.filCod}</TableCell>
                    <TableCell>{situacaoBadge(b.situacao)}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.baixas.length}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(b.totalBaixado)} BRL
                    </TableCell>
                    <TableCell className="text-muted-foreground">{b.criadoPor ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatWhen(b.criadoEm)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        // Ações só nos borderôs criados por ESTE sistema (têm trilha). Os demais
                        // (criados direto no ERP por outros usuários) ficam só p/ visualização.
                        const noso = b.daTrilha === true
                        const foraTip = 'Criado fora deste sistema — apenas visualização'
                        // Casco vazio (I-Write-7): o borderô foi criado mas nenhuma baixa entrou
                        // nele. Conta só `settled` — as linhas `error` da trilha também carregam o
                        // bor_cod, então `baixas.length` sozinho daria o casco como cheio.
                        const vazio = !b.baixas.some((x) => x.status === 'settled')
                        return (
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!noso || b.situacao !== 'EM_CADASTRO' || vazio}
                              title={
                                !noso
                                  ? foraTip
                                  : b.situacao !== 'EM_CADASTRO'
                                    ? 'Só dá para aprovar borderô em aberto'
                                    : vazio
                                      ? 'Borderô sem baixa — não há o que aprovar. Use "Excluir".'
                                      : 'Finalizar/aprovar o borderô no fin010'
                              }
                              onClick={() =>
                                setConfirmaAcao({ tipo: 'finalizar', borCod: b.borCod, filCod: b.filCod })
                              }
                            >
                              <CheckCircle2 aria-hidden /> Aprovar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!noso || b.situacao !== 'FINALIZADO'}
                              title={
                                !noso
                                  ? foraTip
                                  : b.situacao !== 'FINALIZADO'
                                    ? 'Só dá para cancelar borderô já finalizado (aprovado)'
                                    : 'Cancelar o borderô no fin010'
                              }
                              onClick={() =>
                                setConfirmaAcao({ tipo: 'cancelar', borCod: b.borCod, filCod: b.filCod })
                              }
                            >
                              <Undo2 aria-hidden /> Cancelar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!noso || b.situacao !== 'EM_CADASTRO'}
                              title={
                                !noso
                                  ? foraTip
                                  : b.situacao !== 'EM_CADASTRO'
                                    ? 'Só dá para excluir borderô em aberto'
                                    : 'Excluir o borderô inteiro (todas as baixas) no fin010'
                              }
                              onClick={() =>
                                setConfirmaAcao({ tipo: 'bordero', borCod: b.borCod, filCod: b.filCod })
                              }
                            >
                              <Trash2 aria-hidden /> Excluir
                            </Button>
                          </div>
                        )
                      })()}
                    </TableCell>
                  </TableRow>
                  {aberto ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={8}>
                        <div className="py-2">
                          <p className="mb-2 text-sm font-medium text-muted-foreground">
                            Baixas do borderô {b.daTrilha ? '' : '(Conexos)'}
                          </p>
                          {b.baixas.length > 0 ? (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Invoice</TableHead>
                                <TableHead>Adiantamento</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Valor baixado</TableHead>
                                <TableHead className="text-right">Juros</TableHead>
                                <TableHead className="text-right">Conta</TableHead>
                                <TableHead className="text-right">bxaCodSeq</TableHead>
                                <TableHead className="text-right">Ação</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {b.baixas.map((x) => (
                                <React.Fragment
                                  key={`${b.borCod}-${x.invoiceDocCod}-${x.adiantamentoDocCod}`}
                                >
                                <TableRow>
                                  <TableCell className="font-medium">{x.invoiceDocCod}</TableCell>
                                  <TableCell>{x.adiantamentoDocCod}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        x.status === 'settled'
                                          ? 'default'
                                          : x.status === 'error'
                                            ? 'destructive'
                                            : 'secondary'
                                      }
                                    >
                                      {x.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {typeof x.valorBaixado === 'number'
                                      ? `${formatNumber(x.valorBaixado)} BRL`
                                      : '—'}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {typeof x.juros === 'number' ? formatNumber(x.juros) : '—'}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {x.contaJuros ?? '—'}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {x.bxaCodSeq ?? '—'}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      disabled={b.situacao !== 'EM_CADASTRO'}
                                      title={
                                        b.situacao !== 'EM_CADASTRO'
                                          ? 'Só dá para excluir baixa de borderô em aberto'
                                          : 'Excluir esta baixa do borderô (fin010)'
                                      }
                                      onClick={() =>
                                        setConfirmaAcao({
                                          tipo: 'baixa',
                                          borCod: b.borCod,
                                          invoiceDocCod: x.invoiceDocCod,
                                        })
                                      }
                                    >
                                      <Trash2 aria-hidden /> Excluir
                                    </Button>
                                  </TableCell>
                                </TableRow>
                                {x.status === 'error' && x.erroMensagem ? (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell />
                                    <TableCell colSpan={7} className="pt-0">
                                      <p className="text-xs text-destructive">
                                        <span className="font-medium">Erro:</span>{' '}
                                        {x.erroMensagem}
                                      </p>
                                    </TableCell>
                                  </TableRow>
                                ) : null}
                                </React.Fragment>
                              ))}
                            </TableBody>
                          </Table>
                          ) : baixasErp[b.borCod] === undefined ? (
                            <p className="text-sm text-muted-foreground">
                              Carregando baixas do Conexos…
                            </p>
                          ) : baixasErp[b.borCod].length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                              Sem baixas no Conexos para este borderô.
                            </p>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>Invoice</TableHead>
                                  <TableHead className="text-right">Valor líquido</TableHead>
                                  <TableHead className="text-right">bxaCodSeq</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {baixasErp[b.borCod].map((x) => (
                                  <TableRow key={`${b.borCod}-erp-${x.invoiceDocCod}-${x.bxaCodSeq}`}>
                                    <TableCell className="font-medium">{x.invoiceDocCod}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {x.valorLiquido != null
                                        ? `${formatNumber(x.valorLiquido)} BRL`
                                        : '—'}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {x.bxaCodSeq}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}

      {lista.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Página {paginaAtual} de {totalPaginas} · {lista.length} borderô
            {lista.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            >
              Próxima
            </Button>
          </div>
        </div>
      ) : null}

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Ban aria-hidden className="size-3.5" />
        Aprovar (finalizar), Cancelar, Excluir baixa e Excluir borderô (em aberto) são automatizados
        aqui. Status puxado ao vivo do ERP.
      </p>

      {/* Confirmação de ação (modal do design system) */}
      <Dialog
        open={confirmaAcao != null}
        onOpenChange={(open) => {
          if (!open && !executando) setConfirmaAcao(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmaAcao?.tipo === 'finalizar'
                ? 'Finalizar / aprovar borderô'
                : confirmaAcao?.tipo === 'cancelar'
                  ? 'Cancelar borderô'
                  : confirmaAcao?.tipo === 'bordero'
                    ? 'Excluir borderô inteiro'
                    : 'Excluir baixa'}
            </DialogTitle>
            <DialogDescription>
              {confirmaAcao?.tipo === 'finalizar'
                ? `Finalizar/aprovar o borderô ${confirmaAcao.borCod} no fin010? Isso confirma a baixa da permuta — depois de finalizado, só por estorno.`
                : confirmaAcao?.tipo === 'cancelar'
                  ? `Cancelar o borderô ${confirmaAcao.borCod} (finalizado) no fin010? A permuta reabre (não é excluído).`
                  : confirmaAcao?.tipo === 'bordero'
                    ? `Excluir o borderô ${confirmaAcao.borCod} INTEIRO — todas as baixas e o próprio borderô serão removidos no fin010. Não pode ser desfeito por aqui.`
                    : confirmaAcao?.tipo === 'baixa'
                      ? `Excluir a baixa da invoice ${confirmaAcao.invoiceDocCod} do borderô ${confirmaAcao.borCod}? Se for a última baixa, o borderô também é apagado. Removido no fin010 e na trilha.`
                      : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogBody />
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmaAcao(null)} disabled={executando}>
              Voltar
            </Button>
            {confirmaAcao?.tipo === 'finalizar' ? (
              <Button onClick={confirmarAcao} disabled={executando}>
                {executando ? <Spinner /> : <CheckCircle2 aria-hidden />} Aprovar
              </Button>
            ) : (
              <Button variant="destructive" onClick={confirmarAcao} disabled={executando}>
                {executando ? <Spinner /> : <Trash2 aria-hidden />}{' '}
                {confirmaAcao?.tipo === 'cancelar'
                  ? 'Cancelar borderô'
                  : confirmaAcao?.tipo === 'bordero'
                    ? 'Excluir borderô'
                    : 'Excluir baixa'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

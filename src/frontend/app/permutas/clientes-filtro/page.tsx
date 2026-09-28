'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  addClienteFiltro,
  fetchClientesFiltro,
  fetchImportadores,
  IngestaoEmAndamentoError,
  removeClienteFiltro,
  runIngestaoManual,
} from '@/lib/api'
import { isSessionExpiredError } from '@/lib/http'
import type { ClienteFiltro, Importador } from '@/lib/types'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { ExigePermissao } from '@/components/auth/ExigePermissao'
import { PERMISSAO } from '@/lib/permissoes'
import { usePodeExecutarPermutas } from '../components/usePodeExecutarPermutas'

/** Guard de página (ADR-0053): sem `permutas:ver`, só o estado "sem acesso"; os dados nem são buscados. */
export default function ClientesFiltroPage() {
  return (
    <ExigePermissao permissao={PERMISSAO.PERMUTAS_VER}>
      <ClientesFiltroPageConteudo />
    </ExigePermissao>
  )
}

/**
 * Cadastro de "clientes filtro" (Fase 1): importadores cujos adiantamentos vão
 * para permuta MANUAL cross-process (não há invoice no próprio processo). O
 * analista escolhe um importador do backlog e adiciona; a pipeline passa a
 * rotear os adtos dele ao estado `permuta-manual`.
 */
function ClientesFiltroPageConteudo() {
  const [clientes, setClientes] = React.useState<ClienteFiltro[]>([])
  // Adicionar/remover cliente-filtro só para `permutas:executar` (ADR-0053); a lista é leitura.
  const podeExecutar = usePodeExecutarPermutas()
  const [importadores, setImportadores] = React.useState<Importador[]>([])
  const [loading, setLoading] = React.useState(true)
  const [selecionado, setSelecionado] = React.useState<string>('')
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [c, i] = await Promise.all([fetchClientesFiltro(), fetchImportadores()])
      setClientes(c)
      setImportadores(i)
    } catch {
      toast.error('Falha ao carregar os clientes filtro.')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    let active = true
    Promise.all([fetchClientesFiltro(), fetchImportadores()])
      .then(([c, i]) => {
        if (!active) return
        setClientes(c)
        setImportadores(i)
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Importadores ainda NÃO cadastrados (não repetir no seletor).
  const jaCadastrados = new Set(clientes.map((c) => c.pesCod))
  const disponiveis = importadores.filter((i) => !jaCadastrados.has(i.pesCod))

  const adicionar = React.useCallback(async () => {
    if (!selecionado) return
    const imp = importadores.find((i) => i.pesCod === selecionado)
    const nome = imp?.importador ?? selecionado
    setAdding(true)
    try {
      await addClienteFiltro(selecionado, imp?.importador)
      setSelecionado('')
      await load()
      // Roteia AUTOMATICAMENTE os adtos do novo importador para cross-process:
      // o roteamento permuta-manual só ocorre na ingestão, então dispara uma agora
      // (mesmo compute do botão "Ingestão de dados") em vez de esperar o próximo cron.
      try {
        const r = await runIngestaoManual()
        toast.success(
          `Cliente filtro adicionado: ${nome}. Ingestão concluída — ${r.totalAdiantamentos} adiantamento(s) reavaliado(s).`,
        )
      } catch (ingErr) {
        if (isSessionExpiredError(ingErr)) return
        if (ingErr instanceof IngestaoEmAndamentoError) {
          // Lock ocupado (cron/outra rodada): o filtro já está salvo e será
          // roteado pela ingestão em andamento / próxima — não é falha.
          toast.info(
            `Cliente filtro adicionado: ${nome}. Já há uma ingestão em andamento — o roteamento será aplicado nela.`,
          )
        } else {
          toast.warning(
            `Cliente filtro adicionado: ${nome}, mas a ingestão automática falhou${ingErr instanceof Error ? ` — ${ingErr.message}` : ''}. Rode "Ingestão de dados" manualmente.`,
          )
        }
      }
    } catch (err) {
      if (isSessionExpiredError(err)) return
      toast.error(`Falha ao adicionar${err instanceof Error ? ` — ${err.message}` : ''}.`)
    } finally {
      setAdding(false)
    }
  }, [selecionado, importadores, load])

  const remover = React.useCallback(
    async (pesCod: string, nome?: string) => {
      const label = nome ?? pesCod
      setRemoving(pesCod)
      try {
        // Remove o cadastro PRIMEIRO (a ingestão precisa rodar SEM o filtro pra
        // des-rotear os adtos). O spinner fica girando e o item PERMANECE na lista
        // até a re-ingestão concluir de fato — só então `load()` o remove da tela.
        await removeClienteFiltro(pesCod)
        try {
          const r = await runIngestaoManual()
          // Sucesso: dados realinhados (adtos voltam a bloqueada) → agora some da lista.
          await load()
          toast.success(
            `Cliente filtro removido: ${label}. Ingestão concluída — ${r.totalAdiantamentos} adiantamento(s) reavaliado(s).`,
          )
        } catch (ingErr) {
          if (isSessionExpiredError(ingErr)) return
          // Re-ingestão falhou (429/409/erro): os dados do painel NÃO foram
          // realinhados, então re-adiciona o filtro pra manter o cadastro coerente
          // com o painel (o importador continua roteado). O operador tenta de novo.
          try {
            await addClienteFiltro(pesCod, nome)
          } catch {
            // best-effort: se o re-add falhar, o load() abaixo mostra o estado real.
          }
          await load()
          const motivo =
            ingErr instanceof IngestaoEmAndamentoError
              ? 'já há uma ingestão em andamento'
              : ingErr instanceof Error
                ? ingErr.message
                : 'falha na ingestão'
          toast.warning(
            `Não foi possível remover ${label} agora — ${motivo}. O filtro foi mantido (os dados não foram realinhados). Tente novamente.`,
          )
        }
      } catch (err) {
        if (isSessionExpiredError(err)) return
        toast.error(`Falha ao remover${err instanceof Error ? ` — ${err.message}` : ''}.`)
      } finally {
        setRemoving(null)
      }
    },
    [load],
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes filtro"
        subtitle="Importadores cujos adiantamentos vão para permuta manual cross-process (sem invoice no próprio processo)."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/permutas">
              <ArrowLeft aria-hidden /> Voltar ao painel
            </Link>
          </Button>
        }
      />

      {podeExecutar ? (
      <Card>
        <CardHeader>
          <CardTitle>Adicionar importador</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-muted-foreground">Importador</span>
              <Select value={selecionado} onValueChange={setSelecionado}>
                <SelectTrigger className="w-96" aria-label="Selecionar importador">
                  <SelectValue placeholder="Selecione um importador do backlog…" />
                </SelectTrigger>
                <SelectContent>
                  {disponiveis.map((i) => (
                    <SelectItem key={i.pesCod} value={i.pesCod}>
                      {i.importador ?? `(sem nome) — ${i.pesCod}`} · {i.qtdAdtos} adto(s)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => void adicionar()}
              disabled={!selecionado || adding}
              aria-busy={adding}
            >
              {adding ? <Spinner /> : <Plus aria-hidden />}{' '}
              {adding ? 'Adicionando e roteando…' : 'Adicionar'}
            </Button>
          </div>
          {!loading && disponiveis.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Todos os importadores do backlog já estão cadastrados (ou o backlog está vazio).
            </p>
          ) : null}
        </CardContent>
      </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Cadastrados</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : clientes.length === 0 ? (
            <EmptyState
              title="Nenhum cliente filtro"
              description="Adicione um importador acima para rotear os adiantamentos dele para permuta manual."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Importador</TableHead>
                  <TableHead>Código (pesCod)</TableHead>
                  {podeExecutar ? <TableHead className="text-right">Ação</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {clientes.map((c) => (
                  <TableRow key={c.pesCod}>
                    <TableCell className="font-medium">{c.importador ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.pesCod}</TableCell>
                    {podeExecutar ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removing === c.pesCod}
                        aria-busy={removing === c.pesCod}
                        onClick={() => void remover(c.pesCod, c.importador)}
                        aria-label={`Remover ${c.importador ?? c.pesCod}`}
                      >
                        {removing === c.pesCod ? <Spinner /> : <Trash2 aria-hidden />}
                      </Button>
                    </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

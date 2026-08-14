'use client'

import * as React from 'react'
import { AlertTriangle, Coins, PauseCircle, RefreshCcw, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatBRL } from '@/lib/utils'
import { fetchPainelRecebimentos, type TransacaoBancaria } from '@/lib/recebimentos'
import { FiltroBarra, Paginacao, useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'

/** Formata uma data/hora ISO para pt-BR curta. */
const fmtQuando = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'UTC' }) : '—'

/**
 * Aba **Falhas** (ADR-0034) — os créditos cuja última execução não terminou bem.
 *
 * Duas decisões que a fazem funcionar:
 *
 * 1. **Busca própria, não filtro da lista já carregada.** O painel devolve no máximo 500 linhas
 *    ordenadas por data decrescente, então uma falha antiga fica FORA da página — e é justamente
 *    ela que precisa de atenção. Filtrar no cliente entregaria uma aba que esconde o problema mais
 *    velho, que é o pior comportamento possível para uma tela de exceções.
 * 2. **Sob demanda, ao abrir a aba.** O painel principal não paga a query enquanto ninguém olha.
 */
export function FalhasTable({ onAlocar }: { onAlocar?: (t: TransacaoBancaria) => void }) {
  const [transacoes, setTransacoes] = React.useState<TransacaoBancaria[] | null>(null)
  const [erro, setErro] = React.useState<string | null>(null)
  const [carregando, setCarregando] = React.useState(true)

  const carregar = React.useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const painel = await fetchPainelRecebimentos({ status: 'erro' })
      setTransacoes(painel.transacoes)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar as execuções com erro.')
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  const lista = transacoes ?? []
  const aba = useTabelaFiltro(
    lista,
    (t) => t.filCod,
    (t) =>
      `${t.contraparte ?? ''} ${t.referenciaBancaria ?? ''} ${t.correlationId} ` +
      `${t.ultimaFalha?.mensagem ?? ''} ${t.ultimaFalha?.etapa ?? ''} ${t.ultimaFalha?.priCod ?? ''}`,
  )

  if (carregando) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Carregando falhas">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (erro !== null) {
    return (
      <EmptyState
        icon={<AlertTriangle className="size-6" aria-hidden />}
        title="Não foi possível carregar as falhas"
        description={erro}
        action={
          <Button size="sm" variant="outline" onClick={() => void carregar()}>
            <RefreshCcw className="size-4" aria-hidden /> Tentar de novo
          </Button>
        }
      />
    )
  }

  if (lista.length === 0) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6" aria-hidden />}
        title="Nenhuma falha"
        description="Tudo que foi processado concluiu. Execuções que quebrarem no meio aparecem aqui com a etapa e a mensagem do ERP."
      />
    )
  }

  const interrompidas = lista.filter((t) => t.ultimaFalha?.interrompida).length

  return (
    <div className="space-y-3">
      {interrompidas > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
          <PauseCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div>
            <span className="font-medium">
              {interrompidas} execução(ões) interrompida(s) no meio.
            </span>{' '}
            O processo morreu entre abrir e concluir — pode haver documento criado no Conexos sem
            nada acompanhando. Confira no ERP antes de reprocessar.
          </div>
        </div>
      ) : null}

      <FiltroBarra
        aba={aba}
        buscaPlaceholder="Buscar por contraparte, processo, etapa ou mensagem…"
      />

      {aba.total === 0 ? (
        <EmptyState
          icon={<ShieldAlert className="size-6" aria-hidden />}
          title="Nenhuma falha para o filtro"
          description="Ajuste a filial ou a busca acima."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contraparte</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Processo</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>O que aconteceu</TableHead>
                <TableHead>Quando</TableHead>
                <TableHead>Quem</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aba.slice.map((t: TransacaoBancaria) => {
                const falha = t.ultimaFalha
                return (
                  <TableRow key={t.id}>
                    <TableCell className="max-w-[14rem] truncate font-medium">
                      {t.contraparte ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBRL(falha?.valor ?? t.valor)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{falha?.priCod ?? '—'}</TableCell>
                    <TableCell>
                      {falha?.etapa ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {falha.etapa}
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="max-w-[24rem]">
                      {falha?.interrompida ? (
                        <div className="flex items-start gap-2">
                          <Badge variant="outline" className="border-warning/40 text-warning">
                            <PauseCircle className="size-3" aria-hidden /> interrompida
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Parou no meio da execução
                            {falha.docCod !== undefined
                              ? ` — documento ${falha.docCod} pode ter ficado órfão no Conexos`
                              : ' antes de registrar qualquer documento'}
                            .
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm">
                          {falha?.mensagem ?? 'Falha sem mensagem registrada.'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {fmtQuando(falha?.ocorridaEm)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {falha?.executadoPor ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {onAlocar !== undefined && !t.arquivadaEm ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onAlocar(t)}
                          aria-label={`Tentar de novo a alocação de ${t.contraparte ?? t.id}`}
                        >
                          <Coins className="size-4" aria-hidden /> Tentar de novo
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Paginacao aba={aba} />
    </div>
  )
}

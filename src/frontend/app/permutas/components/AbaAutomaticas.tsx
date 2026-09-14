'use client'

import * as React from 'react'
import { ChevronRight, Play } from 'lucide-react'
import type { CasamentoSugerido, PermutaBorderoVinculo } from '@/lib/types'
import { cn, formatNumber } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
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
  LOTE_MAX,
  type LoteResumo,
  PROCESSAMENTO_HABILITADO,
  moedaCodigo,
  motivoSemProcessar,
  temAlgoAProcessar,
} from './format'
import { FiltroBarra, Paginacao, type TabelaFiltro } from './tabela-filtro'
import { BotaoAtualizar, Campo, Moeda, PermutaBorderoBadge } from './ui'

/**
 * Aba "Automáticas": casamento direto (1 invoice ← N adiantamentos) + múltiplas onde o
 * adiantamento cobre todas as invoices. Processar uma a uma OU Executar o lote.
 */
export const AbaAutomaticas = React.memo(function AbaAutomaticas({
  aba,
  statusPorAdto,
  invoiceExpandida,
  setInvoiceExpandida,
  processando,
  setConfirmacao,
  loteResumo,
  executandoLote,
  setConfirmLoteOpen,
  loading,
  onAtualizar,
}: {
  aba: TabelaFiltro<CasamentoSugerido>
  statusPorAdto: Record<string, PermutaBorderoVinculo>
  invoiceExpandida: string | null
  setInvoiceExpandida: React.Dispatch<React.SetStateAction<string | null>>
  processando: string | null
  setConfirmacao: (c: CasamentoSugerido) => void
  loteResumo: LoteResumo
  executandoLote: boolean
  setConfirmLoteOpen: (open: boolean) => void
  loading: boolean
  onAtualizar: () => void
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <strong>Automáticas</strong>: casamento direto (1 invoice ← N adiantamentos) e
        múltiplas onde o adiantamento <strong>cobre todas as invoices</strong> do processo
        (adto ≥ Σ invoices) — já vêm distribuídas (adto → cada invoice). Use o Processar
        para uma a uma, ou <strong>Executar</strong> para criar todos os borderôs de uma vez.
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FiltroBarra aba={aba} buscaPlaceholder="Buscar processo ou cliente…" />
        <div className="flex items-end gap-2">
          <BotaoAtualizar loading={loading} onClick={onAtualizar} />
          <Button
            onClick={() => setConfirmLoteOpen(true)}
            disabled={
              !PROCESSAMENTO_HABILITADO || executandoLote || loteResumo.adtos === 0
            }
            title={`Executar as próximas ${loteResumo.proximosN} automáticas (lotes de até ${LOTE_MAX}; cria os borderôs no ERP)`}
          >
            {executandoLote ? <Spinner aria-hidden /> : <Play aria-hidden />}
            Executar próximas {loteResumo.proximosN}
            {loteResumo.adtos > loteResumo.proximosN ? ` de ${loteResumo.adtos}` : ''}
          </Button>
        </div>
      </div>
      {aba.total === 0 ? (
        <EmptyState
          title="Nenhum casamento sugerido"
          description="Não há invoices em aberto casáveis na última eleição."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filial</TableHead>
              <TableHead>Processo / Invoice</TableHead>
              <TableHead className="text-right">Valor Moeda Negociada</TableHead>
              <TableHead>Adiantamento</TableHead>
              <TableHead className="text-right">Valor a ser Usado</TableHead>
              <TableHead className="text-right">Saldo restante</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aba.slice.map((c, g) => {
              const abertaInv = invoiceExpandida === c.invoice.docCod
              const totalUsado = c.adiantamentos.reduce(
                (s, a) => s + (a.valorASerUsado ?? 0),
                0,
              )
              const moedaGrupo = c.adiantamentos[0]?.moeda ?? c.invoice.moeda
              const sep = g > 0 ? 'border-t-2 border-border' : ''
              // EXECUTÁVEL ≠ "sem borderô". Uma linha sem vínculo pode não ter nada a processar —
              // `valorASerUsado = 0` porque o adiantamento já foi consumido ou é de moeda diferente
              // da invoice. Contá-la mantinha o "Processar" aceso para sempre num grupo que já
              // acabou, e o clique ia bater no backend só para ser ignorado.
              const pendentesGrupo = c.adiantamentos.filter((a) =>
                temAlgoAProcessar(a, statusPorAdto[a.docCod]),
              )
              const todosProcessados =
                c.adiantamentos.length > 0 && pendentesGrupo.length === 0
              // Badge do grupo: prefere um vínculo que ainda PEDE ação (aguardando finalização) ao
              // primeiro da lista — senão um grupo com borderô 2185 finalizado e 2466 a aprovar
              // anunciava só o finalizado, escondendo o que falta fazer.
              const vinculosGrupo = c.adiantamentos
                .map((a) => statusPorAdto[a.docCod])
                .filter((v): v is NonNullable<typeof v> => v !== undefined)
              const vinculoGrupo =
                vinculosGrupo.find((v) => v.permutaStatus !== 'finalizado') ?? vinculosGrupo[0]
              return (
                <React.Fragment key={c.invoice.docCod}>
                  {/* Header da invoice — clicável, expande a micro-info dela */}
                  <TableRow
                    className={cn('cursor-pointer bg-muted/20', sep)}
                    aria-expanded={abertaInv}
                    onClick={() =>
                      setInvoiceExpandida((cur) =>
                        cur === c.invoice.docCod ? null : c.invoice.docCod,
                      )
                    }
                  >
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight
                          className={cn(
                            'size-4 text-muted-foreground transition-transform',
                            abertaInv && 'rotate-90',
                          )}
                          aria-hidden
                        />
                        {c.invoice.filCod}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {c.priCod}
                      <div className="text-xs font-normal text-muted-foreground">
                        {c.invoice.exportador}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Moeda valor={c.invoice.valorMoedaNegociada} moeda={c.invoice.moeda} />
                    </TableCell>
                    <TableCell
                      colSpan={3}
                      className="text-right text-xs text-muted-foreground"
                    >
                      {c.adiantamentos.length} adiantamento
                      {c.adiantamentos.length !== 1 ? 's' : ''} · usa{' '}
                      {formatNumber(totalUsado)} {moedaCodigo(moedaGrupo)}
                    </TableCell>
                    <TableCell className="text-right">
                      {todosProcessados ? (
                        <PermutaBorderoBadge vinculo={vinculoGrupo} />
                      ) : c.adiantamentos.length > 0 ? (
                        <Button
                          size="sm"
                          disabled={
                            !PROCESSAMENTO_HABILITADO ||
                            processando === c.invoice.docCod
                          }
                          title={
                            !PROCESSAMENTO_HABILITADO
                              ? 'Indisponível — aguardando write-back no Conexos'
                              : undefined
                          }
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmacao(c)
                          }}
                        >
                          {processando === c.invoice.docCod ? 'Processando…' : 'Processar'}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>

                  {/* Micro-info da invoice (expandido) */}
                  {abertaInv ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7} className="py-4">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                          <Campo label="Invoice (código)">{c.invoice.docCod}</Campo>
                          <Campo label="Referência">{c.invoice.referencia}</Campo>
                          <Campo label="Cliente">{c.invoice.importador ?? '—'}</Campo>
                          <Campo label="Exportador">{c.invoice.exportador}</Campo>
                          <Campo label="Filial">{c.invoice.filCod}</Campo>
                          <Campo label="Processo">{c.priCod}</Campo>
                          <Campo label="Valor (face)">
                            {c.invoice.valorBrl != null
                              ? `R$ ${formatNumber(c.invoice.valorBrl)}`
                              : '—'}
                          </Campo>
                          <Campo label="Valor moeda negociada">
                            <Moeda
                              valor={c.invoice.valorMoedaNegociada}
                              moeda={c.invoice.moeda}
                            />
                          </Campo>
                          <Campo label="Adiantamentos casados">
                            {c.adiantamentos.length} · usa {formatNumber(totalUsado)}{' '}
                            {moedaCodigo(moedaGrupo)}
                          </Campo>
                        </dl>
                      </TableCell>
                    </TableRow>
                  ) : null}

                  {/* Adiantamentos (filhos da invoice) */}
                  {c.adiantamentos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-sm text-muted-foreground">
                        Sem adiantamento sugerido ainda.
                      </TableCell>
                    </TableRow>
                  ) : (
                    c.adiantamentos.map((adto) => (
                      <TableRow key={adto.docCod}>
                        <TableCell />
                        <TableCell />
                        <TableCell />
                        <TableCell className="font-medium">{adto.docCod}</TableCell>
                        <TableCell className="text-right">
                          <Moeda valor={adto.valorASerUsado} moeda={adto.moeda} />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {adto.saldoRestante != null
                            ? `${formatNumber(adto.saldoRestante)} ${moedaCodigo(adto.moeda)}`
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {statusPorAdto[adto.docCod] === undefined &&
                          !temAlgoAProcessar(adto, statusPorAdto[adto.docCod]) ? (
                            // Sem borderô E sem nada a processar: "Pendente" seria mentira — a linha
                            // nunca vai rodar. Mostra o porquê (moeda diferente / sem saldo).
                            <span className="text-xs text-muted-foreground">
                              {motivoSemProcessar(adto, {
                                moedaInvoice: c.invoice.moeda,
                                vinculo: statusPorAdto[adto.docCod],
                              })}
                            </span>
                          ) : (
                            <PermutaBorderoBadge vinculo={statusPorAdto[adto.docCod]} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}
      <Paginacao aba={aba} />
    </>
  )
})

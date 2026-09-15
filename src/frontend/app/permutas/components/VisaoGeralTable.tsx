'use client'

import * as React from 'react'
import { ArrowLeftRight, ChevronRight, CircleCheckBig, Undo2 } from 'lucide-react'
import type { InvoiceEmAberto, PermutaPendente } from '@/lib/types'
import { cn, formatNumber, progressoPagamento } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  FILTRO_VAZIO_LABEL,
  type FiltroStatus,
  MOTIVO_LABEL,
  PAGE_SIZE,
  fmtData,
  fmtTaxa,
  moedaCodigo,
  podeMarcarExcecao,
  tagExcecao,
} from './format'
import { Campo, ExcecaoManualTag, Moeda, ProcessamentoBadge, StatusBadge } from './ui'

/**
 * Visão geral — adiantamentos pendentes OU invoices em aberto (dirigida pela `vista`).
 * Conteúdo do card principal: estado-vazio, a tabela e a paginação.
 */
export function VisaoGeralTable({
  vista,
  filtro,
  listaFiltrada,
  invoicesPagina,
  pendentesPagina,
  invoiceListExpandida,
  setInvoiceListExpandida,
  expandido,
  setExpandido,
  invoiceByAdto,
  abrirAlocar,
  abrirMarcarExcecao,
  abrirDesfazerExcecao,
  paginaAtual,
  totalPaginas,
  setPagina,
}: {
  vista: 'adiantamentos' | 'invoices'
  filtro: FiltroStatus
  listaFiltrada: (PermutaPendente | InvoiceEmAberto)[]
  invoicesPagina: InvoiceEmAberto[]
  pendentesPagina: PermutaPendente[]
  invoiceListExpandida: string | null
  setInvoiceListExpandida: React.Dispatch<React.SetStateAction<string | null>>
  expandido: string | null
  setExpandido: React.Dispatch<React.SetStateAction<string | null>>
  invoiceByAdto: Map<string, InvoiceEmAberto>
  abrirAlocar: (p: PermutaPendente) => void
  /** Abre o modal "Marcar como permutado fora do painel" (ADR-0047). */
  abrirMarcarExcecao: (p: PermutaPendente) => void
  /** Abre a confirmação "Desfazer exceção" (ADR-0047). */
  abrirDesfazerExcecao: (p: PermutaPendente) => void
  paginaAtual: number
  totalPaginas: number
  setPagina: React.Dispatch<React.SetStateAction<number>>
}) {
  return listaFiltrada.length === 0 ? (
    <EmptyState
      title={
        vista === 'invoices'
          ? 'Nenhuma invoice em aberto'
          : filtro === 'todos'
            ? 'Nenhum adiantamento pendente'
            : `Nenhum adiantamento ${FILTRO_VAZIO_LABEL[filtro]}`
      }
      description={
        vista === 'invoices'
          ? 'Não há invoices finalizadas em aberto para casar.'
          : filtro === 'todos'
            ? 'Não há PROFORMA aguardando permuta na última eleição.'
            : 'Ajuste o filtro nos cartões acima para ver os demais.'
      }
    />
  ) : (
    <>
      {vista === 'invoices' ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filial</TableHead>
              <TableHead>Referência Externa</TableHead>
              <TableHead>Processo</TableHead>
              <TableHead>Exportador</TableHead>
              <TableHead className="text-right">Valor Moeda Negociada</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoicesPagina.map((inv) => {
              const aberto = invoiceListExpandida === inv.docCod
              return (
                <React.Fragment key={inv.docCod}>
                  <TableRow
                    className="cursor-pointer"
                    aria-expanded={aberto}
                    onClick={() =>
                      setInvoiceListExpandida((cur) =>
                        cur === inv.docCod ? null : inv.docCod,
                      )
                    }
                  >
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight
                          className={cn(
                            'size-4 text-muted-foreground transition-transform',
                            aberto && 'rotate-90',
                          )}
                          aria-hidden
                        />
                        {inv.filCod}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {inv.referenciaExterna ?? inv.referencia}
                    </TableCell>
                    <TableCell>{inv.priCod ?? '—'}</TableCell>
                    <TableCell>{inv.exportador}</TableCell>
                    <TableCell className="text-right">
                      <Moeda valor={inv.valorMoedaNegociada} moeda={inv.moeda} />
                    </TableCell>
                  </TableRow>
                  {aberto ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={5} className="py-4">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                          <Campo label="Código">{inv.docCod}</Campo>
                          <Campo label="Processo">{inv.priCod ?? '—'}</Campo>
                          <Campo label="Referência">{inv.referencia}</Campo>
                          <Campo label="Data de emissão">{fmtData(inv.dataEmissao)}</Campo>
                          <Campo label="Cliente" className="sm:col-span-2">
                            {inv.importador ?? '—'}
                          </Campo>
                          <Campo label="Exportador" className="sm:col-span-2">
                            {inv.exportador}
                          </Campo>
                          <Campo label="Filial">{inv.filCod}</Campo>
                          <Campo label="Valor (face)">
                            {inv.valorBrl != null
                              ? `R$ ${formatNumber(inv.valorBrl)}`
                              : '—'}
                          </Campo>
                          <Campo label="Valor moeda negociada">
                            <Moeda valor={inv.valorMoedaNegociada} moeda={inv.moeda} />
                          </Campo>
                          <Campo label="Taxa">
                            {inv.taxa != null ? fmtTaxa(inv.taxa) : '—'}
                          </Campo>
                        </dl>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filial</TableHead>
              <TableHead>Referência Externa</TableHead>
              <TableHead>Exportador</TableHead>
              <TableHead className="text-right">Valor Moeda Negociada</TableHead>
              <TableHead className="text-right">Dias em Aberto</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendentesPagina.map((p) => {
              const aberto = expandido === p.docCod
              const d = p.detalhe
              // Saldo a permutar (mnyTitPermutar) vem em BRL; convertendo
              // pela taxa negociada dá o saldo na moeda negociada (USD/…).
              const saldoBrl = d?.valorPermutar
              const taxa = d?.taxaAdiantamento
              const saldoNeg =
                saldoBrl != null && taxa != null && taxa > 0 ? saldoBrl / taxa : null
              // Progresso de pagamento (ADR-0006): % pago + quanto falta —
              // exibido nos bloqueados por pagamento parcial (`nao-pago`).
              const prog = progressoPagamento(d?.valorTotal, d?.valorAberto, taxa)
              // Conta da variação cambial (só p/ casados): a classificação
              // sai de delta = principalMoeda × (taxaAdto − taxaInvoice).
              // O principalMoeda (valor negociado da invoice) é recuperado
              // exatamente de delta ÷ Δtaxa — o delta foi calculado assim.
              const taxaInv = d?.taxaInvoice
              const delta = d?.variacaoDelta
              const principalVar =
                delta != null && taxa != null && taxaInv != null && taxa !== taxaInv
                  ? delta / (taxa - taxaInv)
                  : null
              // Invoice casada + cobertura (adto / invoice) — quando parcial,
              // mostra que o adiantamento não supre a invoice inteira.
              const invCasada = invoiceByAdto.get(p.docCod)
              const cobertura =
                invCasada?.valorMoedaNegociada != null &&
                invCasada.valorMoedaNegociada > 0 &&
                p.valorMoedaNegociada != null &&
                p.valorMoedaNegociada < invCasada.valorMoedaNegociada
                  ? (p.valorMoedaNegociada / invCasada.valorMoedaNegociada) * 100
                  : null
              return (
                <React.Fragment key={p.docCod}>
                  <TableRow
                    className="cursor-pointer"
                    aria-expanded={aberto}
                    onClick={() =>
                      setExpandido((cur) => (cur === p.docCod ? null : p.docCod))
                    }
                  >
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronRight
                          className={cn(
                            'size-4 text-muted-foreground transition-transform',
                            aberto && 'rotate-90',
                          )}
                          aria-hidden
                        />
                        {p.filCod}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.referenciaExterna ?? p.referencia}
                    </TableCell>
                    <TableCell>{p.exportador}</TableCell>
                    <TableCell className="text-right">
                      <Moeda valor={p.valorMoedaNegociada} moeda={p.moeda} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.diasEmAberto ?? '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={p.status} motivo={p.motivoBloqueio} />
                        {tagExcecao(p) !== null ? (
                          <ExcecaoManualTag ativa={tagExcecao(p) === 'ativa'} />
                        ) : null}
                        {p.processamentoStatus ? (
                          <ProcessamentoBadge status={p.processamentoStatus} />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {aberto ? (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={6} className="py-4">
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                          <Campo label="Processo">{d?.priCod ?? '—'}</Campo>
                          <Campo label="Referência">{p.referencia}</Campo>
                          <Campo label="Cliente">{p.importador ?? '—'}</Campo>
                          <Campo label="Exportador">{p.exportador}</Campo>
                          <Campo label="Data de emissão">{fmtData(d?.dataEmissao)}</Campo>
                          <Campo label="Pago">{d?.pago ? 'Sim' : 'Não'}</Campo>
                          {prog ? (
                            <Campo label="Progresso de pagamento">
                              {prog.percentPago}% pago
                              <div className="text-xs font-normal text-muted-foreground">
                                falta R$ {formatNumber(prog.faltaBrl)}
                                {prog.faltaUsd != null
                                  ? ` (≈ ${formatNumber(prog.faltaUsd)} ${moedaCodigo(p.moeda)})`
                                  : ''}
                              </div>
                            </Campo>
                          ) : null}
                          <Campo label="Valor (face)">
                            {p.valorBrl != null ? `R$ ${formatNumber(p.valorBrl)}` : '—'}
                          </Campo>
                          <Campo label="Valor moeda negociada">
                            <Moeda valor={p.valorMoedaNegociada} moeda={p.moeda} />
                          </Campo>
                          <Campo
                            label={
                              !invCasada && p.candidatas && p.candidatas.length > 0
                                ? 'Invoices candidatas (N:M)'
                                : 'Invoice casada'
                            }
                            className={
                              !invCasada && p.candidatas && p.candidatas.length > 0
                                ? 'sm:col-span-2'
                                : undefined
                            }
                          >
                            {invCasada ? (
                              <>
                                <span className="text-muted-foreground">
                                  {invCasada.docCod}
                                </span>{' '}
                                ·{' '}
                                <Moeda
                                  valor={invCasada.valorMoedaNegociada}
                                  moeda={invCasada.moeda}
                                />
                                {cobertura != null ? (
                                  <div className="text-xs font-normal text-warning-foreground">
                                    parcial — adto cobre {formatNumber(cobertura)}%
                                  </div>
                                ) : null}
                              </>
                            ) : p.candidatas && p.candidatas.length > 0 ? (
                              <div className="space-y-0.5">
                                {p.candidatas.map((cand) => (
                                  <div key={cand.docCod}>
                                    <span className="text-muted-foreground">
                                      {cand.docCod}
                                    </span>{' '}
                                    ·{' '}
                                    <Moeda
                                      valor={cand.valorMoedaNegociada}
                                      moeda={cand.moeda}
                                    />
                                  </div>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </Campo>
                          <Campo label="Saldo a permutar">
                            {saldoNeg != null ? (
                              <>
                                {formatNumber(saldoNeg)} {moedaCodigo(p.moeda)}
                                {saldoBrl != null ? (
                                  <div className="text-xs font-normal text-muted-foreground">
                                    R$ {formatNumber(saldoBrl)}
                                  </div>
                                ) : null}
                              </>
                            ) : saldoBrl != null ? (
                              `R$ ${formatNumber(saldoBrl)}`
                            ) : (
                              '—'
                            )}
                          </Campo>
                          <Campo label="D.I / DUIMP">{d?.declaracao?.variante ?? '—'}</Campo>
                          <Campo label="Data-base (D.I/DUIMP)">
                            {fmtData(d?.declaracao?.dataBase)}
                          </Campo>
                          <Campo label="Taxa adiantamento">
                            {d?.taxaAdiantamento != null
                              ? fmtTaxa(d.taxaAdiantamento)
                              : '—'}
                          </Campo>
                          <Campo label="Taxa invoice">
                            {d?.taxaInvoice != null ? fmtTaxa(d.taxaInvoice) : '—'}
                          </Campo>
                          <Campo label="Variação cambial">
                            {d?.variacaoClassificacao ?? '—'}
                            {d?.variacaoResultado != null
                              ? ` · R$ ${formatNumber(d.variacaoResultado)}`
                              : ''}
                          </Campo>
                          {/* Motivo só aparece quando há bloqueio — elegíveis
                              não têm motivo (evita o "—" inútil). */}
                          {p.motivoBloqueio ? (
                            <Campo label="Motivo">
                              {MOTIVO_LABEL[p.motivoBloqueio] ?? p.motivoBloqueio}
                            </Campo>
                          ) : null}
                        </dl>
                        {/* Conta da variação cambial — converte o valor permutado
                            pelas 2 taxas e tira a diferença EM REAIS (igual à
                            planilha do analista). Só p/ casados (tem as 2 taxas). */}
                        {d?.variacaoClassificacao != null &&
                        principalVar != null &&
                        taxa != null &&
                        taxaInv != null &&
                        delta != null ? (
                          <div className="mt-3 space-y-0.5 rounded-md border bg-background/60 px-3 py-2 text-xs text-muted-foreground tabular-nums">
                            <div className="font-medium text-foreground">
                              Cálculo da variação cambial (em R$):
                            </div>
                            <div>
                              Adiantamento: {formatNumber(principalVar)}{' '}
                              {moedaCodigo(p.moeda)} × {fmtTaxa(taxa)} ={' '}
                              <span className="text-foreground">
                                R$ {formatNumber(principalVar * taxa)}
                              </span>
                            </div>
                            <div>
                              Invoice: {formatNumber(principalVar)} {moedaCodigo(p.moeda)} ×{' '}
                              {fmtTaxa(taxaInv)} ={' '}
                              <span className="text-foreground">
                                R$ {formatNumber(principalVar * taxaInv)}
                              </span>
                            </div>
                            <div>
                              Diferença ={' '}
                              <span className="font-medium text-foreground">
                                R$ {formatNumber(Math.abs(delta))}
                              </span>{' '}
                              →{' '}
                              <span className="font-medium text-foreground">
                                {d.variacaoClassificacao}
                              </span>{' '}
                              (variação{' '}
                              {d.variacaoClassificacao === 'JUROS' ? 'passiva' : 'ativa'})
                            </div>
                          </div>
                        ) : null}
                        {/* Exceção manual "permutado fora do painel" (ADR-0047): detalhe +
                            desfazer quando existe; ação de marcar só onde a guarda do
                            backend aceitaria (bloqueada / sem saldo a permutar). */}
                        {p.excecaoManual ? (
                          <div className="mt-3 rounded-md border bg-background/60 px-3 py-2">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                                Exceção manual
                                <ExcecaoManualTag ativa={p.excecaoManual.ativa} />
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => abrirDesfazerExcecao(p)}
                              >
                                <Undo2 aria-hidden /> Desfazer exceção
                              </Button>
                            </div>
                            {!p.excecaoManual.ativa ? (
                              <p className="mb-2 text-xs text-warning-foreground">
                                Não aplicada: o dado do ERP mudou e vale o estado calculado.
                              </p>
                            ) : null}
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                              <Campo label="Justificativa" className="col-span-2">
                                <span className="whitespace-pre-wrap font-normal">
                                  {p.excecaoManual.justificativa}
                                </span>
                              </Campo>
                              <Campo label="Autor">{p.excecaoManual.criadoPor}</Campo>
                              <Campo label="Data">{fmtData(p.excecaoManual.criadoEm)}</Campo>
                            </dl>
                          </div>
                        ) : podeMarcarExcecao(p) ? (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 px-3 py-2">
                            <span className="text-xs text-muted-foreground">
                              Permuta feita por baixas manuais no Conexos, fora do fluxo de
                              permuta? Registre a exceção com justificativa.
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => abrirMarcarExcecao(p)}
                            >
                              <CircleCheckBig aria-hidden /> Marcar como permutado fora do painel
                            </Button>
                          </div>
                        ) : null}
                        {/* Alocação manual cross-process (Fase 2) — só permuta-manual. */}
                        {p.status === 'permuta-manual' ? (
                          <div className="mt-3 rounded-md border bg-background/60 px-3 py-2">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-xs font-medium text-foreground">
                                Alocação manual (cross-process)
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Saldo restante:{' '}
                                {p.saldoRestante != null
                                  ? `${formatNumber(p.saldoRestante)} ${moedaCodigo(p.moeda)}`
                                  : '—'}
                              </span>
                            </div>
                            {p.alocacoes && p.alocacoes.length > 0 ? (
                              <ul className="mb-2 space-y-0.5 text-xs text-muted-foreground">
                                {p.alocacoes.map((al) => (
                                  <li key={al.invoiceDocCod}>
                                    invoice {al.invoiceDocCod}
                                    {al.invoicePriCod ? ` (proc ${al.invoicePriCod})` : ''} ·{' '}
                                    {formatNumber(al.valorAlocado)} {moedaCodigo(al.moeda ?? p.moeda)}
                                    {al.variacaoClassificacao && al.variacaoResultado != null
                                      ? ` · ${al.variacaoClassificacao} R$ ${formatNumber(al.variacaoResultado)}`
                                      : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mb-2 text-xs text-muted-foreground">
                                Nenhuma alocação ainda.
                              </p>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => abrirAlocar(p)}
                            >
                              <ArrowLeftRight aria-hidden /> Alocar invoice
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      )}
      <div className="flex flex-col gap-2 pt-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Mostrando {(paginaAtual - 1) * PAGE_SIZE + 1}–
          {Math.min(paginaAtual * PAGE_SIZE, listaFiltrada.length)} de{' '}
          {listaFiltrada.length}
        </span>
        {totalPaginas > 1 ? (
          <div className="flex items-center gap-2">
            <span>
              Página {paginaAtual} de {totalPaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            >
              Próxima
            </Button>
          </div>
        ) : null}
      </div>
    </>
  )
}

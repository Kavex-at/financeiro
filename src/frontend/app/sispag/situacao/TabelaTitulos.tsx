'use client'

import { Layers, Lock, LogOut } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  ColumnHeaderFilter,
  FiltroFaixaNumerica,
  FiltroMultipla,
  FiltroPeriodo,
  FiltroTexto,
} from '@/components/ui/column-header-filter'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ESTADO_PAGAMENTO, type TituloAPagar, type TituloRetidoPorCodigoBarras } from '@/lib/sispag'
import { cn, formatBRL } from '@/lib/utils'
import { FormaPagamentoBadge } from '../components/FormaPagamentoBadge'
import { rotuloLote } from '../components/loteDoTitulo'
import { TitulosRetidosBadge } from '../components/TitulosRetidosBadge'
import type { ResumoDesfecho } from '../components/sugestaoBoleto'
import { AcaoDoTitulo } from './AcaoDoTitulo'
import { ROTULO_DONO } from './rotulos'
import { descreverFiltros, type OpcoesDosFiltros } from './filtrosAtivos'
import { alternarTodosSituacao, estadoSelecionarTodosSituacao, motivoNaoSelecionavel, selecionavel } from './selecao'
import {
  CLASSE_LINHA_ATIVA,
  chaveDoTitulo,
  classeDaColunaComGaveta,
  type ColunaTitulo,
  donoDe,
  FAIXAS_VENCIMENTO,
  haFiltroAtivo,
  ROTULO_FAIXA,
  layoutComGaveta,
  rotuloSituacao,
} from './situacaoTitulos'
import type { TabelaTitulosEstado } from './useTabelaTitulos'
import { PaginacaoTabela } from '../components/filtros/PaginacaoTabela'
import { PilulasFiltroAtivo } from '../components/filtros/PilulasFiltroAtivo'
import { VencimentoCelula } from './VencimentoCelula'

/**
 * Tabela de títulos a pagar com situação de pagamento (ADR-0075): filtro e ordenação no cabeçalho
 * de TODAS as colunas, linha bloqueada sem caixa de seleção (cadeado + motivo + dono + botão da
 * ação) e as mesmas marcações de lote/retido da tela anterior. Só desenha: as regras estão em
 * `situacaoTitulos.ts` e o estado em `useTabelaTitulos`.
 */
export function TabelaTitulos({
  tabela,
  opcoes,
  totalNaLista,
  selecionados,
  onSelecionados,
  podeExecutar,
  busy,
  retidos,
  resumoDoDesfecho,
  onAbrirSugestao,
  onVerBoleto,
  onIrParaLote,
  onRetirar,
  onResolvido,
  tituloAtivo,
  gavetaAberta = false,
}: {
  tabela: TabelaTitulosEstado
  opcoes: OpcoesDosFiltros
  /** Quantos títulos a lista tem antes dos filtros (para "Mostrando X de Y"). */
  totalNaLista: number
  selecionados: ReadonlySet<string>
  onSelecionados: (next: Set<string>) => void
  podeExecutar: boolean
  busy: boolean
  retidos: ReadonlyMap<string, TituloRetidoPorCodigoBarras>
  resumoDoDesfecho: (t: TituloAPagar) => ResumoDesfecho | undefined
  onAbrirSugestao: (t: TituloAPagar) => void
  onVerBoleto: (t: TituloAPagar) => void
  onIrParaLote: (loteId: string) => void
  onRetirar: (t: TituloAPagar) => void
  onResolvido: () => void | Promise<void>
  /** Chave `fil:doc:tit` do título aberto na gaveta dos boletos: a linha fica marcada. */
  tituloAtivo?: string | null
  /**
   * Gaveta dos boletos aberta: entre `xl` e `2xl` a tabela fica compacta e as colunas de baixa
   * prioridade saem (`layoutComGaveta`), para o essencial não ficar sob a gaveta.
   */
  gavetaAberta?: boolean
}) {
  const { filtros, ordenacao, filtrados, slice } = tabela
  const todos = estadoSelecionarTodosSituacao(filtrados, selecionados)
  const resumo = `${filtrados.length.toLocaleString('pt-BR')} resultado(s)`
  const direcao = (c: ColunaTitulo) => (ordenacao.coluna === c ? ordenacao.direcao : null)
  const layout = layoutComGaveta(gavetaAberta)
  const comum = (c: ColunaTitulo) => ({
    className: cn(layout.cabecalho, classeDaColunaComGaveta(c, gavetaAberta)),
    direcao: direcao(c),
    onOrdenar: (d: 1 | -1) => tabela.ordenar(c, d),
    resumo,
  })
  const etiquetas = descreverFiltros(filtros)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status" aria-live="polite">
          Mostrando {filtrados.length.toLocaleString('pt-BR')} de{' '}
          {totalNaLista.toLocaleString('pt-BR')} títulos
        </span>
        {haFiltroAtivo(filtros) ? (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={tabela.limpar}>
            Limpar filtros
          </Button>
        ) : null}
      </div>
      <PilulasFiltroAtivo
        etiquetas={etiquetas}
        onRemover={(id) => {
          const e = etiquetas.find((x) => x.id === id)
          if (e) tabela.atualizar(e.remover)
        }}
      />

      {filtrados.length === 0 ? (
        <div role="status" className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Nenhum título com estes filtros</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={tabela.limpar}>
            Limpar filtros
          </Button>
        </div>
      ) : (
        <div className={cn('overflow-x-auto rounded-lg border', layout.tabela)}>
          <Table>
            <TableHeader>
              <TableRow>
                {podeExecutar ? (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={todos.marcado}
                      disabled={todos.bloqueio !== undefined}
                      onCheckedChange={() => onSelecionados(alternarTodosSituacao(todos, selecionados))}
                      aria-label={
                        todos.bloqueio ??
                        `Selecionar os ${todos.chaves.length} títulos prontos do filtro`
                      }
                      title={
                        todos.bloqueio ??
                        `Seleciona os ${todos.chaves.length} títulos prontos do filtro, em todas as páginas.`
                      }
                    />
                  </TableHead>
                ) : null}
                <ColumnHeaderFilter
                  label="Credor"
                  {...comum('credor')}
                  ativo={filtros.credor !== ''}
                  onLimpar={() => tabela.atualizar({ credor: '' })}
                >
                  <FiltroTexto label="Credor" valor={filtros.credor} onChange={(credor) => tabela.atualizar({ credor })} />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Documento"
                  {...comum('documento')}
                  ativo={filtros.documento !== ''}
                  onLimpar={() => tabela.atualizar({ documento: '' })}
                >
                  <FiltroTexto
                    label="Documento"
                    valor={filtros.documento}
                    placeholder="Ex.: 5544/1"
                    onChange={(documento) => tabela.atualizar({ documento })}
                  />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Nº doc"
                  {...comum('numeroDocumento')}
                  ativo={filtros.numeroDocumento !== ''}
                  onLimpar={() => tabela.atualizar({ numeroDocumento: '' })}
                >
                  <FiltroTexto
                    label="Nº do documento do fornecedor"
                    valor={filtros.numeroDocumento}
                    placeholder="Ex.: 25349"
                    onChange={(numeroDocumento) => tabela.atualizar({ numeroDocumento })}
                  />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Valor"
                  align="right"
                  rotulosOrdem={['Menor primeiro', 'Maior primeiro']}
                  {...comum('valor')}
                  ativo={filtros.valorMin !== '' || filtros.valorMax !== ''}
                  onLimpar={() => tabela.atualizar({ valorMin: '', valorMax: '' })}
                >
                  <FiltroFaixaNumerica
                    label="Valor"
                    min={filtros.valorMin}
                    max={filtros.valorMax}
                    onChange={({ min, max }) => tabela.atualizar({ valorMin: min, valorMax: max })}
                  />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Vencimento"
                  rotulosOrdem={['Mais antigo', 'Mais novo']}
                  {...comum('vencimento')}
                  ativo={filtros.faixas.length > 0 || filtros.vencDe !== '' || filtros.vencAte !== ''}
                  onLimpar={() => tabela.atualizar({ faixas: [], vencDe: '', vencAte: '' })}
                >
                  <FiltroPeriodo
                    label="Vencimento"
                    de={filtros.vencDe}
                    ate={filtros.vencAte}
                    onChange={({ de, ate }) => tabela.atualizar({ vencDe: de, vencAte: ate })}
                  />
                  <FiltroMultipla
                    label="Vencimento"
                    opcoes={FAIXAS_VENCIMENTO.map((f) => ({ valor: f, rotulo: ROTULO_FAIXA[f] }))}
                    selecionadas={filtros.faixas}
                    onChange={(faixas) => tabela.atualizar({ faixas })}
                  />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Forma de pagamento"
                  {...comum('forma')}
                  ativo={filtros.formas.length > 0}
                  onLimpar={() => tabela.atualizar({ formas: [] })}
                >
                  <FiltroMultipla
                    label="Forma de pagamento"
                    opcoes={opcoes.formas.map((o) => ({ valor: o.valor, rotulo: o.rotulo, total: o.total }))}
                    selecionadas={filtros.formas}
                    onChange={(formas) => tabela.atualizar({ formas })}
                  />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Situação"
                  rotulosOrdem={['Prontos primeiro', 'Bloqueados primeiro']}
                  {...comum('situacao')}
                  ativo={filtros.situacoes.length > 0}
                  onLimpar={() => tabela.atualizar({ situacoes: [] })}
                >
                  <FiltroMultipla
                    label="Situação"
                    opcoes={opcoes.situacoes}
                    selecionadas={filtros.situacoes}
                    onChange={(situacoes) => tabela.atualizar({ situacoes })}
                  />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Próxima ação"
                  {...comum('acao')}
                  ativo={filtros.donos.length > 0}
                  onLimpar={() => tabela.atualizar({ donos: [] })}
                >
                  <FiltroMultipla
                    label="Quem resolve"
                    opcoes={opcoes.donos.map((o) => ({
                      valor: o.valor,
                      rotulo: `Quem resolve: ${o.rotulo}`,
                      total: o.total,
                    }))}
                    selecionadas={filtros.donos}
                    onChange={(donos) => tabela.atualizar({ donos })}
                  />
                </ColumnHeaderFilter>
                <ColumnHeaderFilter
                  label="Filial"
                  {...comum('filial')}
                  rotulosOrdem={['Menor primeiro', 'Maior primeiro']}
                  ativo={filtros.filiais.length > 0}
                  onLimpar={() => tabela.atualizar({ filiais: [] })}
                >
                  <FiltroMultipla
                    label="Filial"
                    opcoes={opcoes.filiais}
                    selecionadas={filtros.filiais}
                    onChange={(filiais) => tabela.atualizar({ filiais })}
                  />
                </ColumnHeaderFilter>
              </TableRow>
            </TableHeader>
            <TableBody>
              {slice.map((t) => {
                const chave = chaveDoTitulo(t)
                const bloqueado = t.situacaoPagamento?.estado === ESTADO_PAGAMENTO.BLOQUEADO
                const motivo = motivoNaoSelecionavel(t)
                const retido = retidos.get(chave)
                const acaoPropria = t.situacaoPagamento?.acao
                const ativo = tituloAtivo === chave
                return (
                  <TableRow
                    key={chave}
                    aria-current={ativo ? 'true' : undefined}
                    className={
                      ativo
                        ? CLASSE_LINHA_ATIVA
                        : bloqueado
                          ? 'bg-danger-subtle/20'
                          : undefined
                    }
                  >
                    {podeExecutar ? (
                      <TableCell>
                        {bloqueado ? (
                          <Lock
                            className="size-4 text-muted-foreground"
                            aria-label={motivo ?? 'Bloqueado'}
                            role="img"
                          />
                        ) : (
                          <Checkbox
                            checked={selecionados.has(chave)}
                            disabled={!selecionavel(t)}
                            onCheckedChange={() => {
                              const next = new Set(selecionados)
                              if (next.has(chave)) next.delete(chave)
                              else next.add(chave)
                              onSelecionados(next)
                            }}
                            aria-label={motivo ?? `Selecionar o título ${t.docCod}/${t.titCod}`}
                            title={motivo}
                          />
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell
                      className={cn('max-w-[18rem] truncate font-medium', layout.credor)}
                      title={t.credor}
                    >
                      <span className={t.loteRascunho || t.loteComprometido ? 'text-muted-foreground' : undefined}>
                        {t.credor ?? '—'}
                      </span>
                      {t.loteRascunho ? (
                        <Button
                          variant="link"
                          size="sm"
                          className="ml-2 h-auto p-0 text-xs"
                          onClick={() => t.loteRascunho && onIrParaLote(t.loteRascunho.id)}
                          title="Abrir o lote em que este título está."
                        >
                          <Layers className="size-3" aria-hidden />
                          {rotuloLote(t.loteRascunho)}
                        </Button>
                      ) : t.loteComprometido ? (
                        <Badge variant="outline" className="ml-2 border-muted text-muted-foreground">
                          <Lock className="mr-1 size-3" aria-hidden />
                          {t.loteComprometido.status === 'FINALIZADO' ? 'lote finalizado' : 'remessa gerada'}
                        </Badge>
                      ) : null}
                      {retido ? (
                        <TitulosRetidosBadge
                          retido={retido}
                          podeDesfazer={podeExecutar}
                          onDesfeito={onResolvido}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.docCod}/{t.titCod}
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {t.numeroDocumento ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(t.valor)}</TableCell>
                    <TableCell>
                      <VencimentoCelula
                        vencimento={t.vencimento}
                        dias={t.diasAteVencimento}
                        titulo={t}
                      />
                    </TableCell>
                    <TableCell className={layout.quebra}>
                      <FormaPagamentoBadge
                        titulo={t}
                        sugestao={resumoDoDesfecho(t)}
                        onAbrirSugestao={() => onAbrirSugestao(t)}
                      />
                    </TableCell>
                    <TableCell className={classeDaColunaComGaveta('situacao', gavetaAberta)}>
                      <div className="flex flex-col items-start gap-1">
                        <Badge
                          variant="outline"
                          className={
                            bloqueado ? 'border-danger/40 text-danger-foreground' : 'border-success/40 text-success-foreground'
                          }
                        >
                          {rotuloSituacao(t)}
                        </Badge>
                        {t.situacaoPagamento?.detalhe ? (
                          <span className="text-xs text-muted-foreground">{t.situacaoPagamento.detalhe}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className={classeDaColunaComGaveta('acao', gavetaAberta)}>
                      <div className="flex flex-col items-start gap-1">
                        {bloqueado && acaoPropria ? (
                          <>
                            <AcaoDoTitulo
                              titulo={t}
                              podeExecutar={podeExecutar}
                              onVerBoleto={onVerBoleto}
                              onResolvido={onResolvido}
                            />
                            <span className="text-xs text-muted-foreground">
                              resolve: {ROTULO_DONO[donoDe(t)].toLowerCase()}
                            </span>
                          </>
                        ) : bloqueado ? (
                          <span className="text-xs text-muted-foreground">
                            resolve: {ROTULO_DONO[donoDe(t)].toLowerCase()}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Pode entrar em lote</span>
                        )}
                        {t.loteRascunho && podeExecutar ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => onRetirar(t)}
                          >
                            <LogOut className="size-4" aria-hidden /> Retirar do lote
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn('text-muted-foreground', classeDaColunaComGaveta('filial', gavetaAberta))}
                    >
                      {t.filCod}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <PaginacaoTabela
        pagina={tabela.pagina}
        pageSize={tabela.pageSize}
        total={filtrados.length}
        onPagina={tabela.setPagina}
      />
    </div>
  )
}

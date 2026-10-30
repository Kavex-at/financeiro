'use client'

import { ChevronDown, Copy } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ColumnHeaderFilter,
  FiltroFaixaNumerica,
  FiltroMultipla,
  FiltroPeriodo,
  FiltroTexto,
} from '@/components/ui/column-header-filter'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type {
  BoletoDda,
  BoletoDdaColuna,
  BoletoDdaFiltroFilial,
  BoletoDdaSituacao,
  BoletoDdaTitulo,
  BoletosDdaResposta,
} from '@/lib/sispag'
import { cn, formatBRL } from '@/lib/utils'
import { DiferencaBadge, fmtCivil, resumoCandidatos } from '../components/CandidatosBoletoDialog'
import { GrupoBoletoDaFilial } from '../components/GrupoBoletoDaFilial'
import { PaginacaoTabela } from '../components/filtros/PaginacaoTabela'
import { PilulasFiltroAtivo } from '../components/filtros/PilulasFiltroAtivo'
import { FAIXAS_VENCIMENTO, ROTULO_FAIXA } from '../situacao/situacaoTitulos'
import {
  BOLETOS_DDA_POR_PAGINA,
  descreverFiltrosDda,
  haFiltroDda,
  rotuloDaSituacao,
  rotuloFilial,
  totalDe,
} from './filtrosBoletosDda'
import { badgeDaSituacao } from './rotulosDda'
import type { TabelaBoletosDdaEstado } from './useTabelaBoletosDda'

const SITUACOES: readonly BoletoDdaSituacao[] = [
  'VINCULADO',
  'CANDIDATO',
  'AMBIGUO',
  'FORA_JANELA',
  'SEM_TITULO',
  'TITULO_SAIU_CARTEIRA',
]
const COLUNAS = 8

function TituloLinha({ t, flpCod }: { t: BoletoDdaTitulo; flpCod?: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="max-w-[16rem] truncate font-medium">{t.credor ?? '—'}</span>
      <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>
          {t.docCod}/{t.titCod} · fil {t.filCod}
          {t.vencimento ? ` · vence ${fmtCivil(t.vencimento)}` : ''}
          {flpCod !== undefined ? ` · lote fin015 ${flpCod}` : ''}
        </span>
        <DiferencaBadge dias={t.diferencaDias} />
        {t.lote ? (
          <Badge variant="outline" className="border-muted text-muted-foreground">
            lote {t.lote.status.toLowerCase()}
          </Badge>
        ) : null}
      </span>
    </div>
  )
}

/**
 * Tabela da aba Boletos DDA no padrão de `TabelaTitulos`: filtro e ordenação no cabeçalho de
 * todas as colunas (tudo no SERVIDOR), etiquetas dos filtros ativos, "Mostrando X de Y" e a
 * paginação comum. A linha de grupo abre os títulos do grupo (I21v).
 */
export function TabelaBoletosDda({
  tabela,
  dados,
  carregando,
  podeExecutar,
  onCompor,
  onVerCandidatos,
  onCopiar,
  onGrupoAlterado,
}: {
  tabela: TabelaBoletosDdaEstado
  dados: BoletosDdaResposta
  carregando: boolean
  podeExecutar: boolean
  onCompor?: (b: BoletoDda) => void
  onVerCandidatos: (b: BoletoDda) => void
  onCopiar: (b: BoletoDda) => void
  onGrupoAlterado: () => void | Promise<void>
}) {
  const { filtros, ordem } = tabela
  const [abertos, setAbertos] = React.useState<ReadonlySet<string>>(new Set())
  const total = dados.total
  const noEscopo = dados.facetas
    ? dados.facetas.filiais.reduce((a, f) => a + f.qtd, dados.facetas.semFilial)
    : totalDe(dados, 'todas').qtd
  const resumo = `${total.toLocaleString('pt-BR')} resultado(s)`
  const comum = (c: BoletoDdaColuna) => ({
    direcao: ordem?.coluna === c ? ordem.direcao : null,
    onOrdenar: (d: 1 | -1) => tabela.ordenar(c, d),
    resumo,
  })
  const etiquetas = descreverFiltrosDda(filtros)
  const alternarAberto = (k: string) =>
    setAbertos((atual) => {
      const next = new Set(atual)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const opcoesFiliais: Array<{ valor: BoletoDdaFiltroFilial; rotulo: string; total: number }> = [
    ...(dados.facetas?.filiais ?? dados.filiais.map((valor) => ({ valor, qtd: 0 }))).map((f) => ({
      valor: f.valor as BoletoDdaFiltroFilial,
      rotulo: `Filial ${f.valor}`,
      total: f.qtd,
    })),
    ...(dados.facetas && dados.facetas.semFilial > 0
      ? [{ valor: 'sem' as const, rotulo: 'Sem filial', total: dados.facetas.semFilial }]
      : []),
  ]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span role="status" aria-live="polite">
          Mostrando {total.toLocaleString('pt-BR')}
          {noEscopo !== undefined ? ` de ${noEscopo.toLocaleString('pt-BR')}` : ''} boletos
        </span>
        {haFiltroDda(filtros) ? (
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

      <div
        className={cn('overflow-x-auto rounded-lg border transition-opacity', carregando && 'opacity-60')}
        aria-busy={carregando}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <ColumnHeaderFilter
                label="Situação"
                rotulosOrdem={['Casados primeiro', 'Sem título primeiro']}
                {...comum('situacao')}
                ativo={filtros.situacoes.length > 0}
                onLimpar={() => tabela.atualizar({ situacoes: [] })}
              >
                <FiltroMultipla
                  label="Situação"
                  opcoes={SITUACOES.map((s) => ({
                    valor: s,
                    rotulo: rotuloDaSituacao(s),
                    ...(totalDe(dados, s).qtd !== undefined ? { total: totalDe(dados, s).qtd } : {}),
                  }))}
                  selecionadas={filtros.situacoes}
                  onChange={(situacoes) => tabela.atualizar({ situacoes })}
                />
              </ColumnHeaderFilter>
              <ColumnHeaderFilter
                label="Boleto"
                {...comum('numero')}
                ativo={filtros.numero.trim() !== ''}
                onLimpar={() => tabela.atualizar({ numero: '' })}
              >
                <FiltroTexto
                  label="Boleto"
                  valor={filtros.numero}
                  placeholder="Nº do boleto"
                  onChange={(numero) => tabela.atualizar({ numero })}
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
                label="Banco"
                rotulosOrdem={['Menor primeiro', 'Maior primeiro']}
                {...comum('banco')}
                ativo={filtros.bancos.length > 0}
                onLimpar={() => tabela.atualizar({ bancos: [] })}
              >
                <FiltroMultipla
                  label="Banco"
                  opcoes={(dados.facetas?.bancos ?? []).map((b) => ({
                    valor: b.valor,
                    rotulo: `Banco ${b.valor}`,
                    total: b.qtd,
                  }))}
                  selecionadas={filtros.bancos}
                  onChange={(bancos) => tabela.atualizar({ bancos })}
                />
              </ColumnHeaderFilter>
              <ColumnHeaderFilter
                label="Título"
                {...comum('titulo')}
                ativo={filtros.titulo.trim() !== ''}
                onLimpar={() => tabela.atualizar({ titulo: '' })}
              >
                <FiltroTexto
                  label="Título"
                  valor={filtros.titulo}
                  placeholder="Credor ou documento (ex.: 5046/1)"
                  onChange={(titulo) => tabela.atualizar({ titulo })}
                />
              </ColumnHeaderFilter>
              <ColumnHeaderFilter
                label="Filial"
                rotulosOrdem={['Menor primeiro', 'Maior primeiro']}
                {...comum('filial')}
                ativo={filtros.filiais.length > 0}
                onLimpar={() => tabela.atualizar({ filiais: [] })}
              >
                <FiltroMultipla<BoletoDdaFiltroFilial>
                  label="Filial"
                  opcoes={opcoesFiliais}
                  selecionadas={filtros.filiais}
                  onChange={(filiais) => tabela.atualizar({ filiais })}
                />
              </ColumnHeaderFilter>
              <TableHead className="w-10">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dados.boletos.map((b) => {
              const badge = badgeDaSituacao(b.situacao)
              // Na linha vai no máximo UM título (o vínculo ou o candidato mais próximo); o
              // resto de um ambíguo abre no modal — senão a linha vira uma coluna de cartões.
              const principal = b.vinculo ?? b.candidatos[0] ?? b.titulosSaidos?.[0]
              const extras = b.vinculo ? 0 : b.candidatos.length - 1
              const chaveLinha = `${b.ddcCod}:${b.ditCod}`
              const aberto = abertos.has(chaveLinha)
              return (
                <React.Fragment key={chaveLinha}>
                  <TableRow>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant="outline" className={badge.className} title={badge.title}>
                          {badge.label}
                        </Badge>
                        {b.grupo ? (
                          <Button
                            size="sm"
                            variant="link"
                            className="h-auto p-0 text-xs"
                            aria-expanded={aberto}
                            aria-controls={`grupo-${b.ddcCod}-${b.ditCod}`}
                            onClick={() => alternarAberto(chaveLinha)}
                            aria-label={`${aberto ? 'Esconder' : 'Ver'} os ${b.grupo.nTitulos} títulos do grupo do boleto ${b.numero ?? b.ditCod}`}
                          >
                            <ChevronDown
                              className={cn('size-3 transition-transform', aberto && 'rotate-180')}
                              aria-hidden
                            />
                            {b.grupo.estado === 'CONFIRMADO' ? 'Grupo confirmado' : 'Grupo sugerido'}
                            {' · '}
                            {b.grupo.nTitulos} títulos
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium tabular-nums">{b.numero ?? '—'}</span>
                        <span className="text-xs text-muted-foreground" title={b.arquivo}>
                          fin124 #{b.ddcCod}
                          {b.importadoEm
                            ? ` · ${new Date(b.importadoEm).toLocaleDateString('pt-BR')}`
                            : ''}
                          {b.arquivos > 1 ? ` · em ${b.arquivos} arquivos` : ''}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(b.valor)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">{fmtCivil(b.vencimento)}</span>
                        {b.vencido ? (
                          <Badge variant="outline" className="border-danger/40 text-danger">
                            vencido
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {b.bancoEmissor ?? '—'}
                    </TableCell>
                    <TableCell>
                      {principal === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <TituloLinha t={principal} flpCod={b.vinculo?.flpCod} />
                          {extras > 0 ? (
                            <Button
                              size="sm"
                              variant="link"
                              className="h-auto p-0 text-xs"
                              onClick={() => onVerCandidatos(b)}
                              aria-label={`Ver os ${b.candidatos.length} títulos candidatos do boleto ${b.numero ?? b.ditCod}`}
                            >
                              {resumoCandidatos(b.candidatos)}
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {b.filial !== undefined ? b.filial : rotuloFilial('sem')}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {onCompor &&
                        b.situacao !== 'VINCULADO' &&
                        !b.vencido &&
                        b.codbar &&
                        b.grupo?.estado !== 'CONFIRMADO' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onCompor(b)}
                            aria-label={`Compor com títulos o boleto ${b.numero ?? b.ditCod}`}
                          >
                            Compor com títulos
                          </Button>
                        ) : null}
                        {b.linhaDigitavel ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => onCopiar(b)}
                            aria-label={`Copiar linha digitável do boleto ${b.numero ?? b.ditCod}`}
                            title="Copiar linha digitável"
                          >
                            <Copy className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {b.grupo && aberto ? (
                    <TableRow>
                      <TableCell colSpan={COLUNAS} id={`grupo-${b.ddcCod}-${b.ditCod}`}>
                        <GrupoBoletoDaFilial
                          filCod={b.grupo.filCod}
                          onde={{ tipo: 'boleto', ddcCod: b.ddcCod, ditCod: b.ditCod }}
                          podeExecutar={podeExecutar}
                          onAlterado={onGrupoAlterado}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </React.Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>
      <PaginacaoTabela
        pagina={dados.pagina}
        pageSize={dados.tamanho || BOLETOS_DDA_POR_PAGINA}
        total={total}
        onPagina={tabela.setPagina}
      />
    </div>
  )
}

'use client'

import * as React from 'react'
import { AlertTriangle, FileText } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/ui/empty-state'
import { formatBRL } from '@/lib/utils'
import type { NotaDebitoEletronica } from '@/lib/recebimentos'
import { FiltroBarra, Paginacao, useTabelaFiltro } from '@/app/permutas/components/tabela-filtro'
import {
  NdeStatusBadge,
  OrigemErpBadge,
  RevisaoHumanaBadge,
  SefazBadge,
} from './status-badges'

/** Formata uma data ISO (ou undefined) para pt-BR curta. */
const fmtData = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—'

/** Rótulo legível da etapa da trilha fiscal — o "onde parou" de uma NDe que não saiu. */
const ETAPA_ROTULO: Record<string, string> = {
  'nota-debito': 'documento gerado',
  'fiscal-done': 'tipo de nota setado',
  'obs-done': 'observações geradas',
  homologado: 'homologada',
  concluido: 'concluída',
}

/**
 * Aba NDe — as Notas de Débito Eletrônica das filiais que o analista pode ver.
 *
 * A lista é dirigida pela EXECUÇÃO da alocação, não pela tabela local de NDe: uma linha é um
 * documento com297 que existe (ou deveria existir) no ERP. Por isso aparecem aqui tanto as notas
 * emitidas quanto as que o ERP começou e não terminou — que são justamente as que pedem ação.
 *
 * Emissão e autorização ficam em colunas SEPARADAS de propósito: "aguardando SEFAZ" é o curso
 * normal de uma NDe recém-emitida, não uma falha, e juntar as duas convidaria a reprocessar à toa.
 * READ-ONLY: o painel relê o Conexos a cada carga, mas nada aqui escreve no ERP.
 */
export function NdeTable({ ndes }: { ndes: NotaDebitoEletronica[] }) {
  const aba = useTabelaFiltro(
    ndes,
    (n) => n.filCod,
    (n) =>
      `${n.numeroNde ?? ''} ${n.ndDocCod ?? ''} ${n.correlationId ?? ''} ${n.statusEmissao} ${
        n.etapa ?? ''
      } ${n.cliente ?? ''} ${n.processoRef ?? ''} ${n.priCod ?? ''}`,
  )

  if (ndes.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="size-6" aria-hidden />}
        title="Nenhuma NDe"
        description="As Notas de Débito Eletrônica aparecem aqui quando um recebimento é executado."
      />
    )
  }

  return (
    <div className="space-y-3">
      <FiltroBarra
        aba={aba}
        buscaPlaceholder="Buscar por nº NDe, docCod, cliente, processo ou status…"
      />
      {aba.total === 0 ? (
        <EmptyState
          icon={<FileText className="size-6" aria-hidden />}
          title="Nenhuma NDe para o filtro"
          description="Ajuste a filial ou a busca acima."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº NDe</TableHead>
                <TableHead>Cliente / processo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Filial</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>SEFAZ</TableHead>
                <TableHead>Emitida em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aba.slice.map((n) => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">
                    {n.numeroNde ?? <span className="text-muted-foreground">—</span>}
                    {/* O docCod é o handle que abre o documento no Conexos — para uma NDe sem
                        número (SEFAZ ainda não voltou) é o ÚNICO jeito de achá-la no ERP. */}
                    {n.ndDocCod !== undefined && (
                      <div className="font-mono text-xs font-normal text-muted-foreground">
                        doc {n.ndDocCod}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[22rem]">
                    {n.cliente !== undefined ? (
                      <span className="block truncate" title={n.cliente}>
                        {n.cliente}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {(n.processoRef ?? n.priCod) !== undefined && (
                      <div className="text-xs text-muted-foreground">
                        {n.processoRef ?? `processo ${String(n.priCod)}`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBRL(n.valor)}</TableCell>
                  <TableCell className="text-muted-foreground">{n.filCod}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <NdeStatusBadge status={n.statusEmissao} />
                      {n.origem === 'erp' && <OrigemErpBadge />}
                      {n.revisaoHumana === true && <RevisaoHumanaBadge />}
                    </div>
                    {/* Para a NDe que não fechou, a etapa é o diagnóstico: diz onde retomar. */}
                    {n.statusEmissao !== 'emitida' && n.etapa !== undefined && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        parou em: {ETAPA_ROTULO[n.etapa] ?? n.etapa}
                      </div>
                    )}
                    {/* Ícone + texto, nunca só cor (DS princípio 8 / WCAG 2.1 AA). */}
                    {n.erroMensagem !== undefined && (
                      <div className="mt-1 flex items-start gap-1.5 text-xs text-danger">
                        <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                        <span title={n.erroMensagem}>{n.erroMensagem}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {/* Mostra o chip quando a nota saiu OU quando o ERP diz que o SEFAZ autorizou.
                        A segunda metade cobre o descasamento real: a homologação pode ter
                        acontecido no ERP sem a nossa linha de NDe ter sido gravada (a execução
                        morreu entre uma coisa e outra). Esconder a autorização nesse caso faria a
                        tela negar um fato fiscal — melhor mostrar "pendente" + "autorizada" e
                        deixar o descasamento visível. */}
                    {n.statusEmissao === 'emitida' || n.ndeAutorizado === true ? (
                      <SefazBadge autorizado={n.ndeAutorizado} />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtData(n.emitidaEm)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Paginacao aba={aba} />
    </div>
  )
}

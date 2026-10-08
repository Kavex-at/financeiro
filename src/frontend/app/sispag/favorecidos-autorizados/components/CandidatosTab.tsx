'use client'

import { Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
  type CandidatoAutorizacao,
  listarCandidatosAutorizacao,
  type ModalidadeAutorizavel,
  type RelatorioCandidatos,
  ROTULO_ESTADO_AUTORIZACAO,
} from '@/lib/sispag'
import { formatarData } from './formatar'
import { type PedidoInicial, SolicitarAutorizacaoDialog } from './SolicitarAutorizacaoDialog'

const LIMITE = 20
const MODALIDADES: ModalidadeAutorizavel[] = ['TED', 'PIX']

const ROTULO_GRUPO: Record<string, string> = {
  TED_PIX: 'TED/PIX',
  BOLETO: 'boleto',
  OUTROS: 'outros',
}

const ROTULO_CADASTRO: Record<string, string> = {
  SIM: 'tem',
  NAO: 'não tem',
  FALHA_LEITURA: 'não lido',
}

const rotuloEstado = (e: CandidatoAutorizacao['autorizacao']['TED']['estado']): string =>
  e === 'NENHUMA' ? 'sem autorização' : ROTULO_ESTADO_AUTORIZACAO[e]

/**
 * Relatório de candidatos à autorização (ADR-0065, read-only): favorecidos pagos por TED/PIX ou
 * com perfil TED/PIX, o que o cadastro do Conexos tem e o estado da autorização. A única ação é
 * PEDIR (`sispag:executar`); aprovar é sempre na aba de autorizações, por outra pessoa. Nenhum
 * destino aparece aqui — só se existe.
 */
export function CandidatosTab({ podePedir }: { podePedir: boolean }) {
  const [pagina, setPagina] = React.useState(1)
  const [rel, setRel] = React.useState<RelatorioCandidatos | null>(null)
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<string | null>(null)
  const [pedido, setPedido] = React.useState<PedidoInicial | null>(null)

  React.useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    listarCandidatosAutorizacao({ pagina, limite: LIMITE })
      .then((r) => {
        if (vivo) setRel(r)
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar o relatório.')
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [pagina])

  const marcarPendente = (pesCod: string, modalidade: ModalidadeAutorizavel, id: string) =>
    setRel((r) =>
      r
        ? {
            ...r,
            candidatos: r.candidatos.map((c) =>
              c.pesCod === pesCod
                ? { ...c, autorizacao: { ...c.autorizacao, [modalidade]: { estado: 'PENDENTE', id } } }
                : c,
            ),
          }
        : r,
    )

  if (carregando && !rel) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="size-6" />
      </div>
    )
  }
  if (erro) {
    return (
      <p role="alert" className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground">
        {erro}
      </p>
    )
  }
  if (!rel) return null
  const ultimaPagina = Math.max(1, Math.ceil(rel.total / LIMITE))

  return (
    <div className="space-y-6">
      {rel.candidatos.length === 0 ? (
        <EmptyState
          title="Nenhum candidato"
          description="Ninguém foi pago por TED/PIX no histórico nem tem perfil TED/PIX."
        />
      ) : (
        <Table aria-label="Candidatos à autorização">
          <TableHeader>
            <TableRow>
              <TableHead>Favorecido</TableHead>
              <TableHead>Canal dominante</TableHead>
              <TableHead className="text-right">Participação</TableHead>
              <TableHead className="text-right">Pagamentos TED/PIX</TableHead>
              <TableHead className="text-right">Meses</TableHead>
              <TableHead>Confiança</TableHead>
              <TableHead>Cadastro do Conexos</TableHead>
              <TableHead>Autorização</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rel.candidatos.map((c) => {
              const nome = c.credor ?? `favorecido ${c.pesCod}`
              return (
                <TableRow key={c.pesCod}>
                  <TableCell>
                    <span className="block">{c.credor ?? '—'}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{c.pesCod}</span>
                  </TableCell>
                  <TableCell>{ROTULO_GRUPO[c.grupoDominante] ?? c.grupoDominante}</TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(c.participacao * 100)}%</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.pagamentosTedPix} de {c.pagamentos}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.meses}</TableCell>
                  <TableCell>{c.confianca.toLowerCase()}</TableCell>
                  <TableCell className="text-xs">
                    {MODALIDADES.map((m) => (
                      <span key={m} className="block">
                        {m === 'TED' ? 'conta' : 'chave PIX'}: {ROTULO_CADASTRO[c.cadastro[m]]}
                      </span>
                    ))}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      {MODALIDADES.map((m) => {
                        const a = c.autorizacao[m]
                        return (
                          <div key={m} className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={a.estado === 'AUTORIZADO' ? 'border-success/40 text-success' : 'text-muted-foreground'}>
                              {m}: {rotuloEstado(a.estado)}
                            </Badge>
                            {podePedir && (a.estado === 'NENHUMA' || a.estado === 'REJEITADO' || a.estado === 'REVOGADO') ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setPedido({ pesCod: c.pesCod, ...(c.credor ? { credor: c.credor } : {}), modalidade: m })}
                                aria-label={`Pedir autorização ${m} para ${nome}`}
                              >
                                <Plus className="size-4" aria-hidden />
                                Pedir
                              </Button>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {ultimaPagina > 1 ? (
        <nav aria-label="Páginas do relatório" className="flex items-center justify-end gap-2 text-sm">
          <Button type="button" variant="outline" size="sm" disabled={pagina <= 1 || carregando} onClick={() => setPagina((p) => p - 1)} aria-label="Página anterior">
            Anterior
          </Button>
          <span>
            Página {pagina} de {ultimaPagina}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={pagina >= ultimaPagina || carregando} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">
            Próxima
          </Button>
        </nav>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">TED/PIX retirados por falta de dado</h2>
        <p className="text-sm text-muted-foreground">
          Itens que saíram de um lote no finalizar porque o cadastro do Conexos não tinha conta ou
          chave PIX. Pedir ao responsável pelo cadastro do Conexos.
        </p>
        {rel.retiradosSemDado.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum item retirado por falta de dado.</p>
        ) : (
          <Table aria-label="TED/PIX retirados por falta de dado">
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Favorecido</TableHead>
                <TableHead>Retirado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rel.retiradosSemDado.map((r) => (
                <TableRow key={`${r.loteId ?? ''}:${r.docCod}:${r.titCod}:${r.ocorridoEm}`}>
                  <TableCell className="tabular-nums">
                    {r.docCod}/{r.titCod}
                  </TableCell>
                  <TableCell>
                    {r.credor ?? '—'} {r.pesCod ? <span className="text-xs text-muted-foreground">({r.pesCod})</span> : null}
                  </TableCell>
                  <TableCell>{formatarData(r.ocorridoEm)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {pedido ? (
        <SolicitarAutorizacaoDialog
          inicial={pedido}
          origem="RELATORIO"
          onOpenChange={(open) => {
            if (!open) setPedido(null)
          }}
          onSolicitada={(a) => {
            if (pedido.pesCod && pedido.modalidade) marcarPendente(pedido.pesCod, pedido.modalidade, a.id)
            setPedido(null)
            toast.success('Autorização pedida: aguarda a aprovação de outra pessoa')
          }}
        />
      ) : null}
    </div>
  )
}

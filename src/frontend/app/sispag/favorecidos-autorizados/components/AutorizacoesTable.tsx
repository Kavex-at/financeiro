'use client'

import { Ban, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  type EstadoAutorizacao,
  type FavorecidoAutorizado,
  ROTULO_ESTADO_AUTORIZACAO,
} from '@/lib/sispag'
import { formatarData, mesmaPessoa, reaprovacaoSemPedido } from './formatar'
import { RevelarDestinoButton } from './RevelarDestinoButton'
import { SeloConferencia } from './SeloConferencia'

const CLASSE_ESTADO: Record<EstadoAutorizacao, string> = {
  PENDENTE: 'border-warning/40 text-warning',
  AUTORIZADO: 'border-success/40 text-success',
  REAPROVACAO_PENDENTE: 'border-warning/40 text-warning',
  REJEITADO: 'text-muted-foreground',
  REVOGADO: 'text-muted-foreground',
}

export interface PermissoesTabela {
  /** `sispag:executar`: confirmar pedido de reaprovação. */
  executar: boolean
  /** `sispag:autorizar_favorecido`: aprovar, rejeitar, revogar, revelar. */
  autorizar: boolean
}

/**
 * Favorecidos autorizados (ADR-0065). SÓ renderiza máscaras; o completo só pelo "Revelar"
 * (auditado). As ações aparecem por permissão (esconder, não desabilitar); "Aprovar" fica
 * desabilitado, com a razão, para quem pediu — a regra de verdade é do backend.
 */
export function AutorizacoesTable({
  autorizacoes,
  usuario,
  permissoes,
  onDecidir,
  onRejeitar,
  onRevogar,
  onReconferir,
  reconferindo,
}: {
  autorizacoes: FavorecidoAutorizado[]
  usuario: string | null
  permissoes: PermissoesTabela
  onDecidir: (a: FavorecidoAutorizado) => void
  onRejeitar: (a: FavorecidoAutorizado) => void
  onRevogar: (a: FavorecidoAutorizado) => void
  onReconferir: (a: FavorecidoAutorizado) => void
  reconferindo: string | null
}) {
  return (
    <Table aria-label="Favorecidos autorizados a receber TED/PIX">
      <TableHeader>
        <TableRow>
          <TableHead>Favorecido</TableHead>
          <TableHead>Forma</TableHead>
          <TableHead>Destino (mascarado)</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Conferência com o Conexos</TableHead>
          <TableHead>Pedido</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {autorizacoes.map((a) => {
          const nome = a.credor ?? `favorecido ${a.pesCod}`
          const pediu = mesmaPessoa(usuario, a.solicitadoPor)
          const aDecidir = a.estado === 'PENDENTE' || a.estado === 'REAPROVACAO_PENDENTE'
          const vigente = aDecidir || a.estado === 'AUTORIZADO'
          return (
            <TableRow key={a.id}>
              <TableCell>
                <span className="block">{a.credor ?? '—'}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{a.pesCod}</span>
              </TableCell>
              <TableCell>{a.modalidade}</TableCell>
              <TableCell className="tabular-nums">
                {a.destinoMascarado ?? <span className="text-muted-foreground">ainda não aprovado</span>}
                {a.estado === 'REAPROVACAO_PENDENTE' && a.destinoObservadoMascarado ? (
                  <span className="block text-xs text-warning">
                    agora no Conexos: {a.destinoObservadoMascarado}
                  </span>
                ) : null}
                {permissoes.autorizar && vigente && a.destinoMascarado ? (
                  <RevelarDestinoButton autorizacaoId={a.id} rotulo={nome} />
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={CLASSE_ESTADO[a.estado]}>
                  {ROTULO_ESTADO_AUTORIZACAO[a.estado]}
                </Badge>
                {a.motivoDecisao ? (
                  <p className="mt-1 text-xs text-muted-foreground">Motivo: {a.motivoDecisao}</p>
                ) : null}
              </TableCell>
              <TableCell>{vigente ? <SeloConferencia autorizacao={a} /> : '—'}</TableCell>
              <TableCell className="text-xs">
                {a.solicitadoPor ?? (reaprovacaoSemPedido(a) ? 'aguardando confirmação' : '—')}
                <br />
                <span className="text-muted-foreground">{formatarData(a.solicitadoEm)}</span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  {vigente ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onReconferir(a)}
                      disabled={reconferindo === a.id}
                      aria-label={`Reconferir com o Conexos o destino de ${nome}`}
                    >
                      <RefreshCw className="size-4" aria-hidden />
                      Reconferir
                    </Button>
                  ) : null}
                  {aDecidir && (permissoes.autorizar || (permissoes.executar && reaprovacaoSemPedido(a))) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onDecidir(a)}
                      aria-label={`${pediu ? 'Ver' : 'Decidir'} autorização ${a.modalidade} de ${nome}`}
                    >
                      <ShieldCheck className="size-4" aria-hidden />
                      {reaprovacaoSemPedido(a) && !permissoes.autorizar ? 'Confirmar pedido' : 'Aprovar'}
                    </Button>
                  ) : null}
                  {a.estado === 'PENDENTE' && permissoes.autorizar ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRejeitar(a)}
                      aria-label={`Rejeitar autorização ${a.modalidade} de ${nome}`}
                    >
                      <XCircle className="size-4" aria-hidden />
                      Rejeitar
                    </Button>
                  ) : null}
                  {(a.estado === 'AUTORIZADO' || a.estado === 'REAPROVACAO_PENDENTE') &&
                  permissoes.autorizar ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRevogar(a)}
                      aria-label={`Revogar autorização ${a.modalidade} de ${nome}`}
                    >
                      <Ban className="size-4" aria-hidden />
                      Revogar
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

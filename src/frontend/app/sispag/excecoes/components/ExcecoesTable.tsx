'use client'

import { Ban, ShieldCheck, XCircle } from 'lucide-react'
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
import { ESTADOS_EXCECAO, type ExcecaoDestinoResumo, type ExcecaoEstado } from '@/lib/sispag'

const ROTULO_ESTADO = Object.fromEntries(ESTADOS_EXCECAO.map((e) => [e.value, e.label])) as Record<
  ExcecaoEstado,
  string
>

const CLASSE_ESTADO: Record<ExcecaoEstado, string> = {
  PENDENTE: 'border-warning/40 text-warning',
  APROVADA: 'border-success/40 text-success',
  REJEITADA: 'text-muted-foreground',
  SUBSTITUIDA: 'text-muted-foreground',
  REVOGADA: 'text-muted-foreground',
}

/** Mesma pessoa, sem diferença de caixa ou espaço (o backend compara assim). */
export const mesmaPessoa = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

const formatarData = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'

/**
 * Tabela de exceções de destino (ADR-0060). SÓ renderiza máscaras. As ações só existem para
 * quem tem `sispag:excecao` (`podeAgir`; sem a permissão a tabela é só leitura). "Aprovar" fica
 * desabilitado, com a razão, quando o usuário é o cadastrante: a regra de verdade é do backend
 * (I12b), a tela só evita o clique inútil.
 */
export function ExcecoesTable({
  excecoes,
  usuario,
  podeAgir,
  onAprovar,
  onRejeitar,
  onRevogar,
}: {
  excecoes: ExcecaoDestinoResumo[]
  usuario: string | null
  podeAgir: boolean
  onAprovar: (e: ExcecaoDestinoResumo) => void
  onRejeitar: (e: ExcecaoDestinoResumo) => void
  onRevogar: (e: ExcecaoDestinoResumo) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Favorecido</TableHead>
          <TableHead>Destino</TableHead>
          <TableHead>Titular</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Cadastrada</TableHead>
          <TableHead>Justificativa</TableHead>
          {podeAgir ? <TableHead className="text-right">Ações</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {excecoes.map((e) => {
          const propria = mesmaPessoa(usuario, e.cadastradoPor)
          const motivoBloqueio = 'Quem cadastrou a exceção não pode aprová-la: peça a outra pessoa.'
          return (
            <TableRow key={e.id}>
              <TableCell className="tabular-nums">{e.pesCod}</TableCell>
              <TableCell className="tabular-nums">
                <span className="mr-1 text-xs text-muted-foreground">
                  {e.tipo === 'CONTA' ? 'TED' : 'PIX'}
                </span>
                {e.destinoMascarado}
              </TableCell>
              <TableCell className="tabular-nums">{e.titularDocumentoMascarado}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className={CLASSE_ESTADO[e.estado]}>
                    {ROTULO_ESTADO[e.estado]}
                  </Badge>
                  {e.estado === 'SUBSTITUIDA' && e.divergiu ? (
                    <Badge
                      variant="outline"
                      className="border-warning/40 text-warning"
                      title="O cadastro do Conexos assumiu com um destino DIFERENTE do da exceção. Confira se o cadastro está certo."
                    >
                      cadastro divergiu
                    </Badge>
                  ) : null}
                </div>
                {e.motivoDecisao ? (
                  <p className="mt-1 text-xs text-muted-foreground">Motivo: {e.motivoDecisao}</p>
                ) : null}
              </TableCell>
              <TableCell className="text-xs">
                {e.cadastradoPor}
                <br />
                <span className="text-muted-foreground">{formatarData(e.cadastradoEm)}</span>
              </TableCell>
              <TableCell className="max-w-64 text-xs">{e.justificativa}</TableCell>
              {podeAgir ? (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {e.estado === 'PENDENTE' ? (
                      <>
                        <span title={propria ? motivoBloqueio : undefined}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={propria}
                            aria-describedby={propria ? `bloqueio-${e.id}` : undefined}
                            onClick={() => onAprovar(e)}
                            aria-label={`Aprovar exceção do favorecido ${e.pesCod}`}
                          >
                            <ShieldCheck className="size-4" aria-hidden />
                            Aprovar
                          </Button>
                        </span>
                        {propria ? (
                          <span id={`bloqueio-${e.id}`} className="block max-w-40 text-xs text-muted-foreground">
                            {motivoBloqueio}
                          </span>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onRejeitar(e)}
                          aria-label={`Rejeitar exceção do favorecido ${e.pesCod}`}
                        >
                          <XCircle className="size-4" aria-hidden />
                          Rejeitar
                        </Button>
                      </>
                    ) : null}
                    {e.estado === 'APROVADA' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onRevogar(e)}
                        aria-label={`Revogar exceção do favorecido ${e.pesCod}`}
                      >
                        <Ban className="size-4" aria-hidden />
                        Revogar
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

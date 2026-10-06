'use client'

import { RefreshCcw } from 'lucide-react'
import * as React from 'react'
import { ExigePermissao } from '@/components/auth/ExigePermissao'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PERMISSAO } from '@/lib/permissoes'
import { fetchPendenciasCadastro, type PendenciaCadastro } from '@/lib/sispag'

const TIPO: Record<PendenciaCadastro['tipo'], string> = {
  CONTA: 'conta bancária (TED)',
  CHAVE_PIX: 'chave PIX',
}

const DESFECHO: Record<PendenciaCadastro['origens'][number]['desfecho'], string> = {
  RETIRADO: 'retirado do lote',
  MANTIDO_POR_EXCECAO: 'pago por exceção de destino',
}

/**
 * Pendências de cadastro (ADR-0063, I13k) — quem tem `sispag:cadastro` (a área que mantém o
 * cadastro de favorecidos no Conexos). Cada linha é um favorecido sem conta (TED) ou chave PIX no
 * cadastro, com os títulos que a verificação TED/PIX encontrou. Não há botão de "resolver": a
 * pendência some sozinha quando o cadastro do Conexos passa a ter o dado — o backend reconfere a
 * cada abertura desta tela. Nunca mostra conta nem chave. A autorização real é do servidor.
 */
export default function PendenciasCadastroPage() {
  return (
    <ExigePermissao permissao={PERMISSAO.SISPAG_CADASTRO}>
      <PendenciasConteudo />
    </ExigePermissao>
  )
}

function PendenciasConteudo() {
  const [pendencias, setPendencias] = React.useState<PendenciaCadastro[]>([])
  const [carregando, setCarregando] = React.useState(true)
  const [erro, setErro] = React.useState<string | null>(null)

  const carregar = React.useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      setPendencias(await fetchPendenciasCadastro())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as pendências.')
    } finally {
      setCarregando(false)
    }
  }, [])

  React.useEffect(() => {
    void carregar()
  }, [carregar])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pendências de cadastro"
        subtitle="Favorecidos sem conta (TED) ou chave PIX no cadastro do Conexos, encontrados na verificação dos pagamentos. Corrija o cadastro no Conexos: a pendência sai desta lista sozinha na próxima atualização."
        actions={
          <Button variant="outline" onClick={() => void carregar()} disabled={carregando}>
            <RefreshCcw className="size-4" aria-hidden />
            Atualizar
          </Button>
        }
      />

      {carregando ? (
        <div className="flex items-center justify-center py-16">
          <Spinner className="size-6" />
        </div>
      ) : erro ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-sm text-danger-foreground"
        >
          {erro}
        </p>
      ) : pendencias.length === 0 ? (
        <EmptyState
          title="Nenhuma pendência de cadastro"
          description="Todo favorecido pago por TED ou PIX tem o dado de pagamento no cadastro do Conexos."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Favorecido</TableHead>
                <TableHead>Falta no cadastro</TableHead>
                <TableHead>Títulos de origem</TableHead>
                <TableHead>Aberta em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendencias.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="max-w-[18rem]">
                    <span className="block truncate font-medium">{p.credor ?? '—'}</span>
                    <span className="text-xs text-muted-foreground">
                      código {p.pesCod} · filial {p.filCod}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm">{TIPO[p.tipo]}</span>
                      {p.comExcecaoAprovada ? (
                        <Badge
                          variant="outline"
                          className="w-fit border-warning/40 text-warning"
                          title="O pagamento segue por uma exceção de destino aprovada, mas o cadastro continua por corrigir."
                        >
                          paga por exceção
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {p.origens.map((o) => (
                        <li key={`${o.loteId}:${o.docCod}:${o.titCod}:${o.desfecho}`}>
                          {o.docCod}/{o.titCod} · {DESFECHO[o.desfecho]}
                        </li>
                      ))}
                    </ul>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {new Date(p.abertaEm).toLocaleString('pt-BR')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

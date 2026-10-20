import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MOTIVO_PAGAMENTO } from '@/lib/sispag'
import {
  ACAO_DO_MOTIVO,
  DONO_DO_MOTIVO,
  EFEITO_MOTIVO,
  ROTULO_ACAO,
  ROTULO_DONO,
  ROTULO_MOTIVO,
} from './rotulos'

/**
 * O que significa "Pronto" e quem resolve cada bloqueio. Fica atrás do botão "?" da tela (decisão
 * D11), nunca numa tela própria. A ordem das linhas é a de prioridade do contrato: quando um título
 * tem mais de um problema, a linha mostra o primeiro desta lista.
 */
export function RegrasSituacao({ id }: { id: string }) {
  return (
    <section
      id={id}
      aria-label="Como a situação de pagamento é calculada"
      className="space-y-2 rounded-lg border bg-card p-4"
    >
      <h3 className="text-sm font-medium">Como a situação é calculada</h3>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Situação</TableHead>
              <TableHead>Quem resolve</TableHead>
              <TableHead>Botão na linha</TableHead>
              <TableHead>O que significa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <Badge variant="outline" className="border-success/40 text-success-foreground">
                  Pronto
                </Badge>
              </TableCell>
              <TableCell>Você</TableCell>
              <TableCell>Selecionar e criar lote</TableCell>
              <TableCell className="whitespace-normal text-xs text-muted-foreground">
                Aprovado, não pago, no prazo e sem pendência conhecida.
              </TableCell>
            </TableRow>
            {Object.values(MOTIVO_PAGAMENTO).map((m) => (
              <TableRow key={m}>
                <TableCell>
                  <Badge variant="outline" className="border-danger/40 text-danger-foreground">
                    {ROTULO_MOTIVO[m]}
                  </Badge>
                </TableCell>
                <TableCell>{ROTULO_DONO[DONO_DO_MOTIVO[m]]}</TableCell>
                <TableCell>{ROTULO_ACAO[ACAO_DO_MOTIVO[m]]}</TableCell>
                <TableCell className="whitespace-normal text-xs text-muted-foreground">
                  {EFEITO_MOTIVO[m]}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        TED e PIX contam como Pronto até a verificação do favorecido e do cadastro, que hoje só
        acontece ao montar o lote. Um título com mais de um problema mostra o mais urgente.
      </p>
    </section>
  )
}

'use client'

import { ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { aprovarExcecao, type ExcecaoDestinoResumo } from '@/lib/sispag'

/**
 * Aprovar exceção (ADR-0061, I12b): a segunda pessoa confere o destino e o titular (sempre
 * MASCARADOS) e aprova. O backend nega o próprio cadastrante; a tela só evita o clique inútil.
 * Erro do servidor fica inline, com o diálogo aberto.
 */
export function AprovarExcecaoDialog({
  excecao,
  onOpenChange,
  onAprovada,
}: {
  excecao: ExcecaoDestinoResumo
  onOpenChange: (open: boolean) => void
  onAprovada: (excecao: ExcecaoDestinoResumo) => void
}) {
  const [salvando, setSalvando] = React.useState(false)
  const [erro, setErro] = React.useState<string | null>(null)

  async function aprovar() {
    if (salvando) return
    setSalvando(true)
    setErro(null)
    try {
      onAprovada(await aprovarExcecao(excecao.id))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível aprovar a exceção.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => { if (!salvando) onOpenChange(aberto) }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Aprovar exceção de destino</DialogTitle>
          <DialogDescription>
            Confira o destino e o titular antes de aprovar: o pagamento deste favorecido vai para
            ele quando o cadastro do Conexos não tiver conta ou chave ativa.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3 text-sm">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Favorecido</dt>
            <dd className="tabular-nums">{excecao.pesCod}</dd>
            <dt className="text-muted-foreground">Destino</dt>
            <dd className="tabular-nums">{excecao.destinoMascarado}</dd>
            <dt className="text-muted-foreground">CPF/CNPJ do titular</dt>
            <dd className="tabular-nums">{excecao.titularDocumentoMascarado}</dd>
            <dt className="text-muted-foreground">Cadastrada por</dt>
            <dd>{excecao.cadastradoPor}</dd>
            <dt className="text-muted-foreground">Justificativa</dt>
            <dd>{excecao.justificativa}</dd>
          </dl>
          {erro ? (
            <p
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger-subtle px-4 py-3 text-danger-foreground"
            >
              {erro}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>
            Voltar
          </Button>
          <Button onClick={() => void aprovar()} disabled={salvando}>
            {salvando ? <Spinner aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
            Aprovar exceção
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

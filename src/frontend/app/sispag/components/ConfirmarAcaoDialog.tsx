'use client'

import { AlertTriangle } from 'lucide-react'
import type * as React from 'react'
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
import type { ArquivoRetorno, LotePagamento } from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

/**
 * Casca das confirmações do SISPAG: título, o que vai acontecer, "Voltar" e a ação. O botão de
 * sair é "Voltar", não "Cancelar" — num diálogo que confirma "Cancelar lote", dois botões
 * "Cancelar" com sentidos opostos é convite ao clique errado.
 */
export function ConfirmarAcaoDialog({
  open,
  onOpenChange,
  titulo,
  descricao,
  rotuloConfirmar,
  destrutivo = false,
  busy,
  onConfirmar,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  titulo: string
  descricao: React.ReactNode
  rotuloConfirmar: string
  destrutivo?: boolean
  busy: boolean
  onConfirmar: () => void
  children?: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        {children ? <DialogBody className="space-y-3 text-sm">{children}</DialogBody> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            variant={destrutivo ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() => {
              onOpenChange(false)
              onConfirmar()
            }}
          >
            {rotuloConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-subtle/40 p-3 text-warning-foreground"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  )
}

/** Transições do lote que pedem confirmação no card. */
export type AcaoLote = 'finalizar' | 'cancelar' | 'reabrir' | 'retorno'

/** O lote como a analista o reconhece na lista — a mesma linha do título do card. */
const resumoLote = (l: LotePagamento): string => {
  const total = l.itens.reduce((acc, i) => acc + (i.valor ?? 0), 0)
  const conta = l.conta ? ` · paga por ${l.banco ?? ''} ${l.conta}`.trimEnd() : ''
  return `Filial ${l.filCod} · ${l.itens.length} título(s) · ${formatBRL(total)}${conta}`
}

/**
 * Confirmação das transições do lote. Nenhuma delas escreve no Conexos — são mudanças de estado
 * do nosso lote — e a cópia diz isso, porque o risco real é o inverso: achar que "Cancelar" ou
 * "Reabrir" aqui desfaz um lote nativo que já existe no fin015.
 */
export function ConfirmarAcaoLoteDialog({
  lote: l,
  acao,
  onOpenChange,
  busy,
  onConfirmar,
}: {
  lote: LotePagamento
  acao: AcaoLote
  onOpenChange: (open: boolean) => void
  busy: boolean
  onConfirmar: () => void
}) {
  const nativo =
    l.nativeFlpCod != null ? (
      <Aviso>
        O lote nativo flp {l.nativeFlpCod} já existe no Conexos (fin015) e <strong>não</strong> é
        alterado por esta ação. Se for o caso, cancele-o no fin015.
      </Aviso>
    ) : null
  const comum = { open: true, onOpenChange, busy, onConfirmar, descricao: resumoLote(l) }
  const idLote = <p className="text-xs text-muted-foreground">Lote {l.id}</p>

  if (acao === 'finalizar')
    return (
      <ConfirmarAcaoDialog {...comum} titulo="Finalizar lote" rotuloConfirmar="Finalizar lote">
        <p>
          O lote sai de rascunho e fica pronto para gerar a remessa. Nada é enviado ao Conexos
          agora: isso só acontece em <strong>Gerar remessa</strong>. Para mexer nos títulos depois,
          será preciso reabrir o lote.
        </p>
        {idLote}
      </ConfirmarAcaoDialog>
    )
  if (acao === 'cancelar')
    return (
      <ConfirmarAcaoDialog
        {...comum}
        titulo="Cancelar lote"
        rotuloConfirmar="Cancelar lote"
        destrutivo
      >
        <p>
          O lote é descartado neste painel e <strong>não pode ser reaberto</strong>. Nada é
          enviado ao Conexos.
        </p>
        {nativo}
        {idLote}
      </ConfirmarAcaoDialog>
    )
  if (acao === 'reabrir')
    return (
      <ConfirmarAcaoDialog {...comum} titulo="Reabrir lote" rotuloConfirmar="Reabrir lote">
        <p>
          O lote volta a rascunho para editar títulos e formas de pagamento; depois, será preciso
          finalizá-lo de novo. Nada é enviado ao Conexos.
        </p>
        {nativo}
        {idLote}
      </ConfirmarAcaoDialog>
    )
  return (
    <ConfirmarAcaoDialog
      {...comum}
      titulo="Simular retorno do Nexxera"
      rotuloConfirmar="Marcar retorno recebido"
    >
      <Aviso>
        Isto é uma <strong>simulação</strong>: marca o lote como “de volta do Nexxera” sem ler
        nenhum arquivo .RET e sem dar baixa no Conexos. O retorno real vem da aba{' '}
        <strong>Retorno Lote (RET)</strong>.
      </Aviso>
      {idLote}
    </ConfirmarAcaoDialog>
  )
}

/**
 * Confirmação de "Processar e conciliar" — a única ação desta tela que manda o ERP dar baixa
 * (fin010) a partir de um .RET. Nomeia o arquivo, o banco e a filial: é o que a analista confere
 * no fin052 antes de deixar o Conexos escrever.
 */
export function ConfirmarProcessarRetornoDialog({
  retorno: r,
  onOpenChange,
  busy,
  onConfirmar,
}: {
  retorno: ArquivoRetorno
  onOpenChange: (open: boolean) => void
  busy: boolean
  onConfirmar: () => void
}) {
  const arquivo = r.arquivo ?? `gar ${r.garCodSeq}`
  const banco = `${r.banco ?? `bnc ${r.bncCod}`}${r.configNome ? ` · ${r.configNome}` : ''}`
  return (
    <ConfirmarAcaoDialog
      open
      onOpenChange={onOpenChange}
      busy={busy}
      onConfirmar={onConfirmar}
      titulo={`Processar o retorno ${arquivo}`}
      descricao={`${banco} · filial ${r.filCod}`}
      rotuloConfirmar="Processar e conciliar"
    >
      <Aviso>
        O Conexos vai ler este .RET e <strong>gravar as baixas</strong> dos títulos pagos no
        fin010. Isso não se desfaz por esta tela.
      </Aviso>
      <p>Em seguida, o resultado é conciliado com os nossos lotes.</p>
    </ConfirmarAcaoDialog>
  )
}

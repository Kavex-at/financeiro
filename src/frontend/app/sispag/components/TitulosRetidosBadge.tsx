'use client'

import { Lock, Undo2 } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  desfazerBloqueioDuplicidade,
  ROTULO_RETIRADA_CODIGO_BARRAS,
  type TituloRetidoPorCodigoBarras,
} from '@/lib/sispag'
import { MotivoDecisaoDialog } from './MotivoDecisaoDialog'

/**
 * Selo "retido por boleto repetido" (ou "por código ilegível") na linha do título, com a máscara
 * do código e o título que ficou — e, para quem executa, a ação DESFAZER com motivo obrigatório
 * (ADR-0069 emenda 1, I16g). Desfazer devolve o título ao pool; NÃO troca o item que ficou, e se
 * o boleto ainda estiver compartilhado a próxima geração o retira de novo.
 */
export function TitulosRetidosBadge({
  retido,
  podeDesfazer,
  onDesfeito,
}: {
  retido: TituloRetidoPorCodigoBarras
  podeDesfazer: boolean
  /** Chamado depois de o servidor aceitar: a página recarrega painel e retidos. */
  onDesfeito: () => void | Promise<void>
}) {
  const [aberto, setAberto] = React.useState(false)
  const rotulo = ROTULO_RETIRADA_CODIGO_BARRAS[retido.origem]
  const detalhe = [
    retido.codigoMascarado ? `código ${retido.codigoMascarado}` : null,
    retido.tituloMantido
      ? `ficou o título ${retido.tituloMantido.docCod}/${retido.tituloMantido.titCod}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <span className="ml-2 inline-flex flex-wrap items-center gap-1 align-middle">
        <Badge
          variant="outline"
          className="border-warning/40 text-warning"
          title={`Retido pelo sistema: ${rotulo}${detalhe ? ` (${detalhe})` : ''}. Não entra em lote enquanto estiver retido.`}
        >
          <Lock className="mr-1 size-3" aria-hidden />
          retido por {rotulo}
        </Badge>
        {detalhe ? <span className="text-xs text-muted-foreground">{detalhe}</span> : null}
        {podeDesfazer ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setAberto(true)}
          >
            <Undo2 className="size-3" aria-hidden />
            Desfazer retenção
          </Button>
        ) : null}
      </span>
      {aberto ? (
        <MotivoDecisaoDialog
          titulo="Desfazer a retenção do título"
          descricao={`O título ${retido.docCod}/${retido.titCod} volta a poder entrar em lote. Se o boleto ainda for compartilhado com outro título, a próxima geração o retira de novo. Informe o motivo: ele fica registrado.`}
          rotuloConfirmar="Desfazer retenção"
          onFechar={() => setAberto(false)}
          onConfirmar={async (motivo) => {
            await desfazerBloqueioDuplicidade(
              { filCod: retido.filCod, docCod: retido.docCod, titCod: retido.titCod },
              motivo,
            )
            setAberto(false)
            await onDesfeito()
          }}
        />
      ) : null}
    </>
  )
}

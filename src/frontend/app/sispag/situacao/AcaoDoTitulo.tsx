'use client'

import { Copy } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { isSessionExpiredError } from '@/lib/http'
import {
  ACAO_PAGAMENTO,
  desfazerBloqueioDuplicidade,
  tentarAjusteCentavos,
  type TituloAPagar,
} from '@/lib/sispag'
import { MotivoDecisaoDialog } from '../components/MotivoDecisaoDialog'
import { ORIENTACAO_NO_CONEXOS, ROTULO_ACAO } from './rotulos'

/**
 * O botão "Próxima ação" da linha de um título bloqueado (e da faixa de hoje). Cada `acao.codigo`
 * do contrato leva a um lugar real, nunca a um botão morto:
 *  - Permutas / Ver boleto / Desfazer / Tratar / Tentar ajuste: fluxo próprio, aqui ou existente;
 *  - Abrir, Renegociar, Corrigir no Conexos: sem tela nossa, abre a orientação com o documento
 *    para copiar (o Conexos web não tem link direto por título que possamos montar).
 * As que ESCREVEM (desfazer bloqueio, ajuste) somem para quem não tem `sispag:executar` (R11).
 */
export function AcaoDoTitulo({
  titulo,
  podeExecutar,
  onVerBoleto,
  onResolvido,
  tamanho = 'sm',
}: {
  titulo: TituloAPagar
  podeExecutar: boolean
  onVerBoleto: (t: TituloAPagar) => void
  /** Depois de uma ação que muda o servidor: a página recarrega painel e retidos. */
  onResolvido: () => void | Promise<void>
  tamanho?: 'sm' | 'default'
}) {
  const acao = titulo.situacaoPagamento?.acao
  const [dialogo, setDialogo] = React.useState(false)
  const [ocupado, setOcupado] = React.useState(false)
  if (!acao) return null
  const rotulo = acao.rotulo || ROTULO_ACAO[acao.codigo]
  const chave = { filCod: titulo.filCod, docCod: titulo.docCod, titCod: titulo.titCod }
  const nome = `${titulo.docCod}/${titulo.titCod}`

  switch (acao.codigo) {
    case ACAO_PAGAMENTO.ABRIR_EM_PERMUTAS:
      return (
        <Button size={tamanho} variant="outline" asChild>
          <Link href="/permutas">{rotulo}</Link>
        </Button>
      )

    case ACAO_PAGAMENTO.VER_BOLETO:
      return (
        <Button size={tamanho} variant="outline" onClick={() => onVerBoleto(titulo)}>
          {rotulo}
        </Button>
      )

    case ACAO_PAGAMENTO.DESFAZER_RETENCAO:
    case ACAO_PAGAMENTO.TRATAR_DUPLICIDADE: {
      if (!podeExecutar) return null
      const retencao = acao.codigo === ACAO_PAGAMENTO.DESFAZER_RETENCAO
      return (
        <>
          <Button size={tamanho} variant="outline" onClick={() => setDialogo(true)}>
            {rotulo}
          </Button>
          {dialogo ? (
            <MotivoDecisaoDialog
              titulo={retencao ? 'Desfazer a retenção do título' : 'Desfazer o bloqueio por duplicidade'}
              descricao={
                retencao
                  ? `O título ${nome} volta a poder entrar em lote. Se o boleto ainda for compartilhado com outro título, a próxima geração o retira de novo. Informe o motivo: ele fica registrado.`
                  : `O título ${nome} volta a poder entrar em lote. Antes, confira no Conexos se o documento parecido é mesmo uma duplicidade. Informe o motivo: ele fica registrado.`
              }
              rotuloConfirmar={retencao ? 'Desfazer retenção' : 'Desfazer bloqueio'}
              onFechar={() => setDialogo(false)}
              onConfirmar={async (motivo) => {
                await desfazerBloqueioDuplicidade(chave, motivo)
                setDialogo(false)
                toast.success(retencao ? 'Retenção desfeita' : 'Bloqueio desfeito', {
                  description: 'O título voltou a poder entrar em lote.',
                })
                await onResolvido()
              }}
            />
          ) : null}
        </>
      )
    }

    case ACAO_PAGAMENTO.TENTAR_AJUSTE: {
      if (!podeExecutar) return null
      return (
        <Button
          size={tamanho}
          variant="outline"
          disabled={ocupado}
          onClick={async () => {
            setOcupado(true)
            try {
              const r = await tentarAjusteCentavos(chave)
              toast.success(
                r.etapa === 'concluido'
                  ? 'Ajuste de centavos concluído no Conexos'
                  : 'Pedido de ajuste enviado',
                { description: `Título ${nome}.` },
              )
              await onResolvido()
            } catch (e) {
              if (isSessionExpiredError(e)) return
              toast.error('Não foi possível ajustar os centavos', {
                description: e instanceof Error ? e.message : undefined,
              })
            } finally {
              setOcupado(false)
            }
          }}
        >
          {ocupado ? 'Ajustando…' : rotulo}
        </Button>
      )
    }

    default: {
      const orientacao = ORIENTACAO_NO_CONEXOS[acao.codigo]
      const referencia = `filial ${titulo.filCod} · documento ${nome}`
      return (
        <Popover>
          <PopoverTrigger asChild>
            <Button size={tamanho} variant="outline">
              {rotulo}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-2 p-3 text-sm">
            <p className="font-medium">{orientacao?.titulo ?? rotulo}</p>
            <p className="text-muted-foreground">
              {orientacao?.passos ?? 'Resolva no Conexos e aguarde a próxima ingestão da carteira.'}
            </p>
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2 py-1.5">
              <span className="text-xs tabular-nums">{referencia}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                aria-label={`Copiar o documento ${nome}`}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(nome)
                    toast.success('Documento copiado', { description: nome })
                  } catch {
                    toast.error('Não foi possível copiar')
                  }
                }}
              >
                <Copy className="size-3" aria-hidden /> Copiar
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      )
    }
  }
}

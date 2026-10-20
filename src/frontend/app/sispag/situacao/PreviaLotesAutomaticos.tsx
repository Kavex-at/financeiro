'use client'

import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { formatBRL } from '@/lib/utils'
import type { TituloAPagar } from '@/lib/sispag'
import { JANELA_FORMACAO_DIAS, ehBloqueado, prontosPorFilial, somar } from './situacaoTitulos'

/**
 * Prévia do "Formar lotes automáticos" (decisão D9), antes de chamar o servidor: mostra, por
 * filial, quantos títulos PRONTOS entram. Bloqueados nunca entram, nem título já em lote. A conta
 * é local e informativa; quem forma os lotes é o servidor, com a mesma regra.
 */
export function PreviaLotesAutomaticos({
  titulos,
  formando,
  onFormar,
  onFechar,
}: {
  titulos: TituloAPagar[]
  formando: boolean
  onFormar: () => void
  onFechar: () => void
}) {
  const porFilial = prontosPorFilial(titulos)
  const total = porFilial.reduce((acc, f) => ({ qtd: acc.qtd + f.qtd, valor: acc.valor + f.valor }), {
    qtd: 0,
    valor: 0,
  })
  const bloqueados = somar(titulos.filter(ehBloqueado)).qtd
  return (
    <section
      aria-label="Prévia dos lotes automáticos"
      className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3"
    >
      <p className="text-sm font-medium">
        {total.qtd === 0
          ? 'Nenhum título pronto para formar lote agora'
          : `Formar lotes automáticos: ${total.qtd} título(s) em ${porFilial.length} filial(is) · ${formatBRL(total.valor)}`}
      </p>
      {porFilial.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {porFilial.map((f) => (
            <li key={f.filCod} className="rounded-md border bg-card px-3 py-1.5 text-sm">
              <b>Filial {f.filCod}</b> · {f.qtd} título(s) · {formatBRL(f.valor)}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Só entram títulos <b>Pronto</b> que vencem de hoje a {JANELA_FORMACAO_DIAS} dias e ainda não
        estão em lote. Ficam de fora {bloqueados} bloqueado(s). Os lotes saem agrupados por filial e
        vencimento, em rascunho, para você revisar.
      </p>
      <div className="flex gap-2">
        <Button size="sm" disabled={formando || total.qtd === 0} onClick={onFormar}>
          {formando ? <Spinner aria-hidden /> : <Layers className="size-4" aria-hidden />}
          {formando ? 'Formando…' : 'Formar os lotes'}
        </Button>
        <Button size="sm" variant="outline" disabled={formando} onClick={onFechar}>
          Cancelar
        </Button>
      </div>
    </section>
  )
}

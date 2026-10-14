'use client'

import { AlertTriangle } from 'lucide-react'
import {
  formatCivilDate,
  type RetiradaDoLote,
  ROTULO_RETIRADA_CODIGO_BARRAS,
} from '@/lib/sispag'
import { formatBRL } from '@/lib/utils'

/** `docCod/titCod` + favorecido, valor, vencimento, código MASCARADO e o título que ficou. */
function descreverRetirada(r: RetiradaDoLote): string {
  const partes = [`${r.titulo.docCod}/${r.titulo.titCod}`]
  if (r.credor) partes.push(r.credor)
  if (r.valor !== undefined) partes.push(formatBRL(r.valor))
  if (r.vencimento) partes.push(`venc. ${formatCivilDate(r.vencimento)}`)
  if (r.codigoMascarado) partes.push(`código ${r.codigoMascarado}`)
  if (r.tituloMantido) {
    partes.push(`ficou ${r.tituloMantido.docCod}/${r.tituloMantido.titCod}`)
  }
  return partes.join(' · ')
}

/**
 * Aviso PERSISTENTE da retirada automática por código de barras (ADR-0069 emenda 1, I16f(3)).
 * Lido da trilha do lote, então reaparece ao recarregar a página e dura enquanto o lote existir —
 * não é toast. Mostra só a máscara do código (5 primeiros + 4 últimos dígitos).
 */
export function RetiradosPorCodigoBarrasAviso({ retiradas }: { retiradas: RetiradaDoLote[] }) {
  if (retiradas.length === 0) return null
  const grupos = (
    ['CODIGO_BARRAS_REPETIDO', 'CODIGO_BARRAS_ILEGIVEL', 'VINCULO_CODIGO_BARRAS_FALHOU'] as const
  )
    .map((motivo) => ({ motivo, itens: retiradas.filter((r) => r.motivo === motivo) }))
    .filter((g) => g.itens.length > 0)

  return (
    <div
      role="status"
      data-testid="aviso-retirados-codigo-barras"
      className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-foreground"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-2">
        <p className="font-medium">
          {retiradas.length === 1
            ? '1 título foi retirado deste lote automaticamente.'
            : `${retiradas.length} títulos foram retirados deste lote automaticamente.`}{' '}
          A remessa não inclui {retiradas.length === 1 ? 'ele' : 'eles'}.
        </p>
        {grupos.map((g) => (
          <div key={g.motivo}>
            <p>
              {g.motivo === 'CODIGO_BARRAS_REPETIDO'
                ? 'O mesmo boleto aparecia em mais de um título do lote e só um pode ser pago:'
                : g.motivo === 'VINCULO_CODIGO_BARRAS_FALHOU'
                  ? 'O código de barras confirmado não pôde ser vinculado ao título (valor, data ou banco divergentes) e o título saiu do lote:'
                  : 'O código de barras do boleto está ilegível ou inválido:'}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {g.itens.map((r) => (
                <li key={`${r.titulo.filCod}:${r.titulo.docCod}:${r.titulo.titCod}`}>
                  <span className="sr-only">{ROTULO_RETIRADA_CODIGO_BARRAS[r.motivo]}: </span>
                  {descreverRetirada(r)}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs">
          Os títulos retirados ficam retidos na aba de títulos. Para pagá-los, resolva o boleto no
          Conexos (fin124) ou mude a forma de pagamento e desfaça a retenção informando o motivo.
        </p>
      </div>
    </div>
  )
}

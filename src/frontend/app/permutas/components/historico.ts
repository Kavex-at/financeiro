import type { CasamentoSugerido, PermutaBorderoVinculo, PermutaPendente } from '@/lib/types'
import { ordenarPorEtapaPermuta } from '@/lib/utils'
import type { ItemHistorico } from './format'

export interface MontarHistoricoInput {
  casamentosSugeridos: CasamentoSugerido[]
  multiplasManuais: PermutaPendente[]
  crossOver: PermutaPendente[]
  crossProcess: PermutaPendente[]
  /** Adtos `ja-permutado` (ADR-0046 D4) — entram só se tiverem borderô do painel. */
  jaPermutados: PermutaPendente[]
  statusPorAdto: Record<string, PermutaBorderoVinculo>
  pendenteByDocCod: Map<string, PermutaPendente>
}

/** Rótulo do `ja-permutado` cujas alocações ficaram todas no mesmo processo do adto. */
const TIPO_JA_PERMUTADO = 'Já permutado'

/** Σ do que entrou no borderô (alocações); sem alocações, o valor negociado do adto. */
const valorLancado = (p: PermutaPendente): number | null =>
  p.alocacoes && p.alocacoes.length > 0
    ? p.alocacoes.reduce((s, al) => s + al.valorAlocado, 0)
    : p.valorMoedaNegociada

/**
 * Tipo exibido de um `ja-permutado`: derivado do que DE FATO foi executado, não do cadastro de
 * clientes-filtro (que muda com o tempo). Alguma alocação em OUTRO processo ⇒ `Cross-process`.
 */
const tipoDoJaPermutado = (p: PermutaPendente): string =>
  (p.alocacoes ?? []).some(
    (al) => al.invoicePriCod !== undefined && al.invoicePriCod !== p.detalhe?.priCod,
  )
    ? 'Cross-process'
    : TIPO_JA_PERMUTADO

/**
 * HISTÓRICO — tudo que já foi executado (tem borderô), unificado das categorias de trabalho e dos
 * `ja-permutado` (que saem das abas de trabalho quando o ERP zera o saldo). Read-only: as ações
 * (aprovar/cancelar/estornar) ficam na aba Borderôs.
 *
 * - **Uma linha por adto + borderô.** A primeira fonte vence, na ordem Automática → Múltipla →
 *   Cross-over → Cross-process → Já permutado. Um adto automático casado com N invoices soma o
 *   `valorASerUsado` numa linha só (antes gerava N linhas com a mesma `key`).
 * - **Ordem:** aguardando aprovação no topo, finalizadas no fundo; dentro de cada grupo, borderô
 *   mais recente primeiro.
 */
export function montarHistorico(input: MontarHistoricoInput): ItemHistorico[] {
  const { statusPorAdto, pendenteByDocCod } = input
  const porChave = new Map<string, ItemHistorico>()
  const chave = (adtoDocCod: string, borCod: number): string => `${adtoDocCod}:${borCod}`

  // Automáticas — `valorASerUsado` zera quando a automática FINALIZA (a invoice foi abatida). Nesse
  // caso usa o valor negociado do PRÓPRIO adiantamento (estável), pra não mostrar 0 no histórico.
  const usadoPorChave = new Map<string, number>()
  for (const c of input.casamentosSugeridos) {
    for (const a of c.adiantamentos) {
      const v = statusPorAdto[a.docCod]
      if (!v) continue
      const k = chave(a.docCod, v.borCod)
      const usado = (usadoPorChave.get(k) ?? 0) + Math.max(0, a.valorASerUsado ?? 0)
      usadoPorChave.set(k, usado)
      const existente = porChave.get(k)
      if (existente) {
        if (usado > 0) existente.valor = usado
        continue
      }
      porChave.set(k, {
        key: `auto-${a.docCod}-${v.borCod}`,
        tipo: 'Automática',
        filCod: c.invoice.filCod,
        priCod: c.priCod,
        cliente: c.invoice.importador ?? '',
        exportador: c.invoice.exportador,
        adtoDocCod: a.docCod,
        valor:
          usado > 0
            ? usado
            : (pendenteByDocCod.get(a.docCod)?.valorMoedaNegociada ?? a.valorASerUsado ?? null),
        moeda: a.moeda ?? c.invoice.moeda,
        borCod: v.borCod,
        finalizado: v.permutaStatus === 'finalizado',
        busca: `${c.priCod} ${c.invoice.importador ?? ''} ${a.docCod} ${v.borCod}`,
      })
    }
  }

  const pushPendentes = (lista: PermutaPendente[], tipoDe: (p: PermutaPendente) => string) => {
    for (const p of lista) {
      const v = statusPorAdto[p.docCod]
      if (!v) continue
      const k = chave(p.docCod, v.borCod)
      if (porChave.has(k)) continue
      const tipo = tipoDe(p)
      porChave.set(k, {
        key: `${tipo}-${p.docCod}-${v.borCod}`,
        tipo,
        filCod: p.filCod,
        priCod: p.detalhe?.priCod ?? '',
        cliente: p.importador ?? '',
        exportador: p.exportador,
        adtoDocCod: p.docCod,
        // "Só o que foi lançado": soma das alocações (o que entrou no borderô), não o adto inteiro.
        valor: valorLancado(p),
        moeda: p.moeda,
        borCod: v.borCod,
        finalizado: v.permutaStatus === 'finalizado',
        busca: `${p.docCod} ${p.importador ?? ''} ${v.borCod}`,
      })
    }
  }
  pushPendentes(input.multiplasManuais, () => 'Múltipla')
  pushPendentes(input.crossOver, () => 'Cross-over')
  pushPendentes(input.crossProcess, () => 'Cross-process')
  pushPendentes(input.jaPermutados, tipoDoJaPermutado)

  const historico = [...porChave.values()]
  historico.sort((a, b) => (b.borCod ?? 0) - (a.borCod ?? 0)) // borderô mais recente primeiro
  return ordenarPorEtapaPermuta(historico, (h) => [
    h.finalizado ? 'finalizada' : 'aguardando-aprovacao',
  ])
}

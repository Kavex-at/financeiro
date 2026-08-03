import type { ProcessamentoStatus, StatusElegibilidade } from '@/lib/types'
import { formatNumber } from '@/lib/utils'

// Máscara/parse/format de valores pt-BR promovidos para `@/lib/brl` (fonte única
// compartilhada com Recebimentos). Re-exportados aqui para não quebrar os imports
// existentes de `./format`.
export { maskBrl, numToMask, parseBrl } from '@/lib/brl'

/**
 * Processamento (baixa/lançamento da permuta). LIGADO desde a Fase 3 (write-back no `fin010` vivo):
 * a baixa real é feita pelo fluxo "Baixar" (reconciliação adto→invoice no borderô). Esta flag
 * libera também os botões legados de Processar/Lançar e remove o aviso de indisponibilidade.
 */
export const PROCESSAMENTO_HABILITADO = true

/** Tamanho máximo do lote por clique em "Executar" — espelha o cap server-side (LOTE_MAX no backend).
 * Mantém cada execução curta (longe do timeout do proxy) e limita o blast radius; o analista clica
 * de novo para o próximo lote até zerar. */
export const LOTE_MAX = 6

/** Tolerância (moeda negociada) p/ ruído de centavos ao decidir se um adiantamento ficou sem saldo. */
export const SALDO_TOL = 1

/** Paginação da tabela principal (visão geral): 50 linhas por página. */
export const PAGE_SIZE = 50

/** Uma linha da aba Histórico — permuta JÁ EXECUTADA (tem borderô), normalizada das 4 categorias. */
export interface ItemHistorico {
  key: string
  tipo: string
  filCod: number
  priCod: string
  cliente: string
  exportador: string
  adtoDocCod: string
  valor: number | null
  moeda: string
  borCod?: number
  finalizado: boolean
  busca: string
}

/** Rótulos legíveis para os motivos de bloqueio do snapshot. */
export const MOTIVO_LABEL: Record<string, string> = {
  'nao-pago': 'Não totalmente pago',
  'sem-saldo-permutar': 'Sem saldo a permutar',
  'ja-permutado': 'Já permutado',
  'di-duimp-ambos': 'D.I e DUIMP (anomalia)',
  'data-base-indisponivel': 'Sem D.I / DUIMP',
  'sem-invoice': 'Sem invoice',
  'composto-nm': 'Múltiplas invoices (N:M)',
  'multiplas-invoices': 'Múltiplas invoices',
  'falha-gate': 'Falha em gate',
  'detail-indisponivel': 'Detalhe indisponível',
  'cliente-filtro': 'Cliente filtro (permuta manual)',
}

/**
 * Trilha de auditoria (ADR-0006): "analista simone" para um username, "cron job"
 * para o agendado. O username vem do `triggered_by` gravado server-side a partir
 * do token autenticado — não de input do cliente.
 */
export function rotuloQuemRodou(triggeredBy: string): string {
  if (triggeredBy === 'cron') return 'cron job'
  return `analista ${triggeredBy}`
}

/** Carimbo "21/06/2026 · 10h52" (horário de Brasília) a partir de um ISO timestamp. */
export function formatRunWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  // Fixa o fuso em BRT (America/Sao_Paulo) — independe do fuso do navegador.
  const tz = 'America/Sao_Paulo'
  const data = d.toLocaleDateString('pt-BR', { timeZone: tz })
  const hora = d
    .toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
    .replace(':', 'h')
  return `${data} · ${hora}`
}

/** Rótulos do status de processamento do analista. */
export const PROCESSAMENTO_LABEL: Record<ProcessamentoStatus, string> = {
  pendente: 'Pendente',
  processando: 'Processando',
  processado: 'Processado',
  erro: 'Erro',
}

/** Normaliza o nome de moeda do Conexos (`moedaNome`) para um código curto
 * (ISO quando há). O backend já manda USD/BRL; os demais chegam como nome longo
 * (ex.: "EURO/COM.EUROPEIA") — encurtamos aqui para a UI. */
const MOEDA_ALIAS: Record<string, string> = {
  'DOLAR DOS EUA': 'USD',
  'EURO/COM.EUROPEIA': 'EUR',
  'RENMINBI HONG KONG': 'CNH',
  'REAL/BRASIL': 'BRL',
  'DOLAR CANADENSE': 'CAD',
  'LIBRA ESTERLINA': 'GBP',
  'IENE/JAPAO': 'JPY',
  'FRANCO SUICO': 'CHF',
  'DOLAR AUSTRALIANO': 'AUD',
}
export const moedaCodigo = (moeda: string) => MOEDA_ALIAS[moeda] ?? moeda

/** Data ISO → dd/mm/aaaa (pt-BR); "—" quando ausente. */
export const fmtData = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR') : '—'

/** Taxa de câmbio (pt-BR, até 4 casas — preserva a precisão p/ conferência). */
export const fmtTaxa = (t: number) =>
  t.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** Total por moeda negociada (um item = `valorMoedaNegociada` na sua `moeda`). */
export type MoedaTotal = { moeda: string; total: number }

/** Agrupa `valorMoedaNegociada` por `moeda` (nulls — itens sem detalhe, ex.:
 * não-pagos — são ignorados). Ordena USD na frente (moeda principal das
 * permutas) e as demais por valor decrescente. */
export const somaPorMoeda = (
  items: { valorMoedaNegociada: number | null; moeda: string }[],
): MoedaTotal[] => {
  const map = new Map<string, number>()
  for (const it of items) {
    if (it.valorMoedaNegociada == null) continue
    const moeda = moedaCodigo(it.moeda)
    map.set(moeda, (map.get(moeda) ?? 0) + it.valorMoedaNegociada)
  }
  return [...map.entries()]
    .map(([moeda, total]) => ({ moeda, total }))
    .sort((a, b) => (a.moeda === 'USD' ? -1 : b.moeda === 'USD' ? 1 : b.total - a.total))
}

/** Formata um total na sua moeda (US$ / € / …); fallback para "1.234 XXX" se a
 * moeda não for um código ISO reconhecido pelo Intl. */
export const fmtMoeda = (valor: number, moeda: string) => {
  try {
    return valor.toLocaleString('pt-BR', {
      style: 'currency',
      currency: moeda,
      maximumFractionDigits: 0,
    })
  } catch {
    return `${formatNumber(valor)} ${moeda}`
  }
}

/**
 * Resumo do lote de automáticas (botão "Executar"): adiantamentos ainda SEM borderô vinculado
 * (executáveis) + total a ser usado + o próximo lote (até `LOTE_MAX`).
 */
export interface LoteResumo {
  casos: number
  adtos: number
  proximosN: number
  proximosDocCods: string[]
  totalUsd: number
  moeda: string
}

/** Filtro de status aplicado à tabela de pendentes (dirigido pelos KPIs). */
export type FiltroStatus = 'todos' | StatusElegibilidade

/** Rótulo do estado-vazio por filtro de status. */
export const FILTRO_VAZIO_LABEL: Record<StatusElegibilidade, string> = {
  elegivel: 'elegível',
  bloqueada: 'bloqueado',
  'casamento-manual': 'em casamento manual',
  'permuta-manual': 'em permuta manual',
  'ja-permutado': 'já permutado',
}

/** Opções do seletor de Status (sincroniza com os KPIs via `filtro`). */
export const STATUS_OPCOES: { value: FiltroStatus; label: string }[] = [
  { value: 'todos', label: 'Todos os status' },
  { value: 'elegivel', label: 'Elegível' },
  { value: 'casamento-manual', label: 'Casamento manual (N:M)' },
  { value: 'permuta-manual', label: 'Permuta manual' },
  { value: 'ja-permutado', label: 'Já permutado' },
  { value: 'bloqueada', label: 'Bloqueada' },
]

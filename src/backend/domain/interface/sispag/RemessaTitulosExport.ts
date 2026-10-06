import type { LotePagamentoStatus } from './SispagInterface.js';

/**
 * Export (.xlsx) dos títulos das remessas já geradas — revisão do time financeiro da Columbia.
 *
 * Projeção read-only do que o lote já guarda (`lote_pagamento` + `lote_pagamento_item`): sem
 * estado, entidade ou invariante novo, sem ida ao Conexos. Não carrega destino do favorecido
 * (conta/chave) — só o que `GET /sispag/lotes` já mostra (ADR-0061 I10h).
 */

/** Máximo de lotes por export. Uma semana de remessas cabe com folga; acima disso, filtrar. */
export const MAX_LOTES_EXPORT = 50;

/** Status em que o lote TEM remessa gerada — os únicos exportáveis. */
export const STATUS_COM_REMESSA: readonly LotePagamentoStatus[] = [
    'REMESSA_GERADA',
    'RETORNADO',
    'BAIXADO',
];

/** Valor de célula. `Date` vira data do Excel (UTC, sem fuso); `null` vira célula em branco. */
export type CelulaExport = string | number | Date | null;

export interface ColunaExport {
    header: string;
    key: string;
    width: number;
    /** Formato numérico do Excel (ex.: `#,##0.00`, `dd/mm/yyyy`). */
    numFmt?: string;
}

/** A planilha ANTES da serialização — fronteira testável sem ler bytes do xlsx. */
export interface PlanilhaExport {
    titulo: string;
    colunas: ColunaExport[];
    linhas: Array<Record<string, CelulaExport>>;
    /** Linha final de totais (em negrito). */
    totais: Record<string, CelulaExport>;
}

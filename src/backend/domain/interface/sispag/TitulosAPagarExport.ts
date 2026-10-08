/**
 * Export (.xlsx) dos títulos a pagar da carteira — o que a aba "Títulos a pagar" mostra com o
 * filtro atual. A tela manda só as CHAVES das linhas filtradas; os valores vêm da carteira
 * persistida (a mesma fonte do painel), nunca do cliente. Projeção read-only, sem ida ao Conexos.
 */

/** Máximo de títulos por export — o mesmo teto do payload de títulos do painel. */
export const MAX_TITULOS_EXPORT = 5000;

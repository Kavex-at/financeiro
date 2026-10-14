import type { ChaveTitulo } from './SispagInterface.js';

/** Motivo da retirada automática (ADR-0069 emenda 1, I16d). */
export type MotivoRetiradaCodigoBarras = 'CODIGO_BARRAS_REPETIDO' | 'CODIGO_BARRAS_ILEGIVEL';

/**
 * Item retirado do lote pela guarda de código de barras (I16f(2)). Só a máscara 5+4 (I16e) —
 * nenhum campo carrega o código completo.
 */
export interface RetiradoPorCodigoBarras {
    titulo: ChaveTitulo;
    /** Ausente quando o item já não estava no lote local (resíduo limpo numa retomada). */
    valor?: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimento?: string;
    credor?: string;
    /** Máscara 5+4. Ausente em item ilegível lido sem código. */
    codigoMascarado?: string;
    /** Item do grupo que FICOU (só em repetido). */
    tituloMantido?: ChaveTitulo;
    motivo: MotivoRetiradaCodigoBarras;
}

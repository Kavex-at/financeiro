import type { EstadoElegibilidade, MotivoBloqueio } from './EstadoElegibilidade.js';

/**
 * ExcecaoPermuta — marca do analista de que um adiantamento já foi permutado fora
 * do fluxo de permuta do Conexos (ADR-0047). Configuração do cliente, no padrão do
 * `ClienteFiltro` (ADR-0007): a forma está na ontologia, as instâncias no banco.
 *
 * Ontology: `ontology/entities/excecao-permuta.md`. Ativa ⇔ `removidoEm` ausente.
 * Autor e datas vêm do servidor e do JWT verificado, nunca de input do cliente.
 */
export default interface ExcecaoPermuta {
    id: string;
    adiantamentoDocCod: string;
    justificativa: string;
    criadoPor: string;
    criadoEm: Date;
    removidoPor?: string;
    removidoEm?: Date;
}

/** Entrada da gravação de uma exceção ativa. */
export interface InsertExcecaoPermutaInput {
    adiantamentoDocCod: string;
    justificativa: string;
    criadoPor: string;
}

/** Entrada do soft delete da exceção ativa de um adiantamento. */
export interface SoftDeleteExcecaoPermutaInput {
    adiantamentoDocCod: string;
    removidoPor: string;
}

/**
 * Exceção ativa que NÃO foi aplicada numa run porque o estado calculado deixou de
 * ser `BLOQUEADA / sem-saldo-permutar` (I-Exc-2: o ERP vence). Vira `BUSINESS_WARN`.
 */
export interface AvisoExcecaoInaplicavel {
    docCod: string;
    estadoCalculado: EstadoElegibilidade;
    motivoCalculado?: MotivoBloqueio;
    /** `true` quando o motivo é leitura indisponível do Conexos nesta run (blip), não mudança real. */
    transiente: boolean;
}

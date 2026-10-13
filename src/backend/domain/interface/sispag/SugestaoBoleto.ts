/**
 * Sugestão e confirmação de boleto DDA (ADR-0068, I15). Ver
 * `ontology/business-rules/sugestao-boleto-dda-sispag.md`.
 *
 * Passo 1: mostrar ao analista o boleto livre do `fin124` que provavelmente é o do título e
 * registrar a decisão dele por (credor `pesCod`, emissor `emissorChave`). Confirmação é EVIDÊNCIA,
 * não autoridade (I15a): nada aqui escreve no Conexos.
 */

/**
 * Como a chave do emissor foi derivada do código de barras. Só 341 e 237 têm layout verificado
 * (medido em PRD 2026-10-14: 244 de 290 candidatos únicos, 84 %); os demais usam a chave genérica
 * e NUNCA são elegíveis a automático (I15i).
 */
export const LAYOUT_EMISSOR = {
    ITAU_341: 'ITAU_341',
    BRADESCO_237: 'BRADESCO_237',
    GENERICO: 'GENERICO',
} as const;
export type LayoutEmissor = (typeof LAYOUT_EMISSOR)[keyof typeof LAYOUT_EMISSOR];

/**
 * Conta emissora do boleto, derivada do código de barras de 44 dígitos.
 * `chave` e `mascarado` nunca contêm as barras completas nem a linha digitável (I15k).
 */
export interface EmissorBoleto {
    /** Código FEBRABAN do banco emissor (3 dígitos). */
    banco: string;
    layout: LayoutEmissor;
    /** `341:<agência>:<conta>`, `237:<agência>:<conta>` ou `<banco>:<8 dígitos do campo livre>`. */
    chave: string;
    /** Exibição: banco e agência completos, conta com os 4 últimos dígitos (padrão I14l). */
    mascarado: string;
}

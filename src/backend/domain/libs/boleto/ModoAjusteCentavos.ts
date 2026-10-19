/** Modos do ajuste de centavos do título, por filial (I18l, ADR-0073). Default `off`. */
export const MODO_AJUSTE = {
    /** Default. Nada acontece; a UI mostra "diferença de centavos — ajuste desligado". */
    OFF: 'off',
    /** I18a inteira AO VIVO (leituras no ERP), zero escrita; grava `AJUSTE_SIMULADO`. */
    SHADOW: 'shadow',
    /** Executa a renegociação (I18c–j). */
    ON: 'on',
} as const;
export type ModoAjuste = (typeof MODO_AJUSTE)[keyof typeof MODO_AJUSTE];

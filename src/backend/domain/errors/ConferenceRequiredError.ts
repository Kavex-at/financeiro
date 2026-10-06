import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * `gerarRemessa` (L8) de lote com TED/PIX que ainda não foi conferido por uma segunda pessoa
 * (ADR-0063, I13l). Checado ANTES de qualquer chamada ao ERP. Lote só de boleto não exige. HTTP 409.
 */
export default class ConferenceRequiredError extends Error implements HandlerError {
    public readonly code = 'CONFERENCIA_OBRIGATORIA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { loteId: string }) {
        super(`lot ${params.loteId} has TED/PIX items and was not checked by a second person`);
        this.name = 'ConferenceRequiredError';
        this.userMessage =
            'Este lote tem pagamentos TED/PIX e precisa ser conferido por uma segunda pessoa antes ' +
            'de gerar a remessa. Peça a conferência a quem tem a permissão "SISPAG — conferir".';
        this.details = { loteId: params.loteId };
    }
}

import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * TED/PIX pedido num item enquanto a guarda do favorecido autorizado (ou a flag da modalidade) está
 * desligada no tenant (ADR-0065 I14k): nunca existe TED/PIX sem controle de troca de conta.
 * HTTP 422.
 */
export default class PaymentModalityUnavailableError extends Error implements HandlerError {
    public readonly code = 'MODALIDADE_TED_PIX_INDISPONIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { loteId: string; modalidade: string }) {
        super(`Modality ${params.modalidade} unavailable in lot ${params.loteId}: payee guard off`);
        this.name = 'PaymentModalityUnavailableError';
        this.userMessage =
            `${params.modalidade} não está disponível: o controle de favorecidos autorizados ainda ` +
            'não foi ligado. Use boleto ou peça a liberação de TED/PIX.';
        this.details = { loteId: params.loteId, modalidade: params.modalidade };
    }
}

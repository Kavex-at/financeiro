import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O cadastro do Conexos (`cmn025`) não tem conta (TED) ou chave PIX para o favorecido (ADR-0065
 * F2/F6): não há destino a aprovar. HTTP 422.
 */
export default class PayeeWithoutPaymentDataError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_SEM_DADO_PAGAMENTO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { id: string; modalidade: string }) {
        super(`Payee authorization ${params.id}: no payment data in the ERP registry`);
        this.name = 'PayeeWithoutPaymentDataError';
        this.userMessage = `O cadastro do Conexos não tem ${params.modalidade === 'PIX' ? 'chave PIX' : 'conta bancária'} para este favorecido. Peça ao responsável pelo cadastro do Conexos para incluir o dado e tente de novo.`;
        this.details = { id: params.id, modalidade: params.modalidade };
    }
}

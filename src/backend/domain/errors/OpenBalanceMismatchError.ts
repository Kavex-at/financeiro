import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O em-aberto VIVO do título no ERP não comporta a baixa (I-Write-1, anti-over-pay):
 *   - `zerado`   — o ERP diz que não há nada em aberto (já baixado por fora) → 409, conflito de estado;
 *   - `excedido` — a baixa calculada passa do em-aberto + tolerância → 422, a alocação não cabe.
 *
 * Roda dentro do laço de baixas da reconciliação (continue-on-error): lá o `userMessage` vira o texto
 * da trilha do par, então ele é o próprio `message` que o serviço já gravava — o tipo muda, o texto não.
 */
export default class OpenBalanceMismatchError extends Error implements HandlerError {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode: number;
    public readonly details?: unknown;

    constructor(params: {
        motivo: 'zerado' | 'excedido';
        message: string;
        invoiceDocCod: number;
        titCod: number;
    }) {
        super(params.message);
        this.name = 'OpenBalanceMismatchError';
        this.code = params.motivo === 'zerado' ? 'TITULO_SEM_EM_ABERTO' : 'BAIXA_EXCEDE_EM_ABERTO';
        this.statusCode = params.motivo === 'zerado' ? 409 : 422;
        this.userMessage = params.message;
        this.details = {
            motivo: params.motivo,
            invoiceDocCod: params.invoiceDocCod,
            titCod: params.titCod,
        };
    }
}

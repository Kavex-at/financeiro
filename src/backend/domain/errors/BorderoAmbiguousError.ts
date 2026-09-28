import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O nº do borderô é sequencial POR FILIAL e a trilha o conhece em mais de uma. Agir no palpite
 * escreveria no borderô de outra filial, então a ação para e pede o `filCod`. O pedido está
 * incompleto e quem corrige é o cliente → 400 (o mesmo status que a rota já devolvia).
 */
export default class BorderoAmbiguousError extends Error implements HandlerError {
    public readonly code = 'BORDERO_AMBIGUO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 400;
    public readonly details?: unknown;

    constructor(params: { borCod: number; filiais: number[] }) {
        super(
            `Borderô ${params.borCod} existe na trilha em mais de uma filial (${params.filiais.join(', ')}) ` +
                '— informe a filial (`filCod`) para identificar qual deles.',
        );
        this.name = 'BorderoAmbiguousError';
        this.userMessage = this.message;
        this.details = params;
    }
}

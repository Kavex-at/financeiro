import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O ajuste de centavos do título parou numa falha transitória ou ambígua (I18h): o ledger ficou NÃO
 * terminal e a retomada continua de onde parou (nunca abre uma segunda renegociação). HTTP 409.
 */
export default class CentsAdjustmentIncompleteError extends Error implements HandlerError {
    public readonly code = 'AJUSTE_CENTAVOS_INCOMPLETO';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details: { filCod: number; docCod: string; titCod: string; etapa: string };

    public constructor(params: { filCod: number; docCod: string; titCod: string; etapa: string }) {
        super(
            `Cents adjustment of title ${params.filCod}:${params.docCod}:${params.titCod} stopped at ${params.etapa}; resumable`,
        );
        this.name = 'CentsAdjustmentIncompleteError';
        this.userMessage =
            `O ajuste de centavos do título ${params.docCod}/${params.titCod} não terminou ` +
            '(o Conexos não respondeu de forma conclusiva). Ele será retomado de onde parou: ' +
            'tente de novo em alguns minutos.';
        this.details = { ...params };
    }
}

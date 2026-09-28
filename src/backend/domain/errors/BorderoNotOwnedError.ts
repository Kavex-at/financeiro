import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Autorização server-side das ações de borderô (Regis-Review P0 security — confused-deputy): o
 * borderô pedido não está na trilha deste sistema — ou não naquela filial. 403.
 *
 * O `message` mantém o prefixo `FORBIDDEN:` que a rota usava para achar o 403 por texto; o
 * `userMessage` é o mesmo texto sem o prefixo, que é exatamente o que a tela já exibia.
 */
export default class BorderoNotOwnedError extends Error implements HandlerError {
    public readonly code = 'BORDERO_FORA_DA_TRILHA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    constructor(params: { borCod: number; filCod?: number }) {
        const texto =
            params.filCod === undefined
                ? `borderô ${params.borCod} não foi criado por este sistema — ação não permitida`
                : `borderô ${params.borCod} da filial ${params.filCod} não foi criado ` +
                  'por este sistema — ação não permitida';
        super(`FORBIDDEN: ${texto}`);
        this.name = 'BorderoNotOwnedError';
        this.userMessage = texto;
        this.details = params;
    }
}

import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * A escrita no Conexos está desligada neste ambiente (`CONEXOS_WRITE_ENABLED=false`) e a ação
 * pedida só existe escrevendo. Não é defeito nem pedido errado: o recurso está indisponível por
 * configuração → 503. Não é `retryable` — repetir não religa a chave; quem liga é o deploy.
 */
export default class ConexosWriteDisabledError extends Error implements HandlerError {
    public readonly code = 'CONEXOS_ESCRITA_DESABILITADA';
    public readonly userMessage =
        'A escrita no Conexos está desligada neste ambiente (CONEXOS_WRITE_ENABLED=false). ' +
        'Nada foi enviado ao ERP.';
    public readonly retryable = false;
    public readonly statusCode = 503;
    public readonly details?: unknown;

    constructor() {
        super('escrita no Conexos desabilitada (CONEXOS_WRITE_ENABLED=false)');
        this.name = 'ConexosWriteDisabledError';
    }
}

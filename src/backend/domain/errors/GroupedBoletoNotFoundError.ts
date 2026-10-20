import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Anular/consultar um grupo de boleto que não existe. HTTP 404. */
export default class GroupedBoletoNotFoundError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_NAO_ENCONTRADO';
    public readonly userMessage = 'Grupo de boleto não encontrado. Atualize a lista.';
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details: { grupoId: string };

    public constructor(params: { grupoId: string }) {
        super(`Grouped boleto ${params.grupoId} not found`);
        this.name = 'GroupedBoletoNotFoundError';
        this.details = { grupoId: params.grupoId };
    }
}

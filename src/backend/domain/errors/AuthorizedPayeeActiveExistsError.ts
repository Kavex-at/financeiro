import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Já existe autorização vigente (PENDENTE, AUTORIZADO ou REAPROVACAO_PENDENTE) para o favorecido na
 * modalidade (ADR-0065, índice de vigência). HTTP 409.
 */
export default class AuthorizedPayeeActiveExistsError extends Error implements HandlerError {
    public readonly code = 'AUTORIZACAO_JA_VIGENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { pesCod: string; modalidade: string; estado?: string }) {
        super(
            `Active payee authorization already exists for ${params.pesCod}/${params.modalidade}`,
        );
        this.name = 'AuthorizedPayeeActiveExistsError';
        this.userMessage = `Já existe uma autorização ${params.estado ? `${params.estado.toLowerCase().replace('_', ' ')} ` : ''}para este favorecido em ${params.modalidade}.`;
        this.details = {
            pesCod: params.pesCod,
            modalidade: params.modalidade,
            ...(params.estado ? { estado: params.estado } : {}),
        };
    }
}

import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Rejeitar e revogar exigem motivo (ADR-0061, E3/E5); cadastrar exige justificativa. HTTP 400. */
export default class ExcecaoMotivoObrigatorioError extends Error implements HandlerError {
    public readonly code = 'EXCECAO_MOTIVO_OBRIGATORIO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 400;
    public readonly details?: unknown;

    public constructor(params: { campo: 'motivo' | 'justificativa' }) {
        super(`destination exception ${params.campo} is required`);
        this.name = 'ExcecaoMotivoObrigatorioError';
        this.userMessage =
            params.campo === 'motivo'
                ? 'Informe o motivo.'
                : 'Informe a justificativa: por que o destino difere do cadastro do Conexos.';
        this.details = { campo: params.campo };
    }
}

import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Um passo do handshake de escrita no Conexos (validações do `fin010`, `gerDocProcesso`) respondeu
 * HTTP 200 com `valid='ERRO'` no envelope, ou sem os dados que o passo seguinte exige. O upstream
 * respondeu e a resposta não serve → 502, como a recusa do `ConexosError`.
 *
 * Não reusa o `ConexosError` de propósito: o `userMessage` dele é montado a partir do `cause` Axios,
 * que aqui não existe, e o texto da trilha viraria o genérico "O ERP Conexos retornou um erro". Este
 * erro carrega a razão já interpretada no `message`, e é esse texto que a analista lê.
 * Não é `retryable`: repetir uma escrita no meio do handshake é decisão humana.
 */
export default class ErpHandshakeError extends Error implements HandlerError {
    public readonly code = 'ERP_HANDSHAKE_RECUSADO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 502;
    public readonly details?: unknown;

    constructor(params: { passo: string; message: string }) {
        super(params.message);
        this.name = 'ErpHandshakeError';
        this.userMessage = params.message;
        this.details = { passo: params.passo };
    }
}

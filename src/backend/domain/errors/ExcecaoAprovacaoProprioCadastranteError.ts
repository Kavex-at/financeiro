import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Quem cadastrou a exceção de destino não pode aprová-la (ADR-0061, I12b). Falha fechada: vale
 * também quando o id de um dos lados falta. HTTP 403.
 *
 * A mensagem não traz conta nem chave (I10h) — só o id da exceção.
 */
export default class ExcecaoAprovacaoProprioCadastranteError extends Error implements HandlerError {
    public readonly code = 'EXCECAO_APROVACAO_PROPRIO_CADASTRANTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    public constructor(params: { excecaoId?: string } = {}) {
        super('destination exception cannot be approved by the user who registered it');
        this.name = 'ExcecaoAprovacaoProprioCadastranteError';
        this.userMessage =
            'Quem cadastrou a exceção de destino não pode aprová-la. Peça a outra pessoa com a ' +
            'permissão "Exceção de destino (SISPAG)" para aprovar.';
        this.details = params.excecaoId ? { excecaoId: params.excecaoId } : undefined;
    }
}

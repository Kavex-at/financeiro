import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Transição inválida da exceção de destino (ADR-0060, `state-machines/excecao-destino.md`): ação
 * incompatível com o estado atual, ou o estado mudou entre a leitura e a gravação (transição com
 * `WHERE estado = esperado` não encontrou linha). HTTP 409.
 */
export default class ExcecaoEstadoInvalidoError extends Error implements HandlerError {
    public readonly code = 'EXCECAO_ESTADO_INVALIDO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { excecaoId?: string; estadoAtual?: string; acao: string }) {
        super(
            `destination exception action "${params.acao}" invalid in state ${params.estadoAtual ?? 'unknown'}`,
        );
        this.name = 'ExcecaoEstadoInvalidoError';
        const estado = params.estadoAtual ? ` (${params.estadoAtual})` : '';
        this.userMessage = `Não é possível ${params.acao} esta exceção: ela já mudou de estado${estado}. Recarregue a tela.`;
        this.details = {
            ...(params.excecaoId ? { excecaoId: params.excecaoId } : {}),
            ...(params.estadoAtual ? { estadoAtual: params.estadoAtual } : {}),
            acao: params.acao,
        };
    }
}

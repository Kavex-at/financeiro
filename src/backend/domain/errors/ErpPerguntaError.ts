import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O Conexos interrompeu a operação com uma PERGUNTA em vez de um erro:
 * `{ type: 'QUESTION', questions: [{ key, parameterValueList, answerList: [YES, ABORT] }] }`.
 *
 * Observado no `titulosPendentes/importar` quando o favorecido não tem conta ativa no banco do
 * lote (`FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO`)
 * — responder `YES` ALTERA A MODALIDADE DE PAGAMENTO do título.
 *
 * Decisão de desenho: NÃO respondemos automaticamente. Mudar a forma de pagamento de um título
 * é decisão de quem opera, não de um serviço. A pergunta sobe para a tela com o texto do ERP.
 * Rota → HTTP 409.
 */
export default class ErpPerguntaError extends Error implements HandlerError {
    public readonly code = 'ERP_PERGUNTA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: { chave: string; parametros?: Record<string, unknown>; contexto: string }) {
        super(`ERP asked a question during ${params.contexto}: ${params.chave}`);
        this.name = 'ErpPerguntaError';
        this.userMessage = `O Conexos pediu uma confirmação que exige decisão humana (${params.chave}). Resolva no ERP e tente de novo.`;
        this.details = params;
    }
}

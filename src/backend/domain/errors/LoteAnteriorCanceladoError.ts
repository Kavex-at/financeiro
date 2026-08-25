import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O lote nativo de uma tentativa anterior foi CANCELADO no Conexos por uma pessoa.
 *
 * Isto NÃO é um erro do sistema — é uma bifurcação que só quem cancelou sabe resolver.
 * Cancelar o órfão é exatamente a limpeza que a nossa própria mensagem de 409 prescreve;
 * nesse caso o retry deve seguir e criar um lote novo. Mas o cancelamento também pode ter
 * sido a decisão de ABORTAR o pagamento — e aí gerar outro lote desfaria essa escolha.
 *
 * Como o sistema não consegue distinguir as duas intenções pelo estado do ERP (ambas
 * deixam `flpVldStatus` 2), quem distingue é a pessoa: a tela pergunta e um segundo
 * clique manda `confirmarNovoLote`. Custa uma interação, e não uma ida ao fin015.
 *
 * Rota → HTTP 409, com `code` próprio para a UI abrir o diálogo em vez de mostrar erro.
 */
export default class LoteAnteriorCanceladoError extends Error implements HandlerError {
    public readonly code = 'LOTE_ANTERIOR_CANCELADO';
    public readonly userMessage: string;
    /** Retryable: basta repetir com `confirmarNovoLote`. */
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: { loteId: string; flpCodCancelado: number; filCod: number }) {
        super(`lote nativo ${params.flpCodCancelado} cancelado — confirmação necessária`);
        this.name = 'LoteAnteriorCanceladoError';
        this.userMessage =
            `O lote ${params.flpCodCancelado} da filial ${params.filCod} foi cancelado no Conexos. ` +
            'Se o cancelamento foi para limpar uma tentativa que travou, confirme para gerar um ' +
            'lote novo. Se foi para interromper o pagamento, não confirme.';
        this.details = params;
    }
}

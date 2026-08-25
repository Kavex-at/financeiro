import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * FAIL-CLOSED. Existe uma conciliação `reconciling` órfã para este arquivo de retorno: o
 * `processar` foi iniciado e não confirmou. O estado real no ERP é DESCONHECIDO — as baixas
 * do fin010 podem ter sido geradas.
 *
 * Repetir seria pior do que parar: `arquivosRetorno/processar` não é idempotente, e uma
 * segunda passada grava baixas em cima das antigas. Exige olhar humano: conferir no fin010
 * se as baixas do borderô já existem antes de liberar.
 *
 * Espelha `RemessaEmDuvidaError`. Rota → HTTP 409.
 */
export default class ConciliacaoEmDuvidaError extends Error implements HandlerError {
    public readonly code = 'CONCILIACAO_EM_DUVIDA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: {
        idempotencyKey: string;
        filCod: number;
        bncCod: number;
        garCodSeq: number;
        criadoEm?: string;
    }) {
        super(
            `conciliação IN-DOUBT for arquivo ${params.garCodSeq} (key ${params.idempotencyKey})`,
        );
        this.name = 'ConciliacaoEmDuvidaError';
        const desde = params.criadoEm
            ? new Date(params.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
            : undefined;
        this.userMessage =
            `Há uma conciliação anterior deste retorno sem confirmação${desde ? ` (iniciada em ${desde})` : ''}. ` +
            'O processamento pode ter gerado as baixas no fin010 antes de falhar. Confira no ' +
            `borderô da filial ${params.filCod} se as baixas já existem — repetir agora poderia ` +
            'gravar baixa em cima de baixa.';
        this.details = params;
    }
}

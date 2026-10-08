import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O `finalizarLote` retirou TODOS os itens do lote pela verificação do favorecido autorizado
 * (ADR-0065 I13j, L3): o lote fica RASCUNHO e as retiradas ficam gravadas na trilha. Nomeia
 * títulos e motivos, nunca conta/chave (I10h). HTTP 409.
 */
export default class BatchEmptiedByCheckError extends Error implements HandlerError {
    public readonly code = 'LOTE_ESVAZIADO_PELA_VERIFICACAO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        loteId: string;
        itens: Array<{
            docCod: string;
            titCod: string;
            credor?: string;
            modalidade?: string;
            motivo: string;
        }>;
    }) {
        super(
            `Finalize emptied lot ${params.loteId}: ${params.itens.map((i) => `${i.docCod}/${i.titCod}=${i.motivo}`).join(', ')}`,
        );
        this.name = 'BatchEmptiedByCheckError';
        const semDado = params.itens.some((i) => i.motivo === 'SEM_DADO_PAGAMENTO');
        this.userMessage =
            `A verificação retirou todos os ${params.itens.length} item(ns) do lote, que continua em ` +
            'rascunho. Os favorecidos precisam de autorização para TED/PIX' +
            (semDado
                ? ' (para os sem conta ou chave, pedir ao responsável pelo cadastro do Conexos)'
                : '') +
            '. Peça a autorização ou troque a forma de pagamento e finalize de novo.';
        this.details = {
            loteId: params.loteId,
            itens: params.itens.map((i) => ({ item: `${i.docCod}/${i.titCod}`, motivo: i.motivo })),
        };
    }
}

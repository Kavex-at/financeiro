import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * A verificação do `finalizarLote` RETIROU item(ns) TED/PIX sem dado de pagamento no cadastro do
 * Conexos e sem exceção aprovada (ADR-0063, I13j-1; gap Q5). A retirada fica gravada, o lote segue
 * RASCUNHO e a finalização não acontece: a analista revê o lote que vai finalizar. Uma pendência de
 * cadastro foi aberta para cada favorecido. Nomeia títulos, nunca conta/chave (I10h). HTTP 409.
 */
export default class ItemsRemovedByCheckError extends Error implements HandlerError {
    public readonly code = 'ITENS_RETIRADOS_PELA_VERIFICACAO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        loteId: string;
        itens: Array<{ docCod: string; titCod: string; credor?: string; modalidade?: string }>;
    }) {
        super(
            `TED/PIX check removed ${params.itens.length} item(s) from lot ${params.loteId}: ${params.itens.map((i) => `${i.docCod}/${i.titCod}`).join(', ')}`,
        );
        this.name = 'ItemsRemovedByCheckError';
        const nomes = params.itens.map(
            (i) =>
                `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}${i.modalidade ? ` — ${i.modalidade}` : ''}`,
        );
        this.userMessage =
            `A verificação retirou do lote ${params.itens.length} item(ns) sem conta (TED) ou chave ` +
            `PIX no cadastro do Conexos: ${nomes.join('; ')}. Uma pendência de cadastro foi aberta ` +
            'para o favorecido. Revise o lote e finalize de novo.';
        this.details = {
            loteId: params.loteId,
            itens: params.itens.map((i) => `${i.docCod}/${i.titCod}`),
        };
    }
}

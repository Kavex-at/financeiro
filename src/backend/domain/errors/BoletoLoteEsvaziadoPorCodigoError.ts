import type { MotivoRetiradaCodigoBarras } from '../interface/sispag/RetiradaCodigoBarras.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';

export interface ItemEsvaziado {
    docCod: string;
    titCod: string;
    motivo: MotivoRetiradaCodigoBarras;
}

/**
 * A retirada automática por código de barras tirou TODOS os itens do lote (ADR-0069 emenda 1,
 * I16d.7) — só é possível pela cláusula de ilegível. Espelho de `BatchEmptiedByCheckError`: o
 * rascunho nativo vazio permanece, o lote não finaliza, o ledger falha. HTTP 409.
 * Nomeia títulos e motivos, nunca o código.
 */
export default class BoletoLoteEsvaziadoPorCodigoError extends Error implements HandlerError {
    public readonly code = 'BOLETO_LOTE_ESVAZIADO_POR_CODIGO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: unknown;

    public constructor(params: { loteId: string; flpCod?: number; itens: ItemEsvaziado[] }) {
        const ids = params.itens.map((i) => `${i.docCod}/${i.titCod}=${i.motivo}`);
        super(
            `Barcode check emptied lot ${params.loteId}${
                params.flpCod !== undefined ? ` (flpCod ${params.flpCod})` : ''
            }: ${ids.join(', ')}`,
        );
        this.name = 'BoletoLoteEsvaziadoPorCodigoError';
        this.userMessage =
            `Todos os ${params.itens.length} título(s) do lote foram retirados porque o código de ` +
            'barras do boleto está ilegível, repetido ou não pôde ser vinculado. Nada foi enviado ao banco e o rascunho no ' +
            'Conexos ficou vazio. Revise os boletos, resolva o código no Conexos ' +
            '(ou troque a forma de pagamento) e monte o lote de novo.' +
            (params.flpCod !== undefined ? ` Lote nativo no Conexos: ${params.flpCod}.` : '');
        this.details = {
            loteId: params.loteId,
            ...(params.flpCod !== undefined ? { flpCod: params.flpCod } : {}),
            itens: params.itens.map((i) => ({ item: `${i.docCod}/${i.titCod}`, motivo: i.motivo })),
        };
    }
}

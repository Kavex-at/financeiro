import type { HandlerError } from '../libs/handler/HandlerError.js';

/** O que, no item do rascunho, difere do que gravaríamos (I17f). */
export const CAMPO_EDITADO_POR_TERCEIRO = {
    CODIGO: 'CODIGO',
    VALOR: 'VALOR',
    DATA: 'DATA',
    BANCO: 'BANCO',
} as const;
export type CampoEditadoPorTerceiro =
    (typeof CAMPO_EDITADO_POR_TERCEIRO)[keyof typeof CAMPO_EDITADO_POR_TERCEIRO];

export interface ItemEditadoPorTerceiroParams {
    docCod: string;
    titCod: string;
    campo: CampoEditadoPorTerceiro;
    flpCod?: number;
}

const ROTULO: Record<CampoEditadoPorTerceiro, string> = {
    CODIGO: 'o código de barras do item é diferente do esperado',
    VALOR: 'o valor do item é diferente do que gravaríamos',
    DATA: 'a data de pagamento do item é diferente da que gravaríamos',
    BANCO: 'o banco do item é diferente do que gravaríamos',
};

/**
 * O item do rascunho foi editado por outra pessoa (ADR-0071, I17f): `itsNumCodbar`, valor ou data
 * diferentes do esperado. Fail-closed: nada é sobrescrito, nada é retirado, a etapa é
 * `indeterminado` (espelho da I16h(b)) e quem resolve é a analista no Conexos.
 *
 * Não expõe o código (nem o do item, nem o esperado): diz só QUAL campo divergiu.
 */
export default class ItemEditadoPorTerceiroError extends Error implements HandlerError {
    public readonly code = 'ITEM_EDITADO_POR_TERCEIRO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: unknown;

    public constructor(params: ItemEditadoPorTerceiroParams) {
        const sanear = (t: string): string => t.replace(/\d{10,}/g, '…');
        const doc = sanear(String(params.docCod));
        const tit = sanear(String(params.titCod));
        super(`item ${doc}/${tit} edited by a third party: ${params.campo}`);
        this.name = 'ItemEditadoPorTerceiroError';
        const onde =
            params.flpCod !== undefined ? ` Lote nativo no Conexos: ${Number(params.flpCod)}.` : '';
        this.userMessage =
            `O item ${doc}/${tit} do rascunho foi alterado por outra pessoa no Conexos: ` +
            `${ROTULO[params.campo]}. Por segurança nada foi sobrescrito nem retirado e nada foi ` +
            `enviado ao banco. Confira o rascunho no Conexos antes de gerar a remessa de novo.` +
            onde;
        this.details = {
            docCod: doc,
            titCod: tit,
            campo: params.campo,
            etapa: 'indeterminado',
            ...(params.flpCod !== undefined ? { flpCod: Number(params.flpCod) } : {}),
        };
    }
}

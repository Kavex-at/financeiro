import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

const F = GroupedBoletoErrorFormat;

/**
 * Confirmar grupo com títulos de filiais diferentes (I19d, P0-3): não suportado — o borderô e o
 * lote são de uma filial só. HTTP 422.
 */
export default class GroupedBoletoCrossBranchError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_CRUZA_FILIAL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details: { filiais: number[]; ddcCod: number; ditCod: number };

    public constructor(params: { filiais: number[]; ddcCod: number; ditCod: number }) {
        const filiais = [...new Set(params.filiais)].sort((a, b) => a - b);
        super(
            `Grouped boleto crosses branches ${filiais.join(',')}: boleto ${params.ddcCod}/${params.ditCod}`,
        );
        this.name = 'GroupedBoletoCrossBranchError';
        this.userMessage =
            `Os títulos são das filiais ${F.lista(filiais.map(String))}: um boleto agrupado só ` +
            'pode pagar títulos de uma filial. Não suportado; pague à mão.';
        this.details = { filiais, ddcCod: params.ddcCod, ditCod: params.ditCod };
    }
}

import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

const F = GroupedBoletoErrorFormat;

/**
 * Confirmar grupo: a soma dos líquidos dos títulos difere do valor do boleto (I19b, D3). Nenhuma
 * tolerância: um centavo já recusa. HTTP 422.
 */
export default class GroupedBoletoSumMismatchError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_SOMA_DIVERGENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details: {
        filCod: number;
        ddcCod: number;
        ditCod: number;
        codigoMascarado?: string;
        valorBoletoCentavos: number;
        somaTitulosCentavos: number;
        deltaCentavos: number;
    };

    public constructor(params: {
        filCod: number;
        ddcCod: number;
        ditCod: number;
        codigoMascarado?: string;
        valorBoletoCentavos: number;
        somaTitulosCentavos: number;
    }) {
        const deltaCentavos = params.valorBoletoCentavos - params.somaTitulosCentavos;
        const mascara =
            params.codigoMascarado !== undefined ? F.mascarar(params.codigoMascarado) : undefined;
        super(
            `Grouped boleto sum mismatch: boleto ${params.ddcCod}/${params.ditCod} (branch ${params.filCod}) is ${params.valorBoletoCentavos} cents, titles sum ${params.somaTitulosCentavos} (delta ${deltaCentavos})`,
        );
        this.name = 'GroupedBoletoSumMismatchError';
        this.userMessage =
            `O boleto${mascara !== undefined ? ` ${mascara}` : ''} (filial ${params.filCod}) é de ` +
            `${F.reais(params.valorBoletoCentavos)}, mas os títulos somam ` +
            `${F.reais(params.somaTitulosCentavos)} (diferença de ${F.reais(Math.abs(deltaCentavos))}). ` +
            'A soma precisa bater ao centavo; se não bater, pague à mão.';
        this.details = {
            filCod: params.filCod,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
            ...(mascara !== undefined ? { codigoMascarado: mascara } : {}),
            valorBoletoCentavos: params.valorBoletoCentavos,
            somaTitulosCentavos: params.somaTitulosCentavos,
            deltaCentavos,
        };
    }
}

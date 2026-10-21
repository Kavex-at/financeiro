import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

/**
 * Confirmar: o boleto já está em OUTRO grupo `CONFIRMADO` com títulos diferentes (I19i). Confirmar
 * de novo o MESMO conjunto não chega aqui (devolve o grupo existente). HTTP 409; só a máscara do
 * código sai (I17j).
 */
export default class GroupedBoletoAlreadyGroupedError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_BOLETO_EM_OUTRO_GRUPO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: { grupoExistenteId: string; ddcCod: number; ditCod: number };

    public constructor(params: {
        grupoExistenteId: string;
        ddcCod: number;
        ditCod: number;
        codbarMascarado: string;
    }) {
        super(
            `Boleto ${params.ddcCod}/${params.ditCod} already belongs to confirmed group ${params.grupoExistenteId}`,
        );
        this.name = 'GroupedBoletoAlreadyGroupedError';
        this.userMessage =
            `O boleto ${GroupedBoletoErrorFormat.mascarar(params.codbarMascarado)} já está em outro ` +
            'grupo confirmado, com outros títulos. Anule aquele grupo antes de compor este.';
        this.details = {
            grupoExistenteId: params.grupoExistenteId,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
        };
    }
}

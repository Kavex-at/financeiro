import type { HandlerError } from '../libs/handler/HandlerError.js';
import GroupedBoletoErrorFormat from './GroupedBoletoErrorFormat.js';

const F = GroupedBoletoErrorFormat;

/**
 * Retirar ou mover UM título de um grupo (I21j, P1-1): o grupo entra, sai e se move inteiro.
 * Traz o id do grupo e os N títulos, que a tela lista. HTTP 409.
 */
export default class GroupedBoletoIndivisibleError extends Error implements HandlerError {
    public readonly code = 'GRUPO_BOLETO_INDIVISIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: {
        grupoId: string;
        codigoMascarado?: string;
        titulos: Array<{ filCod: number; docCod: string; titCod: string }>;
    };

    public constructor(params: {
        grupoId: string;
        codigoMascarado?: string;
        titulos: Array<{ filCod: number; docCod: string; titCod: string }>;
    }) {
        const mascara =
            params.codigoMascarado !== undefined ? F.mascarar(params.codigoMascarado) : undefined;
        super(
            `Grouped boleto ${params.grupoId} is indivisible: ${params.titulos.map((t) => `${t.filCod}:${t.docCod}:${t.titCod}`).join(', ')}`,
        );
        this.name = 'GroupedBoletoIndivisibleError';
        this.userMessage =
            `O título faz parte de um boleto agrupado${mascara !== undefined ? ` (${mascara})` : ''} ` +
            `com ${F.lista(params.titulos.map(F.titulo))}. Retire, mova ou anule o grupo inteiro.`;
        this.details = {
            grupoId: params.grupoId,
            ...(mascara !== undefined ? { codigoMascarado: mascara } : {}),
            titulos: params.titulos.map((t) => ({
                filCod: t.filCod,
                docCod: t.docCod,
                titCod: t.titCod,
            })),
        };
    }
}

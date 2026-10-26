import type { HandlerError } from '../libs/handler/HandlerError.js';
import Format from './DivergenceAcknowledgementFormat.js';

/**
 * O candidato exige o reconhecimento tipado da divergência de data (`exigeReconhecimento =
 * DATA_DIVERGENTE`, I15q, ADR-0078) e o pedido não o trouxe. Validado no servidor contra a avaliação
 * recalculada ao vivo. HTTP 422. O código aparece só mascarado (5+4).
 */
export default class DivergenceAcknowledgementRequiredError extends Error implements HandlerError {
    public readonly code = 'RECONHECIMENTO_DE_DIVERGENCIA_OBRIGATORIO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: {
        filCod: number;
        docCod: string;
        titCod: string;
        ddcCod: number;
        ditCod: number;
        deltaDias: number;
        /** Valor do boleto, em centavos. */
        valorBoleto: number;
        vencimentoTitulo: string;
        vencimentoBoleto: string;
        codigoMascarado?: string;
    }) {
        super(
            `Divergence acknowledgement required: ${params.filCod}/${params.docCod}/${params.titCod} x ${params.ddcCod}/${params.ditCod} (delta ${params.deltaDias})`,
        );
        this.name = 'DivergenceAcknowledgementRequiredError';
        const codigo = params.codigoMascarado ? ` (código ${params.codigoMascarado})` : '';
        this.userMessage =
            `O boleto${codigo} de ${Format.formatarCentavos(params.valorBoleto)} vence em ` +
            `${Format.formatarData(params.vencimentoBoleto)}, ${Format.formatarDelta(params.deltaDias)} em relação ao ` +
            `vencimento do título (${Format.formatarData(params.vencimentoTitulo)}). ` +
            'Para confirmar, marque o reconhecimento da divergência de data e informe o motivo.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
            tipo: 'DATA_DIVERGENTE',
            deltaDias: params.deltaDias,
            valorBoleto: params.valorBoleto,
        };
    }
}

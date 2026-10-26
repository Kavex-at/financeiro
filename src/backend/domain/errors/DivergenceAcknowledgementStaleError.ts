import type { HandlerError } from '../libs/handler/HandlerError.js';
import Format from './DivergenceAcknowledgementFormat.js';

/**
 * O reconhecimento enviado não bate com o que existe agora: o Δdias ou o valor do boleto que a
 * analista viu mudaram desde a leitura (I15q, ADR-0078). Conferido contra a avaliação recalculada
 * ao vivo, nunca contra o cache. HTTP 422 — a tela reabre o diálogo com os valores novos.
 */
export default class DivergenceAcknowledgementStaleError extends Error implements HandlerError {
    public readonly code = 'RECONHECIMENTO_DE_DIVERGENCIA_DESATUALIZADO';
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
        deltaDiasVisto: number;
        deltaDiasAtual: number;
        /** Centavos. */
        valorBoletoVisto: number;
        valorBoletoAtual: number;
        codigoMascarado?: string;
    }) {
        super(
            `Divergence acknowledgement stale: ${params.filCod}/${params.docCod}/${params.titCod} x ${params.ddcCod}/${params.ditCod}`,
        );
        this.name = 'DivergenceAcknowledgementStaleError';
        const codigo = params.codigoMascarado ? ` (código ${params.codigoMascarado})` : '';
        this.userMessage =
            `O boleto${codigo} mudou desde que você o viu: agora a diferença é de ` +
            `${Format.formatarDelta(params.deltaDiasAtual)} e o valor é ${Format.formatarCentavos(params.valorBoletoAtual)} ` +
            `(você reconheceu ${Format.formatarDelta(params.deltaDiasVisto)} e ${Format.formatarCentavos(params.valorBoletoVisto)}). ` +
            'Confira os valores atuais e reconheça novamente.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
            deltaDiasVisto: params.deltaDiasVisto,
            deltaDiasAtual: params.deltaDiasAtual,
            valorBoletoVisto: params.valorBoletoVisto,
            valorBoletoAtual: params.valorBoletoAtual,
        };
    }
}

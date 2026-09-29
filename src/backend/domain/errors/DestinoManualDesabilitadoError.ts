import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Digitar destino de pagamento está desligado (ADR-0054, Adendo): `SISPAG_DESTINO_MANUAL_ENABLED`
 * (ou a flag da modalidade — TED para conta, PIX para chave) não está ligada. HTTP 403.
 *
 * As flags ficam desligadas até o teste supervisionado em produção provar o H3/H5.
 */
export default class DestinoManualDesabilitadoError extends Error implements HandlerError {
    public readonly code = 'DESTINO_MANUAL_DESABILITADO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 403;
    public readonly details?: unknown;

    public constructor(params: { recurso: 'destino_manual' | 'ted' | 'pix' }) {
        super(`manual payment destination disabled (${params.recurso})`);
        this.name = 'DestinoManualDesabilitadoError';
        this.userMessage =
            params.recurso === 'destino_manual'
                ? 'Informar o destino de pagamento no item ainda não está habilitado.'
                : `Destino ${params.recurso === 'ted' ? 'de TED (conta)' : 'de PIX (chave)'} ainda não está habilitado.`;
        this.details = { recurso: params.recurso };
    }
}

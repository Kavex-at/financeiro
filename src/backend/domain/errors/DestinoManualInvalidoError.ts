import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O destino de pagamento digitado (ADR-0054) não passou na validação de formato — banco, agência,
 * conta, DV, CPF/CNPJ ou chave PIX do tipo escolhido. HTTP 400.
 *
 * Nomeia só os CAMPOS que falharam, nunca os valores: o destino é dado sensível (I10h) e a
 * mensagem viaja para log e tela.
 */
export default class DestinoManualInvalidoError extends Error implements HandlerError {
    public readonly code = 'DESTINO_MANUAL_INVALIDO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 400;
    public readonly details?: unknown;

    public constructor(params: { campos: string[] }) {
        const campos = [...new Set(params.campos)].filter((c) => c.length > 0);
        super(`manual payment destination rejected on fields: ${campos.join(', ') || 'shape'}`);
        this.name = 'DestinoManualInvalidoError';
        this.userMessage =
            campos.length > 0
                ? `Destino de pagamento inválido. Confira: ${campos.join(', ')}.`
                : 'Destino de pagamento inválido: informe uma conta (TED) ou uma chave PIX.';
        this.details = { campos };
    }
}

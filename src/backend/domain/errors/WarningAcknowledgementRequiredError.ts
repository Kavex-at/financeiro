import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O candidato tem um aviso que o analista precisa reconhecer antes de confirmar
 * (`VENCE_ANTES_DO_TITULO`, I15o, ADR-0072) e o pedido não o reconheceu. Validado no servidor contra
 * a avaliação recalculada — nunca contra o cache nem contra o que a tela mostrou. HTTP 422.
 */
export default class WarningAcknowledgementRequiredError extends Error implements HandlerError {
    public readonly code = 'RECONHECIMENTO_DE_AVISO_OBRIGATORIO';
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
        avisos: string[];
        vencimentoTitulo: string;
        vencimentoBoleto: string;
        dataDebito: string;
    }) {
        super(
            `Warning acknowledgement required: ${params.filCod}/${params.docCod}/${params.titCod} x ${params.ddcCod}/${params.ditCod} (${params.avisos.join(',')})`,
        );
        this.name = 'WarningAcknowledgementRequiredError';
        this.userMessage =
            `O boleto vence em ${formatarData(params.vencimentoBoleto)}, antes do vencimento do título ` +
            `(${formatarData(params.vencimentoTitulo)}); a data de débito é ${formatarData(params.dataDebito)}. ` +
            'Antes de confirmar, confirme o vencimento no portal do banco e reconheça o aviso.';
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ddcCod: params.ddcCod,
            ditCod: params.ditCod,
            avisos: params.avisos,
        };
    }
}

/** `YYYY-MM-DD` → `DD/MM/YYYY`; qualquer outra coisa passa como veio. */
const formatarData = (civil: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : civil;
};

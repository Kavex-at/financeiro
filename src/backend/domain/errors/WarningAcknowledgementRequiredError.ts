import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Aviso da composição manual do boleto agrupado (I19g; `AVISO_GRUPO`). */
const AVISO_TITULO_VENCE_ANTES_DO_BOLETO = 'TITULO_VENCE_ANTES_DO_BOLETO';

/**
 * O candidato tem um aviso que o analista precisa reconhecer antes de confirmar
 * (`VENCE_ANTES_DO_TITULO`, I15o, ADR-0072; ou `TITULO_VENCE_ANTES_DO_BOLETO` do boleto
 * agrupado, I19g, ADR-0076) e o pedido não o reconheceu. Validado no servidor contra
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
        // I19g (boleto agrupado, ADR-0076): o aviso é o inverso — o TÍTULO vence antes do boleto.
        this.userMessage = params.avisos.includes(AVISO_TITULO_VENCE_ANTES_DO_BOLETO)
            ? `O título ${params.docCod}/${params.titCod} vence em ${formatarData(params.vencimentoTitulo)}, ` +
              `antes do boleto (${formatarData(params.vencimentoBoleto)}). Antes de confirmar o grupo, ` +
              'confira no portal do banco que o boleto paga este título e reconheça o aviso.'
            : `O boleto vence em ${formatarData(params.vencimentoBoleto)}, antes do vencimento do título ` +
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

import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Regra de negócio que recusa o par adiantamento↔invoice pedido. */
export type AlocacaoRecusa =
    | { motivo: 'processo-diferente'; invoicePriCod: string; adiantamentoPriCod: string }
    | { motivo: 'sem-di-duimp'; invoiceDocCod: string }
    | { motivo: 'moeda-diferente'; moedaAdiantamento: string; moedaInvoice: string };

/**
 * A alocação pedida viola uma regra da permuta (mesmo processo no casamento manual, invoice com
 * D.I/DUIMP, mesma moeda). O pedido é bem-formado e a regra é determinística — refazer igual dá a
 * mesma recusa —, então 422 (mesmo status do `AlocacaoSaldoError`, a outra recusa desta rota).
 */
export default class InvalidAllocationError extends Error implements HandlerError {
    public readonly code = 'ALOCACAO_INVALIDA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    constructor(params: AlocacaoRecusa) {
        super(InvalidAllocationError.technicalMessage(params));
        this.name = 'InvalidAllocationError';
        this.details = params;
        if (params.motivo === 'processo-diferente') {
            this.userMessage =
                'Casamento manual só permuta no mesmo processo: a invoice é do processo ' +
                `${params.invoicePriCod} e o adiantamento, do ${params.adiantamentoPriCod}.`;
        } else if (params.motivo === 'sem-di-duimp') {
            this.userMessage = `A invoice ${params.invoiceDocCod} não tem D.I/DUIMP e não pode ser permutada.`;
        } else {
            this.userMessage =
                `Moedas diferentes: o adiantamento é em ${params.moedaAdiantamento} e a invoice, em ` +
                `${params.moedaInvoice}. Só se permuta na mesma moeda.`;
        }
    }

    private static technicalMessage = (params: AlocacaoRecusa): string => {
        if (params.motivo === 'processo-diferente') {
            return `same-process allocation required: invoice process ${params.invoicePriCod} != adiantamento process ${params.adiantamentoPriCod}`;
        }
        if (params.motivo === 'sem-di-duimp') {
            return `invoice ${params.invoiceDocCod} without D.I/DUIMP — cannot be permuted`;
        }
        return `currency mismatch: adiantamento ${params.moedaAdiantamento} != invoice ${params.moedaInvoice}`;
    };
}

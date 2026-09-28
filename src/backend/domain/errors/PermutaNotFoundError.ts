import type { HandlerError } from '../libs/handler/HandlerError.js';

/** O que a Permuta procurou e não achou — cada recurso tem o seu código e a sua orientação. */
export type PermutaNotFoundParams =
    | { recurso: 'adiantamento'; adiantamentoDocCod: string }
    | { recurso: 'invoice'; invoiceDocCod: string; invoicePriCod: string }
    | { recurso: 'baixa'; borCod: number; invoiceDocCod: string };

/**
 * Registro da Permuta que a ação precisa e não existe (adiantamento na base relacional, invoice no
 * processo do Conexos, baixa na trilha do borderô). É o identificador do pedido que não casa com
 * nada — em geral a tela está desatualizada —, então 404 e não 500: recarregar resolve, e o erro
 * não é do servidor.
 */
export default class PermutaNotFoundError extends Error implements HandlerError {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 404;
    public readonly details?: unknown;

    constructor(params: PermutaNotFoundParams) {
        super(PermutaNotFoundError.technicalMessage(params));
        this.name = 'PermutaNotFoundError';
        this.details = params;
        if (params.recurso === 'adiantamento') {
            this.code = 'ADIANTAMENTO_NAO_ENCONTRADO';
            this.userMessage =
                `Adiantamento ${params.adiantamentoDocCod} não encontrado na base da permuta. ` +
                'Recarregue o painel e tente de novo.';
        } else if (params.recurso === 'invoice') {
            this.code = 'INVOICE_NAO_ENCONTRADA';
            this.userMessage =
                `Invoice ${params.invoiceDocCod} não encontrada no processo ${params.invoicePriCod} ` +
                'no Conexos. Busque as invoices do processo de novo e tente outra vez.';
        } else {
            this.code = 'BAIXA_NAO_ENCONTRADA';
            this.userMessage =
                `Baixa não encontrada na trilha: borderô ${params.borCod} / invoice ` +
                `${params.invoiceDocCod}. Recarregue a aba Borderôs.`;
        }
    }

    private static technicalMessage = (params: PermutaNotFoundParams): string => {
        if (params.recurso === 'adiantamento') {
            return `adiantamento ${params.adiantamentoDocCod} not found`;
        }
        if (params.recurso === 'invoice') {
            return `invoice ${params.invoiceDocCod} not found in process ${params.invoicePriCod}`;
        }
        return `baixa não encontrada na trilha: borderô ${params.borCod} / invoice ${params.invoiceDocCod}`;
    };
}

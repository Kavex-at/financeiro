import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Conta (TED) digitada no item ainda não aprovada (ADR-0054 D10). Barra o `finalizarLote` e, de
 * novo, o envio da remessa — ANTES de qualquer escrita no ERP (falha fechada).
 *
 * Nomeia os títulos (`docCod/titCod` e o credor), nunca banco, agência, conta ou CPF/CNPJ (I10h).
 * HTTP 409.
 */
export default class DestinoAprovacaoPendenteError extends Error implements HandlerError {
    public readonly code = 'DESTINO_APROVACAO_PENDENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        itens: Array<{ docCod: string; titCod: string; credor?: string }>;
    }) {
        const nomes = params.itens.map(
            (i) => `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}`,
        );
        super(
            `typed TED account pending approval: ${params.itens.map((i) => `${i.docCod}/${i.titCod}`).join(', ')}`,
        );
        this.name = 'DestinoAprovacaoPendenteError';
        this.userMessage =
            `Conta digitada aguardando aprovação: ${nomes.join('; ')}. Quem tem a permissão ` +
            '"Aprovar destino manual (SISPAG)" precisa aprovar antes de finalizar o lote.';
        this.details = { itens: params.itens.map((i) => `${i.docCod}/${i.titCod}`) };
    }
}

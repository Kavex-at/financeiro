import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Texto curto, em português, de cada motivo da guarda (I14d). */
const MOTIVO: Readonly<Record<string, string>> = {
    SEM_DADO_PAGAMENTO: 'sem conta/chave no cadastro do Conexos',
    FAVORECIDO_NAO_AUTORIZADO: 'favorecido não autorizado',
    DESTINO_ALTERADO: 'destino mudou no cadastro desde a aprovação',
    FALHA_LEITURA: 'não foi possível ler o cadastro do Conexos',
};

/**
 * Guarda L8 do `gerarRemessa` (ADR-0065 I14e-3): item TED/PIX cujo favorecido não está autorizado
 * para o destino que o cadastro resolve agora. Barra o lote INTEIRO antes de qualquer escrita no
 * Conexos e antes de qualquer linha no ledger, com a lista por item e o motivo. Nomeia títulos,
 * nunca conta/chave (I10h). HTTP 409.
 */
export default class PayeeNotAuthorizedAtRemittanceError extends Error implements HandlerError {
    public readonly code = 'FAVORECIDO_NAO_AUTORIZADO_NA_REMESSA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        loteId: string;
        itens: Array<{
            docCod: string;
            titCod: string;
            credor?: string;
            modalidade?: string;
            motivo: string;
        }>;
    }) {
        super(
            `Remittance blocked for lot ${params.loteId}: ${params.itens.map((i) => `${i.docCod}/${i.titCod}=${i.motivo}`).join(', ')}`,
        );
        this.name = 'PayeeNotAuthorizedAtRemittanceError';
        const linhas = params.itens.map(
            (i) =>
                `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}: ${MOTIVO[i.motivo] ?? i.motivo}`,
        );
        this.userMessage =
            `A remessa não foi gerada: ${params.itens.length} item(ns) TED/PIX sem autorização válida ` +
            `do favorecido — ${linhas.join('; ')}. Nada foi enviado ao Conexos. Peça a autorização ` +
            '(ou reabra o lote e troque a forma de pagamento) e gere de novo.';
        this.details = {
            loteId: params.loteId,
            itens: params.itens.map((i) => ({
                item: `${i.docCod}/${i.titCod}`,
                motivo: i.motivo,
            })),
        };
    }
}

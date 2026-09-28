import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Qual dado obrigatório falta no registro da Permuta. */
export type PermutaCampoAusente =
    | { campo: 'filial'; adiantamentoDocCod: string }
    | { campo: 'priCod-pesCod'; adiantamentoDocCod: string }
    | { campo: 'taxa-invoice'; adiantamentoDocCod: number; invoiceDocCod: number };

/**
 * O registro existe, mas chegou da ingestão sem um dado que a ação exige (filial, processo/pessoa
 * numéricos, taxa da invoice). O pedido está certo e repetir não muda nada — é o ESTADO do registro
 * que impede a ação —, então 422, não 500. A saída é reingerir ou corrigir o cadastro no Conexos.
 *
 * `taxa-invoice` roda dentro do laço de baixas da reconciliação, onde o `userMessage` vira o texto da
 * trilha do par: por isso ele repete o `message` original, sem reescrever o que a analista já lia.
 */
export default class PermutaDataIncompleteError extends Error implements HandlerError {
    public readonly code = 'PERMUTA_DADOS_INCOMPLETOS';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    constructor(params: PermutaCampoAusente) {
        super(PermutaDataIncompleteError.technicalMessage(params));
        this.name = 'PermutaDataIncompleteError';
        this.details = params;
        if (params.campo === 'filial') {
            this.userMessage =
                `O adiantamento ${params.adiantamentoDocCod} está sem filial na base da permuta, e ` +
                'nenhuma ação no Conexos roda sem ela. Rode a ingestão de novo; se persistir, ' +
                'confira o cadastro no ERP.';
        } else if (params.campo === 'priCod-pesCod') {
            this.userMessage =
                `O adiantamento ${params.adiantamentoDocCod} está sem processo ou pessoa numéricos ` +
                'na base da permuta, e a Solicitação de Numerário exige os dois. Rode a ingestão de novo.';
        } else {
            this.userMessage = this.message;
        }
    }

    private static technicalMessage = (params: PermutaCampoAusente): string => {
        if (params.campo === 'filial') {
            return `adiantamento ${params.adiantamentoDocCod} without filial`;
        }
        if (params.campo === 'priCod-pesCod') {
            return `adiantamento ${params.adiantamentoDocCod} lacks numeric priCod/pesCod (SN requires both)`;
        }
        return `alocação ${params.adiantamentoDocCod}→${params.invoiceDocCod} sem taxa da invoice — não dá para calcular o valor da baixa`;
    };
}

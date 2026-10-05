import type { HandlerError } from '../libs/handler/HandlerError.js';

export const EXCECAO_TITULARIDADE_MOTIVO = {
    TITULAR_DIVERGENTE: 'titular-divergente',
    CHAVE_NAO_CPF_CNPJ: 'chave-nao-cpf-cnpj',
    CHAVE_DIVERGENTE: 'chave-divergente',
} as const;

export type ExcecaoTitularidadeMotivo =
    (typeof EXCECAO_TITULARIDADE_MOTIVO)[keyof typeof EXCECAO_TITULARIDADE_MOTIVO];

/**
 * Titularidade da exceção (ADR-0060, I12i/I10i): o CPF/CNPJ do titular — ou a chave PIX — não é o
 * documento do favorecido, ou a chave PIX não é do tipo CPF/CNPJ (único titular conferível sem o
 * DICT). HTTP 422. Nunca carrega documento nem chave (I10h): só o motivo.
 */
export default class ExcecaoTitularidadeError extends Error implements HandlerError {
    public readonly code = 'EXCECAO_TITULARIDADE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { motivo: ExcecaoTitularidadeMotivo }) {
        super(`destination exception ownership check failed (${params.motivo})`);
        this.name = 'ExcecaoTitularidadeError';
        this.userMessage = ExcecaoTitularidadeError.mensagem(params.motivo);
        this.details = { motivo: params.motivo };
    }

    private static mensagem = (motivo: ExcecaoTitularidadeMotivo): string => {
        switch (motivo) {
            case EXCECAO_TITULARIDADE_MOTIVO.CHAVE_NAO_CPF_CNPJ:
                return 'Só chave PIX do tipo CPF/CNPJ é aceita como exceção: o titular das demais não pode ser conferido.';
            case EXCECAO_TITULARIDADE_MOTIVO.CHAVE_DIVERGENTE:
                return 'A chave PIX CPF/CNPJ não é o documento do favorecido. O pagamento só pode ir para o próprio favorecido.';
            default:
                return 'O CPF/CNPJ do titular não é o do favorecido. O pagamento só pode ir para uma conta ou chave do próprio favorecido.';
        }
    };
}

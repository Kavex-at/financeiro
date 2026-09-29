import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Titularidade (ADR-0054 I10i, bloqueante): o CPF/CNPJ do titular do destino digitado — ou a
 * própria chave PIX do tipo CPF/CNPJ — não é o do favorecido do título. HTTP 422.
 *
 * É a mitigação do risco reconhecido na D2: sem ela, qualquer pagamento TED/PIX poderia ser
 * desviado para outra pessoa. A mensagem não traz nenhum dos documentos (I10h); `titulo` é a
 * identificação `docCod/titCod` do item, não um dado pessoal.
 */
export default class DestinoTitularDivergenteError extends Error implements HandlerError {
    public readonly code = 'DESTINO_TITULAR_DIVERGENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { campo: 'titularDocumento' | 'chavePix'; titulo?: string }) {
        super(`manual payment destination ${params.campo} does not match the payee document`);
        this.name = 'DestinoTitularDivergenteError';
        const onde = params.titulo ? ` do título ${params.titulo}` : '';
        this.userMessage =
            params.campo === 'chavePix'
                ? `A chave PIX do tipo CPF/CNPJ não é o documento do favorecido${onde}. O pagamento só pode ir para o próprio favorecido.`
                : `O CPF/CNPJ do titular não é o do favorecido${onde}. O pagamento só pode ir para uma conta ou chave do próprio favorecido.`;
        this.details = { campo: params.campo, ...(params.titulo ? { titulo: params.titulo } : {}) };
    }
}

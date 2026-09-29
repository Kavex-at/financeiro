import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * O CPF/CNPJ do favorecido não pôde ser lido do cadastro do Conexos (`cmn025`), então a
 * titularidade do destino digitado (I10i) não pode ser conferida. FALHA FECHADA: sem a
 * conferência, o destino não é gravado nem enviado. HTTP 422.
 *
 * O nome do campo do documento no `cmn025` ainda é hipótese (`CAMPO_DOCUMENTO_FAVORECIDO`,
 * checklist do teste supervisionado). Até ser confirmado, este erro pode aparecer para todo
 * destino digitado — é o comportamento seguro, não um defeito.
 */
export default class DocumentoFavorecidoIndisponivelError extends Error implements HandlerError {
    public readonly code = 'DOCUMENTO_FAVORECIDO_INDISPONIVEL';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { titulo?: string } = {}) {
        super('payee CPF/CNPJ unavailable in cmn025 — ownership check cannot run (fail closed)');
        this.name = 'DocumentoFavorecidoIndisponivelError';
        const onde = params.titulo ? ` do título ${params.titulo}` : '';
        this.userMessage =
            `Não foi possível ler o CPF/CNPJ do favorecido${onde} no cadastro do Conexos, então a ` +
            'titularidade do destino não pode ser conferida. Por segurança o destino digitado não ' +
            'foi aceito. Confira o cadastro da pessoa no Conexos ou tente de novo mais tarde.';
        this.details = params.titulo ? { titulo: params.titulo } : undefined;
    }
}

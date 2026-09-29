import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Chave PIX DIGITADA de tipo cuja titularidade não conseguimos conferir (telefone, e-mail ou
 * aleatória). O dono de uma chave só está no DICT do Banco Central, que só banco consulta; para
 * chave CPF/CNPJ a própria chave é o documento e a conferência (I10i) é completa. Enquanto não
 * houver fonte do titular para os outros tipos, a chave digitada só é aceita se for CPF/CNPJ.
 * Chave que vem do cadastro do Conexos (`cmn025/cmnPessoasPix`) não passa por aqui. HTTP 422.
 */
export default class ChavePixTitularNaoVerificavelError extends Error implements HandlerError {
    public readonly code = 'CHAVE_PIX_TITULAR_NAO_VERIFICAVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { titulo?: string } = {}) {
        super('typed PIX key type cannot have its holder verified — only CPF/CNPJ keys accepted');
        this.name = 'ChavePixTitularNaoVerificavelError';
        const ref = params.titulo !== undefined ? ` (${params.titulo})` : '';
        this.userMessage = `Chave PIX digitada${ref}: por enquanto só é aceita chave do tipo CPF/CNPJ, a única em que conseguimos conferir o titular. Use a chave CPF/CNPJ do favorecido ou cadastre a chave no Conexos.`;
        this.details = params.titulo !== undefined ? { titulo: params.titulo } : undefined;
    }
}

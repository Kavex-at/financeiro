import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Lançado quando o `id` de um título de aprovação não é `${filCod}:${docCod}:${titCod}`
 * com as três partes inteiras e positivas. Rota → HTTP 400.
 *
 * Existe para que a chave natural **nunca** seja lida com `Number()` silencioso: `Number('abc')`
 * é `NaN`, e um `NaN` que chega ao SQL vira uma consulta que não casa com nada e devolve 404 —
 * indistinguível, para quem opera, de "esse título não existe". Falhar alto no boundary é a
 * diferença entre um bug visível e um dado que some.
 */
export default class AprovacaoIdInvalidoError extends Error implements HandlerError {
    public readonly code = 'APROVACAO_ID_INVALIDO';
    public readonly userMessage =
        'Identificador de título inválido. O formato esperado é filial:documento:titulo.';
    public readonly retryable = false;
    public readonly statusCode = 400;
    public readonly details?: unknown;

    public constructor(id: string) {
        super(`invalid aprovacao id: ${id}`);
        this.name = 'AprovacaoIdInvalidoError';
        // Só o formato esperado — o valor recebido não é ecoado (pode carregar entrada do usuário).
        this.details = { formatoEsperado: 'filCod:docCod:titCod' };
    }
}

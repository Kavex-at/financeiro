import type { Request, Response } from 'express';
import { isHandlerError } from '../domain/libs/handler/HandlerError.js';

/**
 * Responde um `HandlerError` com o status e o contrato de erro que ele declara
 * (`statusCode`, `code`, `userMessage`, `retryable`, `details`).
 *
 * Existe porque o `errorMiddleware` global achata TUDO em 500: sem isto, um
 * `IngestLockBusyError` (409 — "já existe ingestão rodando, tente de novo") e um
 * `RecebimentoVersionConflitoError` (409 — "recarregue a página") chegam ao
 * cliente indistinguíveis de uma falha real do servidor, e a UI não consegue
 * orientar o analista.
 *
 * Extraído de `routes/sispag.ts` (`respondLoteError`) para ser compartilhado com
 * `routes/recebimentos.ts` em vez de duplicado.
 *
 * Devolve `true` quando tratou o erro; `false` quando o erro não é um
 * `HandlerError` e deve seguir para o middleware global.
 */
export const respondHandlerError = (req: Request, res: Response, err: unknown): boolean => {
    if (!isHandlerError(err)) return false;
    res.status(err.statusCode).json({
        error: err.userMessage,
        code: err.code,
        retryable: err.retryable,
        ...(err.details !== undefined ? { details: err.details } : {}),
        ...(req.header('x-request-id') ? { requestId: req.header('x-request-id') } : {}),
    });
    return true;
};

export default respondHandlerError;

import type { NextFunction, Request, Response } from 'express';
import { errorMiddleware } from './errorMiddleware.js';

const buildRes = (): Response & { _status?: number; _json?: unknown } => {
    const res = {} as Response & { _status?: number; _json?: unknown };
    res.headersSent = false;
    res.status = ((code: number) => {
        res._status = code;
        return res;
    }) as Response['status'];
    res.json = ((body: unknown) => {
        res._json = body;
        return res;
    }) as Response['json'];
    return res;
};

describe('errorMiddleware', () => {
    const req = { method: 'GET', originalUrl: '/processes' } as Request;
    const next: NextFunction = () => undefined;
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        consoleError.mockRestore();
    });

    it('returns a generic HTTP 500 payload, never the raw error message', () => {
        const res = buildRes();
        errorMiddleware(new Error('Conexos imp021 internal failure'), req, res, next);
        expect(res._status).toBe(500);
        expect(res._json).toEqual({ error: 'Internal server error' });
    });

    it('does not leak the Conexos response body to the client', () => {
        const res = buildRes();
        const err = {
            message: 'Request failed',
            response: { status: 502, data: { secret: 'erp internals', stack: 'trace' } },
        };
        errorMiddleware(err, req, res, next);
        expect(res._json).toEqual({ error: 'Internal server error' });
        expect(JSON.stringify(res._json)).not.toMatch(/secret|erp internals|trace/);
    });

    it('logs the full detail server-side', () => {
        const res = buildRes();
        const err = {
            message: 'boom',
            response: { status: 500, data: { detail: 'internal' } },
        };
        errorMiddleware(err, req, res, next);
        expect(consoleError).toHaveBeenCalled();
        const logged = consoleError.mock.calls.flat().join(' ');
        expect(logged).toMatch(/boom/);
        expect(logged).toMatch(/internal/);
    });

    // ADR-0032: exceção CURADA ao genérico — só o que implementa `HandlerError` fala.
    describe('typed HandlerError: responde com a mensagem curada', () => {
        const conexosAccessDenied = Object.assign(new Error('Conexos call to imp223/list failed'), {
            code: 'CONEXOS_ACCESS_DENIED',
            userMessage:
                'Seu usuário Conexos (SIMONE_PEREIRA) não tem permissão de CONSULTA em IMP_223.',
            retryable: false,
            statusCode: 403,
            details: { endpoint: 'imp223/list' },
            response: { status: 403, data: { permRequest: { usnCodRequest: 14 } } },
        });

        it('emite o statusCode e o userMessage do próprio erro', () => {
            const res = buildRes();
            errorMiddleware(conexosAccessDenied, req, res, next);
            expect(res._status).toBe(403);
            expect(res._json).toEqual({
                error: 'CONEXOS_ACCESS_DENIED',
                message:
                    'Seu usuário Conexos (SIMONE_PEREIRA) não tem permissão de CONSULTA em IMP_223.',
                retryable: false,
                details: { endpoint: 'imp223/list' },
            });
        });

        it('mesmo assim NÃO vaza o payload cru do ERP nem o `err.message` técnico', () => {
            const res = buildRes();
            errorMiddleware(conexosAccessDenied, req, res, next);
            const body = JSON.stringify(res._json);
            expect(body).not.toMatch(/permRequest|usnCodRequest/);
            expect(body).not.toMatch(/Conexos call to/);
        });

        it('um erro só PARECIDO com typed (sem userMessage) continua genérico em 500', () => {
            const res = buildRes();
            const quaseTyped = Object.assign(new Error('boom'), {
                code: 'ALGO',
                statusCode: 418,
            });
            errorMiddleware(quaseTyped, req, res, next);
            expect(res._status).toBe(500);
            expect(res._json).toEqual({ error: 'Internal server error' });
        });
    });

    it('does not write a body when headers were already sent', () => {
        const res = buildRes();
        res.headersSent = true;
        errorMiddleware(new Error('late failure'), req, res, next);
        expect(res._status).toBeUndefined();
        expect(res._json).toBeUndefined();
    });
});

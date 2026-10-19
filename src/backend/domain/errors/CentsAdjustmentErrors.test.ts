import NetValueUnavailableError from './NetValueUnavailableError.js';

describe('NetValueUnavailableError (I17n, ADR-0073)', () => {
    const erro = new NetValueUnavailableError({ filCod: 2, docCod: '536', titCod: '2' });

    it('é 409, não retentável, com motivo VALOR_LIQUIDO_INDISPONIVEL', () => {
        expect(erro.statusCode).toBe(409);
        expect(erro.code).toBe('VALOR_LIQUIDO_INDISPONIVEL');
        expect(erro.retryable).toBe(false);
        expect(erro.name).toBe('NetValueUnavailableError');
        expect(erro.details).toEqual({
            filCod: 2,
            docCod: '536',
            titCod: '2',
            motivo: 'VALOR_LIQUIDO_INDISPONIVEL',
        });
    });

    it('message em inglês; userMessage em pt-BR com o título', () => {
        expect(erro.message).toMatch(/^Net value unavailable/);
        expect(erro.userMessage).toContain('536/2');
        expect(erro.userMessage).toMatch(/valor líquido/);
    });
});

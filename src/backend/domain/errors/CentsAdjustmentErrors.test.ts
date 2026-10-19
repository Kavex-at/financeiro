import NetValueUnavailableError from './NetValueUnavailableError.js';
import RemessaBarcodeAmountMismatchError from './RemessaBarcodeAmountMismatchError.js';

const BARRAS = '34191000000462501234567890123456789012345678';
const LINHA = '34191234567890123456789012345678901234567890123';

describe('RemessaBarcodeAmountMismatchError (I17m, ADR-0073)', () => {
    const erro = new RemessaBarcodeAmountMismatchError({
        nomeArquivo: 'PG191074.REM',
        flpCod: 46,
        gabCod: 9,
        divergencias: [
            {
                linha: 3,
                // Mesmo que alguém passe o código inteiro, só a máscara sai.
                barrasMascarada: BARRAS,
                valorBarraCentavos: 46250,
                pagamentoCentavos: 46249,
                docCod: '801',
                titCod: '2',
            },
        ],
    });

    it('é 409 e não retentável', () => {
        expect(erro.statusCode).toBe(409);
        expect(erro.retryable).toBe(false);
        expect(erro.code).toBe('REMESSA_VALOR_BARRA_DIVERGENTE');
        expect(erro.name).toBe('RemessaBarcodeAmountMismatchError');
    });

    it('userMessage pt-BR com título, os dois valores e o código mascarado 5+4', () => {
        expect(erro.userMessage).toContain('801/2');
        expect(erro.userMessage).toContain('R$ 462,50');
        expect(erro.userMessage).toContain('R$ 462,49');
        expect(erro.userMessage).toContain(`${BARRAS.slice(0, 5)}…${BARRAS.slice(-4)}`);
        expect(erro.userMessage).toMatch(/NÃO envie este arquivo ao banco/);
        expect(erro.message).toMatch(/^remittance PG191074\.REM/);
    });

    it('nem o erro serializado nem a stack carregam 44 ou 47 dígitos', () => {
        const tudo = JSON.stringify({
            m: erro.message,
            u: erro.userMessage,
            d: erro.details,
            s: erro.stack,
        });
        expect(tudo).not.toMatch(/\d{44}/);
        expect(tudo).not.toContain(LINHA);
        expect(JSON.stringify(erro)).not.toMatch(/\d{20,}/);
    });
});

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

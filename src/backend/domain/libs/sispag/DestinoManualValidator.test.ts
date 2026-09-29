import 'reflect-metadata';
import ChavePixTitularNaoVerificavelError from '../../errors/ChavePixTitularNaoVerificavelError.js';
import DestinoManualInvalidoError from '../../errors/DestinoManualInvalidoError.js';
import DestinoTitularDivergenteError from '../../errors/DestinoTitularDivergenteError.js';
import DocumentoFavorecidoIndisponivelError from '../../errors/DocumentoFavorecidoIndisponivelError.js';
import type { DestinoManual } from '../../interface/sispag/SispagInterface.js';
import DestinoManualValidator from './DestinoManualValidator.js';

const chaveDe = (d: DestinoManual): string | undefined =>
    d.tipo === 'CHAVE_PIX' ? d.chavePix : undefined;

const CPF = '11144477735';
const CNPJ = '11222333000181';

const conta = (over: Record<string, unknown> = {}) => ({
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta: '9876543',
    contaDv: '1',
    titularDocumento: CPF,
    ...over,
});
const pix = (over: Record<string, unknown> = {}) => ({
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'EMAIL',
    chavePix: 'Fornecedor@Empresa.com.br',
    titularDocumento: CNPJ,
    ...over,
});

/** A mensagem de erro não pode carregar nenhum dos valores digitados (I10h). */
const semValores = (e: unknown, valores: string[]): void => {
    const err = e as { message: string; userMessage: string; details?: unknown };
    const tudo = `${err.message} ${err.userMessage} ${JSON.stringify(err.details ?? null)}`;
    for (const v of valores) expect(tudo).not.toContain(v);
};

const falha = (fn: () => unknown): unknown => {
    try {
        fn();
    } catch (e) {
        return e;
    }
    throw new Error('esperava erro');
};

describe('DestinoManualValidator — formato (I10a–d)', () => {
    const v = new DestinoManualValidator();

    it('conta válida passa e sai normalizada', () => {
        expect(v.validar(conta({ titularDocumento: '111.444.777-35' }))).toEqual({
            tipo: 'CONTA',
            bancoCod: '237',
            agencia: '1234',
            conta: '9876543',
            contaDv: '1',
            titularDocumento: CPF,
        });
    });

    it('banco FEBRABAN tem 3 dígitos', () => {
        expect(falha(() => v.validar(conta({ bancoCod: '37' })))).toBeInstanceOf(
            DestinoManualInvalidoError,
        );
        expect(falha(() => v.validar(conta({ bancoCod: '2a7' })))).toBeInstanceOf(
            DestinoManualInvalidoError,
        );
    });

    it('agência, conta e DV só com dígitos', () => {
        for (const campo of [
            { agencia: '12a4' },
            { conta: '98-76' },
            { contaDv: 'X' },
            { agenciaDv: 'P' },
        ]) {
            expect(falha(() => v.validar(conta(campo)))).toBeInstanceOf(DestinoManualInvalidoError);
        }
    });

    it('CPF e CNPJ do titular com DV válido', () => {
        expect(v.validar(conta({ titularDocumento: CNPJ })).titularDocumento).toBe(CNPJ);
        const e = falha(() => v.validar(conta({ titularDocumento: '11144477736' })));
        expect(e).toBeInstanceOf(DestinoManualInvalidoError);
        semValores(e, ['11144477736']);
        expect(falha(() => v.validar(conta({ titularDocumento: '11111111111' })))).toBeInstanceOf(
            DestinoManualInvalidoError,
        );
        expect(
            falha(() => v.validar(conta({ titularDocumento: '11222333000182' }))),
        ).toBeInstanceOf(DestinoManualInvalidoError);
    });

    it('e-mail é validado e sai em minúsculas', () => {
        expect(chaveDe(v.validar(pix()))).toBe('fornecedor@empresa.com.br');
        expect(falha(() => v.validar(pix({ chavePix: 'sem-arroba' })))).toBeInstanceOf(
            DestinoManualInvalidoError,
        );
    });

    it('telefone: +55 com DDD', () => {
        expect(
            chaveDe(v.validar(pix({ chavePixTipo: 'TELEFONE', chavePix: '+55 (11) 98765-4321' }))),
        ).toBe('+5511987654321');
        expect(
            falha(() => v.validar(pix({ chavePixTipo: 'TELEFONE', chavePix: '+1 2025550143' }))),
        ).toBeInstanceOf(DestinoManualInvalidoError);
        expect(
            falha(() => v.validar(pix({ chavePixTipo: 'TELEFONE', chavePix: '+5500987654321' }))),
        ).toBeInstanceOf(DestinoManualInvalidoError);
    });

    it('aleatória é UUID (EVP)', () => {
        const uuid = '123e4567-e89b-12d3-a456-426614174000';
        expect(
            chaveDe(v.validar(pix({ chavePixTipo: 'ALEATORIA', chavePix: uuid.toUpperCase() }))),
        ).toBe(uuid);
        expect(
            falha(() => v.validar(pix({ chavePixTipo: 'ALEATORIA', chavePix: 'abc' }))),
        ).toBeInstanceOf(DestinoManualInvalidoError);
    });

    it('tipo NÃO é inferido: 11 dígitos com TELEFONE valida como telefone, com CPF_CNPJ como CPF', () => {
        // 11 dígitos que são um CPF VÁLIDO: como telefone eles são DDD 11 + 9 dígitos.
        expect(chaveDe(v.validar(pix({ chavePixTipo: 'TELEFONE', chavePix: '11144477735' })))).toBe(
            '+5511144477735',
        );
        expect(
            chaveDe(v.validar(pix({ chavePixTipo: 'CPF_CNPJ', chavePix: '111.444.777-35' }))),
        ).toBe(CPF);
        // Celular válido que NÃO é CPF válido: como CPF_CNPJ, recusa.
        expect(
            falha(() => v.validar(pix({ chavePixTipo: 'CPF_CNPJ', chavePix: '11987654321' }))),
        ).toBeInstanceOf(DestinoManualInvalidoError);
    });

    it('shape errado (tipo desconhecido, campo sobrando) recusa sem ecoar valores', () => {
        const e = falha(() => v.validar({ tipo: 'BOLETO', conta: '555000111' }));
        expect(e).toBeInstanceOf(DestinoManualInvalidoError);
        semValores(e, ['555000111']);
        expect(falha(() => v.validar({ ...conta(), extra: 'x' }))).toBeInstanceOf(
            DestinoManualInvalidoError,
        );
    });

    it('mensagens em português', () => {
        const e = falha(() => v.validar(conta({ bancoCod: '1' }))) as DestinoManualInvalidoError;
        expect(e.userMessage).toMatch(/destino|banco|inválid/i);
    });
});

describe('DestinoManualValidator — titularidade (I10i, bloqueante)', () => {
    const v = new DestinoManualValidator();

    it('titular igual ao favorecido passa', () => {
        expect(() => v.conferirTitularidade(v.validar(conta()), CPF)).not.toThrow();
    });

    it('titular diferente → DestinoTitularDivergenteError, em PT, sem documentos em claro', () => {
        const e = falha(() => v.conferirTitularidade(v.validar(conta()), CNPJ));
        expect(e).toBeInstanceOf(DestinoTitularDivergenteError);
        expect((e as DestinoTitularDivergenteError).userMessage).toMatch(/titular/i);
        expect((e as DestinoTitularDivergenteError).statusCode).toBe(422);
        semValores(e, [CPF, CNPJ]);
    });

    it('chave CPF_CNPJ tem de ser o próprio documento do favorecido', () => {
        const destino = v.validar(
            pix({ chavePixTipo: 'CPF_CNPJ', chavePix: CPF, titularDocumento: CNPJ }),
        );
        const e = falha(() => v.conferirTitularidade(destino, CNPJ));
        expect(e).toBeInstanceOf(DestinoTitularDivergenteError);
        semValores(e, [CPF, CNPJ]);
    });

    it('chave CPF_CNPJ do próprio favorecido passa', () => {
        const destino = v.validar(
            pix({ chavePixTipo: 'CPF_CNPJ', chavePix: CNPJ, titularDocumento: CNPJ }),
        );
        expect(() => v.conferirTitularidade(destino, CNPJ)).not.toThrow();
    });

    it.each([
        ['EMAIL', 'Fornecedor@Empresa.com.br'],
        ['TELEFONE', '+55 (11) 98765-4321'],
        ['ALEATORIA', '123e4567-e89b-12d3-a456-426614174000'],
    ])('chave digitada %s → recusada: titular não conferível (só CPF/CNPJ)', (tipo, chave) => {
        const destino = v.validar(pix({ chavePixTipo: tipo, chavePix: chave }));
        const e = falha(() => v.conferirTitularidade(destino, CNPJ, '10400/1'));
        expect(e).toBeInstanceOf(ChavePixTitularNaoVerificavelError);
        expect((e as ChavePixTitularNaoVerificavelError).statusCode).toBe(422);
        expect((e as ChavePixTitularNaoVerificavelError).userMessage).toMatch(/CPF\/CNPJ/);
        semValores(e, [chave, CNPJ]);
    });

    it('documento do favorecido indisponível → falha FECHADA com mensagem clara', () => {
        const e = falha(() => v.conferirTitularidade(v.validar(conta()), undefined));
        expect(e).toBeInstanceOf(DocumentoFavorecidoIndisponivelError);
        expect((e as DocumentoFavorecidoIndisponivelError).userMessage).toMatch(/CPF\/CNPJ/);
    });
});

import 'reflect-metadata';
import type { PayeeDestination } from '../../interface/sispag/AuthorizedPayeeInterface.js';
import type EnvironmentProvider from '../environment/EnvironmentProvider.js';
import PayeeFingerprint from './PayeeFingerprint.js';

const CHAVE = 'k'.repeat(32);

const comChave = (chave: string | undefined, keyId = 'v1'): PayeeFingerprint =>
    new PayeeFingerprint({
        getEnvironmentVars: async () => ({
            sispagFavorecidoFingerprintKey: chave,
            sispagFavorecidoFingerprintKeyId: keyId,
        }),
    } as unknown as EnvironmentProvider);

const ted = (over: Partial<Extract<PayeeDestination, { tipo: 'TED' }>> = {}): PayeeDestination => ({
    tipo: 'TED',
    banco: '237',
    agencia: '1234',
    agenciaDv: '5',
    conta: '87654321',
    contaDv: '0',
    ...over,
});

describe('PayeeFingerprint — HMAC do destino normalizado (I14b)', () => {
    const fp = comChave(CHAVE);

    it('mesmo destino → mesma impressão, com o keyId', async () => {
        const a = await fp.calcular(ted());
        const b = await fp.calcular(ted());
        expect(a).toEqual(b);
        expect(a.keyId).toBe('v1');
        expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('TED muda com qualquer um de banco, agência, DV da agência, conta e DV da conta', async () => {
        const base = (await fp.calcular(ted())).fingerprint;
        for (const over of [
            { banco: '341' },
            { agencia: '1235' },
            { agenciaDv: '6' },
            { conta: '87654322' },
            { contaDv: '1' },
        ]) {
            expect((await fp.calcular(ted(over))).fingerprint).not.toBe(base);
        }
    });

    it('PIX muda com o tipo ou com a chave', async () => {
        const base = (await fp.calcular({ tipo: 'PIX', chaveTipo: 'EMAIL', chave: 'a@b.com' }))
            .fingerprint;
        expect(
            (await fp.calcular({ tipo: 'PIX', chaveTipo: 'ALEATORIA', chave: 'a@b.com' }))
                .fingerprint,
        ).not.toBe(base);
        expect(
            (await fp.calcular({ tipo: 'PIX', chaveTipo: 'EMAIL', chave: 'c@b.com' })).fingerprint,
        ).not.toBe(base);
    });

    it('normalização estável: zeros à esquerda, caixa e pontuação não mudam a impressão', async () => {
        expect(
            (await fp.calcular(ted({ banco: '0237', agencia: '01234', conta: '0087654321' })))
                .fingerprint,
        ).toBe((await fp.calcular(ted())).fingerprint);
        expect((await fp.calcular(ted({ contaDv: 'x' }))).fingerprint).toBe(
            (await fp.calcular(ted({ contaDv: 'X' }))).fingerprint,
        );
        const cpf = async (chave: string) =>
            (await fp.calcular({ tipo: 'PIX', chaveTipo: 'CPF_CNPJ', chave })).fingerprint;
        expect(await cpf('111.444.777-35')).toBe(await cpf('11144477735'));
        const tel = async (chave: string) =>
            (await fp.calcular({ tipo: 'PIX', chaveTipo: 'TELEFONE', chave })).fingerprint;
        expect(await tel('+55 (11) 98765-4321')).toBe(await tel('5511987654321'));
        const mail = async (chave: string) =>
            (await fp.calcular({ tipo: 'PIX', chaveTipo: 'EMAIL', chave })).fingerprint;
        expect(await mail(' Fornecedor@Empresa.com ')).toBe(await mail('fornecedor@empresa.com'));
    });

    it('chave diferente → impressão diferente', async () => {
        const outra = comChave('z'.repeat(32), 'v2');
        expect((await outra.calcular(ted())).fingerprint).not.toBe(
            (await fp.calcular(ted())).fingerprint,
        );
    });

    it('nunca expõe o valor bruto', async () => {
        const r = await fp.calcular(ted());
        const texto = JSON.stringify(r);
        expect(texto).not.toContain('87654321');
    });

    it('sem chave configurada falha fechado', async () => {
        await expect(comChave(undefined).calcular(ted())).rejects.toThrow();
    });
});

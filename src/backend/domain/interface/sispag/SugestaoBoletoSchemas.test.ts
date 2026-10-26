import {
    ChaveSugestaoBodySchema,
    ConfirmarSugestaoBodySchema,
    RejeitarSugestaoBodySchema,
    SugestoesQuerySchema,
    TituloSugestaoQuerySchema,
} from './SugestaoBoletoSchemas.js';

const chave = { filCod: 1, docCod: '9001', titCod: '1', ddcCod: 500, ditCod: 3 };

describe('schemas da sugestão de boleto (I15o, ADR-0072)', () => {
    describe('ConfirmarSugestaoBodySchema', () => {
        it('reconheceAvisos é opcional e assume []', () => {
            expect(ConfirmarSugestaoBodySchema.parse(chave).reconheceAvisos).toEqual([]);
        });

        it('aceita o aviso conhecido', () => {
            const r = ConfirmarSugestaoBodySchema.parse({
                ...chave,
                reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
            });
            expect(r.reconheceAvisos).toEqual(['VENCE_ANTES_DO_TITULO']);
        });

        it('aviso desconhecido é 400', () => {
            expect(
                ConfirmarSugestaoBodySchema.safeParse({ ...chave, reconheceAvisos: ['OUTRO'] })
                    .success,
            ).toBe(false);
        });

        it('"ator" no body continua recusado (a identidade vem do token)', () => {
            expect(ConfirmarSugestaoBodySchema.safeParse({ ...chave, ator: 'ana' }).success).toBe(
                false,
            );
        });
    });

    it('rejeitar e copiar-linha NÃO aceitam reconheceAvisos', () => {
        const avisos = { reconheceAvisos: ['VENCE_ANTES_DO_TITULO'] };
        expect(
            RejeitarSugestaoBodySchema.safeParse({ ...chave, motivo: 'x', ...avisos }).success,
        ).toBe(false);
        expect(ChaveSugestaoBodySchema.safeParse({ ...chave, ...avisos }).success).toBe(false);
    });

    it('SugestoesQuerySchema ganha situacao sem quebrar tier', () => {
        const r = SugestoesQuerySchema.parse({ tier: 'FORTE', situacao: 'AMBIGUA' });
        expect(r).toMatchObject({ tier: 'FORTE', situacao: 'AMBIGUA' });
        expect(SugestoesQuerySchema.safeParse({ situacao: 'INVENTADA' }).success).toBe(false);
        expect(SugestoesQuerySchema.parse({}).situacao).toBeUndefined();
    });

    it('TituloSugestaoQuerySchema exige a chave do título', () => {
        expect(
            TituloSugestaoQuerySchema.parse({ filCod: '2', docCod: '30485', titCod: '1' }),
        ).toEqual({ filCod: 2, docCod: '30485', titCod: '1' });
        expect(TituloSugestaoQuerySchema.safeParse({ filCod: '2', docCod: '30485' }).success).toBe(
            false,
        );
    });
});

describe('ReconhecimentoDivergenciaSchema no confirmar (I15q, ADR-0078)', () => {
    const ack = {
        tipo: 'DATA_DIVERGENTE',
        aceito: true,
        motivo: 'conferi o vencimento no portal do banco',
        deltaDiasVisto: -3,
        valorBoletoVisto: 102_880,
    };
    const parse = (reconhecimento: unknown) =>
        ConfirmarSugestaoBodySchema.safeParse({ ...chave, reconhecimento });

    it('é opcional e aceita o reconhecimento completo, mantendo reconheceAvisos', () => {
        expect(ConfirmarSugestaoBodySchema.parse(chave).reconhecimento).toBeUndefined();
        const r = ConfirmarSugestaoBodySchema.parse({
            ...chave,
            reconheceAvisos: ['VENCE_ANTES_DO_TITULO'],
            reconhecimento: ack,
        });
        expect(r.reconhecimento).toEqual(ack);
        expect(r.reconheceAvisos).toEqual(['VENCE_ANTES_DO_TITULO']);
    });

    it('o motivo tem espaços aparados', () => {
        const r = parse({ ...ack, motivo: '   conferi no portal   ' });
        expect(r.success && r.data.reconhecimento?.motivo).toBe('conferi no portal');
    });

    it.each([
        ['aceito: false', { ...ack, aceito: false }],
        ['sem aceito', { ...ack, aceito: undefined }],
        ['motivo curto (9)', { ...ack, motivo: '123456789' }],
        ['motivo só com espaços', { ...ack, motivo: '          ' }],
        ['motivo longo (501)', { ...ack, motivo: 'x'.repeat(501) }],
        ['tipo desconhecido', { ...ack, tipo: 'OUTRO' }],
        ['campo extra', { ...ack, extra: 1 }],
        ['autor no corpo', { ...ack, reconhecidoPor: 'ana' }],
        ['data no corpo', { ...ack, reconhecidoEm: '2026-10-26T00:00:00Z' }],
        ['delta fracionário', { ...ack, deltaDiasVisto: 1.5 }],
        ['valor em reais fracionário', { ...ack, valorBoletoVisto: 1028.8 }],
        ['valor negativo', { ...ack, valorBoletoVisto: -1 }],
    ])('rejeita %s', (_nome, corpo) => {
        expect(parse(corpo).success).toBe(false);
    });

    it('aceita motivo de exatos 10 e 500 caracteres', () => {
        expect(parse({ ...ack, motivo: 'x'.repeat(10) }).success).toBe(true);
        expect(parse({ ...ack, motivo: 'x'.repeat(500) }).success).toBe(true);
    });
});

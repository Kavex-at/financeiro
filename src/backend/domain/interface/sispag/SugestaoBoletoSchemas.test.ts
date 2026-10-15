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

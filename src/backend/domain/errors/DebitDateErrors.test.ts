import DebitDateFrozenError from './DebitDateFrozenError.js';
import DebitDateOutsideWindowError from './DebitDateOutsideWindowError.js';

describe('DebitDateOutsideWindowError', () => {
    it('segue o contrato HandlerError (422, não retryable)', () => {
        const e = new DebitDateOutsideWindowError({ motivo: 'nao_util', dataDebito: '2026-09-26' });
        expect(e.code).toBe('DATA_DEBITO_FORA_DA_JANELA');
        expect(e.statusCode).toBe(422);
        expect(e.retryable).toBe(false);
        expect(e.userMessage).toContain('26/09 não é dia útil bancário');
    });

    it('acima do máximo: nomeia o título limitante e a janela', () => {
        const e = new DebitDateOutsideWindowError({
            motivo: 'depois_do_vencimento',
            dataDebito: '2026-09-30',
            min: '2026-09-22',
            max: '2026-09-29',
            limitante: {
                itemId: '2:123:1',
                documento: '123/1',
                credor: 'FORNECEDOR X',
                vencimento: '2026-09-29',
            },
        });
        expect(e.userMessage).toContain(
            'Data 30/09 depois do vencimento do título 123/1 (FORNECEDOR X, vence 29/09). Permitido: 22/09 a 29/09.',
        );
        expect(e.details).toMatchObject({ min: '2026-09-22', max: '2026-09-29' });
    });

    it.each([
        ['titulo_vencido', 'já venceu'],
        ['sem_dia_util', 'Não há dia útil bancário'],
        ['titulo_sem_vencimento', 'sem vencimento'],
    ] as const)('janela vazia (%s) explica o motivo', (motivo, trecho) => {
        const e = new DebitDateOutsideWindowError({
            motivo,
            limitante: { itemId: '2:1:1', documento: '1/1', vencimento: '2026-09-20' },
        });
        expect(e.userMessage).toContain(trecho);
    });
});

describe('DebitDateFrozenError', () => {
    it('diferente: 409 com a data congelada', () => {
        const e = new DebitDateFrozenError({
            motivo: 'diferente',
            dataCongelada: '2026-09-23',
            nativeFlpCod: 41,
            dataPedida: '2026-09-24',
        });
        expect(e.code).toBe('DATA_DEBITO_CONGELADA');
        expect(e.statusCode).toBe(409);
        expect(e.userMessage).toContain('congelada em 23/09');
        expect(e.details.nativeFlpCod).toBe(41);
    });

    it('no_passado: manda cancelar o flp no fin015 e gerar de novo', () => {
        const e = new DebitDateFrozenError({
            motivo: 'no_passado',
            dataCongelada: '2026-09-21',
            nativeFlpCod: 41,
        });
        expect(e.userMessage).toContain('Cancele o lote nativo flp 41 no fin015');
        expect(e.userMessage).toContain('gere a remessa de novo');
    });
});

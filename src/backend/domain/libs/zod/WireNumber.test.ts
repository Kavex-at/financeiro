import 'reflect-metadata';
import { z } from 'zod';
import WireNumber from './WireNumber.js';

/**
 * Estes testes fixam o COMPORTAMENTO DO ZOD, não só o do helper.
 *
 * O bug que originou o módulo não foi um erro de digitação: foi uma suposição razoável e falsa
 * sobre o que `z.coerce.number().optional()` faz com `null`. Uma atualização de zod que mudasse
 * (ou "consertasse") a ordem entre coerção e `optional` passaria despercebida em todo o resto da
 * suíte. O bloco `regressão do zod cru` existe para falhar ALTO nesse dia.
 */
describe('WireNumber', () => {
    describe('regressão do zod cru — por que este helper existe', () => {
        it('`z.coerce.number().optional()` transforma null e "" em 0', () => {
            const cru = z.coerce.number().optional();
            expect(cru.parse(null)).toBe(0);
            expect(cru.parse('')).toBe(0);
            expect(cru.parse(undefined)).toBeUndefined();
        });

        it('`.catch(undefined)` NÃO protege — o catch só dispara em falha, e coagir null tem êxito', () => {
            expect(z.coerce.number().optional().catch(undefined).parse(null)).toBe(0);
        });

        it('`.default(2)` entrega 0 para null — o default só vale para undefined', () => {
            const comDefault = z.coerce.number().int().optional().default(2);
            expect(comDefault.parse(null)).toBe(0);
            expect(comDefault.parse(undefined)).toBe(2);
        });

        it('`.nullish()` cobre null mas deixa "" virar 0', () => {
            const nullish = z.coerce.number().nullish();
            expect(nullish.parse(null)).toBeNull();
            expect(nullish.parse('')).toBe(0);
        });
    });

    describe('optional — ausência vira undefined, nunca zero', () => {
        it.each([
            ['null', null],
            ['string vazia', ''],
            ['undefined', undefined],
        ])('%s → undefined', (_nome, entrada) => {
            expect(WireNumber.optional.parse(entrada)).toBeUndefined();
        });

        it('preserva o ZERO de verdade — o ERP dizer zero é um fato, e continua um fato', () => {
            expect(WireNumber.optional.parse(0)).toBe(0);
            expect(WireNumber.optional.parse('0')).toBe(0);
        });

        it('continua coagindo string numérica (a tolerância do wire não se perdeu)', () => {
            expect(WireNumber.optional.parse('1760000000000')).toBe(1_760_000_000_000);
            expect(WireNumber.optional.parse('99.5')).toBe(99.5);
        });

        it('valor ilegível vira undefined, não zero', () => {
            expect(WireNumber.optional.parse('abc')).toBeUndefined();
            expect(WireNumber.optional.parse({})).toBeUndefined();
        });

        it('intOptional recusa fracionário mas não o converte em zero', () => {
            expect(WireNumber.intOptional.parse(1.5)).toBeUndefined();
            expect(WireNumber.intOptional.parse('7')).toBe(7);
            expect(WireNumber.intOptional.parse(null)).toBeUndefined();
        });
    });

    describe('required — ausência REJEITA o parse', () => {
        it.each([
            ['null', null],
            ['string vazia', ''],
            ['undefined', undefined],
        ])('%s → falha, em vez de virar 0', (_nome, entrada) => {
            expect(WireNumber.required.safeParse(entrada).success).toBe(false);
            expect(WireNumber.intRequired.safeParse(entrada).success).toBe(false);
        });

        it('ZERO legítimo passa — é o ponto: 0 é dado, ausência não', () => {
            expect(WireNumber.required.parse(0)).toBe(0);
            expect(WireNumber.intRequired.parse('0')).toBe(0);
        });

        it('coage string numérica', () => {
            expect(WireNumber.required.parse('12.5')).toBe(12.5);
            expect(WireNumber.intRequired.parse('42')).toBe(42);
        });

        it('intRequired recusa fracionário', () => {
            expect(WireNumber.intRequired.safeParse(1.5).success).toBe(false);
        });
    });

    describe('dentro de um objeto — o caso real', () => {
        const schema = z.object({
            status: WireNumber.intOptional,
            valor: WireNumber.optional,
            id: WireNumber.intRequired,
        });

        it('campo opcional nulo fica AUSENTE do resultado, passando em `=== undefined`', () => {
            const r = schema.parse({ status: null, valor: null, id: 7 });
            expect(r.status).toBeUndefined();
            expect(r.valor).toBeUndefined();
            // O guard que o código a jusante escreve de verdade:
            expect(r.valor === 0).toBe(false);
            expect(r.status != null).toBe(false);
        });

        it('id obrigatório nulo derruba a linha inteira — não vira `id: 0`', () => {
            const r = schema.safeParse({ status: 1, valor: 10, id: null });
            expect(r.success).toBe(false);
        });
    });
});

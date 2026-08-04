import 'reflect-metadata';
import VldTpNfAusenteError from '../../errors/VldTpNfAusenteError.js';
import VldTpNfDesconhecidoError from '../../errors/VldTpNfDesconhecidoError.js';
import {
    decidirRotaHomologacao,
    normalizeVldTpNf,
} from '../../interface/recebimentos/HomologacaoNde.js';
import ContingenciaDecider from './ContingenciaDecider.js';

/** Test sets: a non-empty known-normal allowlist so the normal branch is reachable (prod seed is empty). */
const SETS = { contingencia: ['11', '12'], normaisConhecidos: ['1', '55'] };

describe('normalizeVldTpNf — strict string at the boundary', () => {
    it('coerces a numeric 11 to the string "11" (so the string whitelist matches)', () => {
        expect(normalizeVldTpNf(11)).toBe('11');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeVldTpNf(' 12 ')).toBe('12');
    });

    it('maps null/undefined to "" (absent)', () => {
        expect(normalizeVldTpNf(null)).toBe('');
        expect(normalizeVldTpNf(undefined)).toBe('');
    });
});

describe('decidirRotaHomologacao — inverted (fail-loud) whitelist', () => {
    it('routes "11" → contingência (homologaNfeContingencia) with DPEC aviso', () => {
        const rota = decidirRotaHomologacao('11', SETS);
        expect(rota).toMatchObject({
            contingencia: true,
            verbo: 'homologaNfeContingencia',
            aviso: 'DPEC',
            vldTpNf: '11',
        });
    });

    it('routes "12" → contingência with SCAN aviso', () => {
        const rota = decidirRotaHomologacao('12', SETS);
        expect(rota).toMatchObject({ verbo: 'homologaNfeContingencia', aviso: 'SCAN' });
    });

    it('routes a known-normal code → homologaNfe (no aviso)', () => {
        const rota = decidirRotaHomologacao('55', SETS);
        expect(rota).toMatchObject({ contingencia: false, verbo: 'homologaNfe', vldTpNf: '55' });
        expect(rota.aviso).toBeUndefined();
    });

    it('accepts a numeric contingency code by normalizing to string first', () => {
        expect(decidirRotaHomologacao(11, SETS).verbo).toBe('homologaNfeContingencia');
    });

    it('THROWS on an absent vldTpNf (does NOT fail-open to normal like the UI)', () => {
        expect(() => decidirRotaHomologacao(undefined, SETS)).toThrow(VldTpNfAusenteError);
        expect(() => decidirRotaHomologacao('', SETS)).toThrow(VldTpNfAusenteError);
    });

    it('THROWS on an unknown code instead of silently routing it to homologaNfe', () => {
        try {
            decidirRotaHomologacao('99', SETS);
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(VldTpNfDesconhecidoError);
            expect((err as VldTpNfDesconhecidoError).details.vldTpNf).toBe('99');
        }
    });
});

describe('ContingenciaDecider (DI wrapper over the module default sets)', () => {
    const decider = new ContingenciaDecider();

    it('routes contingency codes with the production defaults', () => {
        expect(decider.decidir('11').verbo).toBe('homologaNfeContingencia');
        expect(decider.decidir('12').aviso).toBe('SCAN');
    });

    it('routes the HAR-confirmed normal code "10" to homologaNfe', () => {
        // NDE_NORMAL_TP_NF_CONHECIDOS seeded with "10" (doc 18337, HAR 2026-08-01).
        expect(decider.decidir('10').verbo).toBe('homologaNfe');
    });

    it('REFUSES any code outside {contingência ∪ normais-conhecidos} (fail-loud, not fail-open)', () => {
        expect(() => decider.decidir('1')).toThrow(VldTpNfDesconhecidoError);
        expect(() => decider.decidir('55')).toThrow(VldTpNfDesconhecidoError);
    });

    it('fails loud on absent input', () => {
        expect(() => decider.decidir(null)).toThrow(VldTpNfAusenteError);
    });
});

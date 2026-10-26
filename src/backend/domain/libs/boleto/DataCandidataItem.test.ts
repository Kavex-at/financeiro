import 'reflect-metadata';
import DataCandidataItem from './DataCandidataItem.js';

// 2026-10-26 segunda; 2026-10-24 sábado.
const HOJE = '2026-10-26';

describe('DataCandidataItem.calcular (I8c, ADR-0078)', () => {
    it('Δ<0: a candidata é o prazo final da barra (anterior ao título)', () => {
        const r = DataCandidataItem.calcular({
            vencimentoTitulo: '2026-11-03',
            vencimentoBarra: '2026-10-29',
            hoje: HOJE,
        });
        expect(r).toEqual({ possivel: true, candidata: '2026-10-29' });
    });

    it('Δ>0: a candidata é o vencimento do título (o menor dos dois)', () => {
        const r = DataCandidataItem.calcular({
            vencimentoTitulo: '2026-10-28',
            vencimentoBarra: '2026-11-03',
            hoje: HOJE,
        });
        expect(r).toEqual({ possivel: true, candidata: '2026-10-28' });
    });

    it('barra de sábado rola para a segunda antes de comparar', () => {
        const r = DataCandidataItem.calcular({
            vencimentoTitulo: '2026-11-10',
            vencimentoBarra: '2026-10-31', // sábado; 02/11 é Finados ⇒ terça 03/11
            hoje: HOJE,
        });
        expect(r).toEqual({ possivel: true, candidata: '2026-11-03' });
    });

    it('barra antes de hoje: sem data possível (informativo)', () => {
        const r = DataCandidataItem.calcular({
            vencimentoTitulo: '2026-11-03',
            vencimentoBarra: '2026-10-23',
            hoje: HOJE,
        });
        expect(r).toEqual({ possivel: false, motivo: 'BARRA_VENCIDA' });
    });

    it('sem dia útil entre hoje e a candidata: sem data possível', () => {
        // hoje é sábado 24/10; candidata domingo 25/10 (título): nenhum dia útil na janela.
        const r = DataCandidataItem.calcular({
            vencimentoTitulo: '2026-10-25',
            vencimentoBarra: '2026-10-25',
            hoje: '2026-10-24',
        });
        expect(r).toEqual({ possivel: false, motivo: 'SEM_DIA_UTIL' });
    });

    it('candidata hoje (dia útil) é possível', () => {
        const r = DataCandidataItem.calcular({
            vencimentoTitulo: '2026-10-26',
            vencimentoBarra: '2026-10-26',
            hoje: HOJE,
        });
        expect(r).toEqual({ possivel: true, candidata: '2026-10-26' });
    });

    it('data inválida: sem data possível, nunca lança', () => {
        const r = DataCandidataItem.calcular({
            vencimentoTitulo: 'x',
            vencimentoBarra: '2026-10-26',
            hoje: HOJE,
        });
        expect(r).toEqual({ possivel: false, motivo: 'DATA_INVALIDA' });
    });
});

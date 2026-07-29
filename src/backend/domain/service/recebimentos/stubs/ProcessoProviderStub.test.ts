import 'reflect-metadata';
import ProcessoProviderStub from './ProcessoProviderStub.js';

describe('ProcessoProviderStub — candidate processos (in-memory, no DB/matching)', () => {
    it('filters candidates by the transaction filCod (multi-filial invariant)', async () => {
        const stub = new ProcessoProviderStub();
        const fil4 = await stub.listCandidatosParaTransacao({ filCod: 4 });
        expect(fil4.length).toBeGreaterThan(0);
        expect(fil4.every((p) => p.filCod === 4)).toBe(true);

        const fil7 = await stub.listCandidatosParaTransacao({ filCod: 7 });
        expect(fil7.every((p) => p.filCod === 7)).toBe(true);
    });

    it('returns an empty list for a filial with no candidates', async () => {
        const stub = new ProcessoProviderStub();
        const none = await stub.listCandidatosParaTransacao({ filCod: 999 });
        expect(none).toEqual([]);
    });

    it('applies a loose contraparte match when provided', async () => {
        const stub = new ProcessoProviderStub();
        const matched = await stub.listCandidatosParaTransacao({
            filCod: 4,
            contraparte: 'CLIENTE EXEMPLO LTDA',
        });
        expect(matched.length).toBeGreaterThan(0);
        expect(matched.every((p) => p.filCod === 4)).toBe(true);
        expect(
            matched.some((p) =>
                (p.contraparte ?? p.dpeNomPessoa).toLowerCase().includes('cliente exemplo'),
            ),
        ).toBe(true);
    });

    it('ignores the contraparte filter when it does not match anyone (returns [])', async () => {
        const stub = new ProcessoProviderStub();
        const out = await stub.listCandidatosParaTransacao({
            filCod: 4,
            contraparte: 'EMPRESA INEXISTENTE ZZZ',
        });
        expect(out).toEqual([]);
    });
});

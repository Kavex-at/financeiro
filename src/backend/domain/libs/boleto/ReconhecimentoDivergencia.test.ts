import ReconhecimentoDivergencia from './ReconhecimentoDivergencia.js';

const visto = { deltaDiasVisto: -3, valorBoletoVisto: 102_880 };

describe('ReconhecimentoDivergencia.valido (I15q)', () => {
    it('válido quando Δ e valor atuais são exatamente os vistos', () => {
        expect(
            ReconhecimentoDivergencia.valido(visto, {
                deltaDiasAtual: -3,
                valorBoletoAtual: 102_880,
            }),
        ).toBe(true);
    });

    it('inválido se o Δ mudar por 1 dia', () => {
        for (const d of [-4, -2]) {
            expect(
                ReconhecimentoDivergencia.valido(visto, {
                    deltaDiasAtual: d,
                    valorBoletoAtual: 102_880,
                }),
            ).toBe(false);
        }
    });

    it('inválido se o valor mudar por 1 centavo', () => {
        for (const v of [102_879, 102_881]) {
            expect(
                ReconhecimentoDivergencia.valido(visto, {
                    deltaDiasAtual: -3,
                    valorBoletoAtual: v,
                }),
            ).toBe(false);
        }
    });

    it('sem reconhecimento nunca é válido', () => {
        expect(
            ReconhecimentoDivergencia.valido(undefined, {
                deltaDiasAtual: -3,
                valorBoletoAtual: 102_880,
            }),
        ).toBe(false);
    });

    it('Δ ou valor atual indisponível (NaN/indefinido) é inválido (fail-closed)', () => {
        expect(
            ReconhecimentoDivergencia.valido(visto, {
                deltaDiasAtual: Number.NaN,
                valorBoletoAtual: 102_880,
            }),
        ).toBe(false);
    });
});

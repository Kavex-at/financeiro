import type { GrupoBoleto } from '../../interface/sispag/GrupoBoletoInterface.js';
import EstadoVivoGrupoBoleto from './EstadoVivoGrupoBoleto.js';

const grupo = {
    titulos: [
        {
            filCod: 2,
            docCod: '1',
            titCod: '1',
            valorLiquidoCentavos: 100,
            vencimento: '2026-10-21',
        },
        {
            filCod: 2,
            docCod: '2',
            titCod: '1',
            valorLiquidoCentavos: 100,
            vencimento: '2026-10-21',
        },
    ],
} as GrupoBoleto;

describe('EstadoVivoGrupoBoleto — entradas puras da I19u e da situação (ADR-0076)', () => {
    it('boleto ausente = fora do pool; título ausente some da lista (saiu da carteira); vínculo do ERP só quando presente', () => {
        const vivo = EstadoVivoGrupoBoleto.montar(grupo, null, (c) =>
            c.docCod === '1'
                ? { ...c, valor: 1, liberado: true, pago: true, ativo: true, temBoleto: false }
                : null,
        );
        expect(vivo).toEqual({
            titulos: [
                { filCod: 2, docCod: '1', titCod: '1', pago: true, ativo: true, temBoleto: false },
            ],
        });
        const comBoleto = EstadoVivoGrupoBoleto.montar(
            grupo,
            { ddcCod: 1, ditCod: 1, filCod: 2, docCod: '9', titCod: '1' } as never,
            () => undefined,
        );
        expect(comBoleto.boleto).toEqual({ filCod: 2, docCod: '9', titCod: '1' });
    });

    it('execuções: início = t0 da escrita quando houver, senão a criação; J rejeitado em epoch ms', () => {
        expect(
            EstadoVivoGrupoBoleto.execucoes([
                {
                    criadoEm: new Date(1_000),
                    escritaIniciadaEm: new Date(2_000),
                    etapa: 'concluido',
                    jRejeitadoEm: new Date(3_000),
                },
                { criadoEm: new Date(4_000), etapa: 'intencao_gravada' },
            ]),
        ).toEqual([
            { iniciadaEm: 2_000, etapa: 'concluido', jRejeitadoEm: 3_000 },
            { iniciadaEm: 4_000, etapa: 'intencao_gravada' },
        ]);
    });
});

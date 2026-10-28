import 'reflect-metadata';
import type AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import type SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import PreSelecaoItemLote from './PreSelecaoItemLote.js';

const make = (over: { confirmados?: string[]; liquidos?: Record<string, number> } = {}) => {
    const sugestoes = {
        chavesComConfirmacaoVigente: jest.fn().mockResolvedValue(new Set(over.confirmados ?? [])),
    };
    const ajustes = {
        liquidosDeTitulosRenegociados: jest
            .fn()
            .mockResolvedValue(new Map(Object.entries(over.liquidos ?? {}))),
    };
    const service = new PreSelecaoItemLote(
        sugestoes as unknown as SugestaoBoletoRepository,
        ajustes as unknown as AjusteCentavosExecucaoRepository,
    );
    return { service, sugestoes, ajustes };
};

describe('PreSelecaoItemLote (A2, I18j(5))', () => {
    describe('modalidadeInicial', () => {
        it('DDA casado no ERP ⇒ BOLETO', () => {
            expect(
                PreSelecaoItemLote.modalidadeInicial({
                    temBoletoDda: true,
                    boletoConfirmado: false,
                }),
            ).toBe('BOLETO');
        });

        it('boleto confirmado no app (decisão CONFIRMADA, par VIGENTE) ⇒ BOLETO', () => {
            expect(
                PreSelecaoItemLote.modalidadeInicial({
                    temBoletoDda: false,
                    boletoConfirmado: true,
                }),
            ).toBe('BOLETO');
        });

        it('nem DDA nem confirmação ⇒ "a definir" (undefined)', () => {
            expect(
                PreSelecaoItemLote.modalidadeInicial({
                    temBoletoDda: false,
                    boletoConfirmado: false,
                }),
            ).toBeUndefined();
        });
    });

    describe('resolver', () => {
        const nelson = [
            { filCod: 2, docCod: '41027', titCod: '2' },
            { filCod: 2, docCod: '41032', titCod: '2' },
            { filCod: 2, docCod: '500', titCod: '1', temBoleto: true },
            { filCod: 2, docCod: '600', titCod: '1' },
        ];

        it('caso NELSON HEUSI: confirmado + renegociado ⇒ BOLETO com o líquido do ledger', async () => {
            const { service } = make({
                confirmados: ['2:41027:2', '2:41032:2'],
                liquidos: { '2:41027:2': 64757, '2:41032:2': 64757 },
            });
            const r = await service.resolver(nelson);
            expect(r.get('2:41027:2')).toEqual({ modalidade: 'BOLETO', valor: 647.57 });
            expect(r.get('2:41032:2')).toEqual({ modalidade: 'BOLETO', valor: 647.57 });
            expect(r.get('2:500:1')).toEqual({ modalidade: 'BOLETO' });
            expect(r.get('2:600:1')).toEqual({});
        });

        it('consulta as duas fontes UMA vez, com todas as chaves', async () => {
            const { service, sugestoes, ajustes } = make();
            await service.resolver(nelson);
            const chaves = nelson.map(({ filCod, docCod, titCod }) => ({
                filCod,
                docCod,
                titCod,
            }));
            expect(sugestoes.chavesComConfirmacaoVigente).toHaveBeenCalledTimes(1);
            expect(sugestoes.chavesComConfirmacaoVigente).toHaveBeenCalledWith(chaves);
            expect(ajustes.liquidosDeTitulosRenegociados).toHaveBeenCalledWith(chaves);
        });

        it('sem títulos não consulta nada', async () => {
            const { service, sugestoes, ajustes } = make();
            expect((await service.resolver([])).size).toBe(0);
            expect(sugestoes.chavesComConfirmacaoVigente).not.toHaveBeenCalled();
            expect(ajustes.liquidosDeTitulosRenegociados).not.toHaveBeenCalled();
        });
    });
});

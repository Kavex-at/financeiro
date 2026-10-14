import 'reflect-metadata';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import LotePagamentoApiView from './LotePagamentoApiView.js';

const view = new LotePagamentoApiView();

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 2,
    docCod: '636',
    titCod: '1',
    incluidoPor: 'ana',
    divergencia: false,
    ...over,
});

const lote = (itens: ItemLote[]): LotePagamento =>
    ({ id: 'L1', filCod: 2, status: 'FINALIZADO', itens }) as unknown as LotePagamento;

describe('LotePagamentoApiView — vínculo do código de barras (ADR-0071)', () => {
    it('expõe só as chaves permitidas do vínculo, sem nenhum código', () => {
        const api = view.lote(
            lote([
                item({
                    vinculoCodigoBarras: {
                        origem: 'DECISAO_HUMANA',
                        decisaoId: 'dec-1',
                        codigoMascarado: '34191…9000',
                        aplicadoEm: '2026-10-14T12:00:00.000Z',
                        flpCod: 36,
                        // Um campo que não deveria existir no tipo: não pode vazar pela projeção.
                        ...({ codigo: '3'.repeat(44) } as object),
                    },
                }),
            ]),
        );
        const v = api.itens[0]?.vinculoCodigoBarras;
        expect(Object.keys(v ?? {}).sort()).toEqual(
            ['aplicadoEm', 'codigoMascarado', 'decisaoId', 'flpCod', 'origem'].sort(),
        );
        expect(JSON.stringify(api)).not.toMatch(/\d{10,}/);
    });

    it('item sem vínculo não ganha a chave', () => {
        const api = view.lote(lote([item()]));
        expect(api.itens[0]).not.toHaveProperty('vinculoCodigoBarras');
    });
});

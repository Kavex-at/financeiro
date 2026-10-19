import 'reflect-metadata';
import type { ItemPdf } from '../../libs/pdf/ExtratorTextoPdf.js';
import LeituraDanfse from './LeituraDanfse.js';

const leitura = new LeituraDanfse();
const item = (texto: string, x: number, y: number, pagina = 1): ItemPdf => ({
    texto,
    x,
    y,
    pagina,
});

describe('LeituraDanfse — DPS e NFS-e do DANFSe (ADR-0073)', () => {
    it('rótulo em cima, valor embaixo, rótulos lado a lado (colunas)', () => {
        const r = leitura.ler([
            item('NÚMERO DA NFS-e', 50, 700),
            item('NÚMERO DA DPS', 300, 700),
            item('86666', 50, 688),
            item('776132', 300, 688),
        ]);
        expect(r).toEqual({ dps: '776132', nfse: '86666' });
    });

    it('rótulos empilhados numa coluna (o print do 41155)', () => {
        const r = leitura.ler([
            item('NÚMERO DA NFS-e', 400, 760),
            item('86666', 400, 750),
            item('NÚMERO DA DPS', 400, 735),
            item('776132', 400, 725),
        ]);
        expect(r).toEqual({ dps: '776132', nfse: '86666' });
    });

    it('valor na mesma linha, depois do rótulo, no mesmo trecho ou no seguinte', () => {
        expect(leitura.ler([item('Número da DPS: 25459', 50, 700)]).dps).toBe('25459');
        expect(leitura.ler([item('Número da DPS', 50, 700), item('164646', 140, 700)]).dps).toBe(
            '164646',
        );
    });

    it('ignora acento e caixa no rótulo, e NFS-e escrito como NFSe', () => {
        const r = leitura.ler([
            item('numero da nfse', 50, 700),
            item('86666', 50, 690),
            item('Numero da Dps', 200, 700),
            item('776132', 200, 690),
        ]);
        expect(r).toEqual({ dps: '776132', nfse: '86666' });
    });

    it('não confunde "Série da DPS" ou data com o número', () => {
        const r = leitura.ler([
            item('NÚMERO DA DPS', 300, 700),
            item('SÉRIE DA DPS', 400, 700),
            item('776132', 300, 688),
            item('900', 400, 688),
            item('13/10/2026', 500, 688),
        ]);
        expect(r.dps).toBe('776132');
    });

    it('valor de outra coluna ou longe demais não é tomado', () => {
        expect(
            leitura.ler([item('NÚMERO DA DPS', 300, 700), item('776132', 50, 688)]).dps,
        ).toBeUndefined();
        expect(
            leitura.ler([item('NÚMERO DA DPS', 300, 700), item('776132', 300, 600)]).dps,
        ).toBeUndefined();
    });

    it('DANFSe v2.0 real (NF_86666.PDF do GED, posições extraídas em 2026-10-19)', () => {
        const r = leitura.ler([
            item('NÚMERO DA NFS-e', 9.35, 769.55),
            item('86666', 9.35, 762.32),
            item('COMPETÊNCIA DA NFS-e', 155.34, 769.55),
            item('DATA E HORA DA EMISSÃO DA NFS-E', 301.32, 769.55),
            item('NÚMERO DA DPS', 9.35, 749.99),
            item('776132', 9.35, 742.76),
            item('SÉRIE DA DPS', 155.34, 749.99),
            item('DATA E HORA DA EMISSÃO DA DPS', 301.32, 749.99),
            item('Número Processo Suspensão', 447.31, 463.28),
        ]);
        expect(r).toEqual({ dps: '776132', nfse: '86666' });
    });

    it('PDF sem o rótulo (outro documento) → nada lido', () => {
        expect(leitura.ler([item('BOLETO', 50, 700), item('776132000', 50, 690)])).toEqual({});
    });
});

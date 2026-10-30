import 'reflect-metadata';
import {
    FORNECEDOR_ORIGEM,
    type EvidenciaConta,
} from '../../interface/sispag/FornecedorContaBoleto.js';
import ConsolidacaoFornecedorConta from './ConsolidacaoFornecedorConta.js';

const consolidacao = new ConsolidacaoFornecedorConta();
const dia = (d: number) => new Date(Date.UTC(2026, 9, d));
const ev = (p: Partial<EvidenciaConta> & { chave?: string }): EvidenciaConta => ({
    chave: '237:2370/0020702',
    pesCod: '10',
    credor: 'ACME LTDA',
    origem: FORNECEDOR_ORIGEM.INFERIDO,
    boleto: 'b1',
    vistoEm: dia(1),
    ...p,
});

describe('ConsolidacaoFornecedorConta — conta → fornecedor (ADR-0081)', () => {
    it('um fornecedor só: nomeia, conta boletos distintos e guarda a última vez vista', () => {
        const [m] = consolidacao.consolidar([
            ev({ boleto: 'b1', vistoEm: dia(1) }),
            ev({ boleto: 'b2', vistoEm: dia(5) }),
            ev({ boleto: 'b2', vistoEm: dia(3) }),
        ]);
        expect(m).toMatchObject({
            pesCod: '10',
            credor: 'ACME LTDA',
            origem: 'INFERIDO',
            ambiguo: false,
            evidencias: 2,
        });
        expect(m?.ultimaEvidenciaEm).toEqual(dia(5));
    });

    it('2+ fornecedores na mesma origem → ambígua, sem nome (nunca por maioria)', () => {
        const [m] = consolidacao.consolidar([
            ev({ pesCod: '10', boleto: 'b1' }),
            ev({ pesCod: '10', boleto: 'b2' }),
            ev({ pesCod: '10', boleto: 'b3' }),
            ev({ pesCod: '20', credor: 'OUTRA SA', boleto: 'b4' }),
        ]);
        expect(m).toMatchObject({ ambiguo: true, origem: 'INFERIDO', evidencias: 4 });
        expect(m?.pesCod).toBeUndefined();
        expect(m?.credor).toBeUndefined();
    });

    it('origem mais confiável vence: vínculo > decisão > inferência', () => {
        const [m] = consolidacao.consolidar([
            ev({ pesCod: '20', credor: 'INFERIDO SA', origem: 'INFERIDO', boleto: 'b1' }),
            ev({ pesCod: '20', credor: 'INFERIDO SA', origem: 'INFERIDO', boleto: 'b2' }),
            ev({ pesCod: '30', credor: 'CONFIRMADO SA', origem: 'CONFIRMADO', boleto: 'b3' }),
        ]);
        expect(m).toMatchObject({ pesCod: '30', origem: 'CONFIRMADO', ambiguo: false });
        const [v] = consolidacao.consolidar([
            ev({ pesCod: '30', origem: 'CONFIRMADO', boleto: 'b3' }),
            ev({ pesCod: '40', credor: 'LIGADO SA', origem: 'VINCULADO', boleto: 'b4' }),
        ]);
        expect(v).toMatchObject({ pesCod: '40', origem: 'VINCULADO' });
    });

    it('a inferência conflitante NÃO torna ambígua uma chave já vinculada', () => {
        const [m] = consolidacao.consolidar([
            ev({ pesCod: '40', origem: 'VINCULADO', boleto: 'b1' }),
            ev({ pesCod: '99', origem: 'INFERIDO', boleto: 'b2' }),
        ]);
        expect(m).toMatchObject({ pesCod: '40', ambiguo: false });
    });

    it('nome: o mais frequente; empate vai ao mais recente; sem nome fica sem credor', () => {
        const [a] = consolidacao.consolidar([
            ev({ credor: 'ACME', boleto: 'b1', vistoEm: dia(9) }),
            ev({ credor: 'ACME LTDA', boleto: 'b2', vistoEm: dia(2) }),
            ev({ credor: 'ACME LTDA', boleto: 'b3', vistoEm: dia(3) }),
        ]);
        expect(a?.credor).toBe('ACME LTDA');
        const [b] = consolidacao.consolidar([
            ev({ credor: 'ACME', boleto: 'b1', vistoEm: dia(9) }),
            ev({ credor: 'ACME LTDA', boleto: 'b2', vistoEm: dia(2) }),
        ]);
        expect(b?.credor).toBe('ACME');
        const [c] = consolidacao.consolidar([ev({ credor: '  ', origem: 'VINCULADO' })]);
        expect(c?.credor).toBeUndefined();
    });

    it('inferência exige 2 boletos distintos; vínculo e decisão valem com 1', () => {
        // Mesmas barras repetidas (pool duplicado) contam como UM boleto.
        expect(
            consolidacao.consolidar([ev({ boleto: 'b1' }), ev({ boleto: 'b1', vistoEm: dia(4) })]),
        ).toEqual([]);
        expect(consolidacao.consolidar([ev({ boleto: 'b1' }), ev({ boleto: 'b2' })])).toHaveLength(
            1,
        );
        for (const origem of ['VINCULADO', 'CONFIRMADO'] as const) {
            expect(consolidacao.consolidar([ev({ origem })])).toHaveLength(1);
        }
    });

    it('chaves independentes saem ordenadas; entrada vazia → vazio', () => {
        const r = consolidacao.consolidar([
            ev({ chave: '341:2938/09346', origem: 'VINCULADO' }),
            ev({ chave: '033:0045185', origem: 'VINCULADO' }),
        ]);
        expect(r.map((m) => m.chave)).toEqual(['033:0045185', '341:2938/09346']);
        expect(consolidacao.consolidar([])).toEqual([]);
    });
});

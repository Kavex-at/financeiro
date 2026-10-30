import 'reflect-metadata';
import type { BoletoDdaConsolidado } from '../../interface/sispag/BoletoDda.js';
import type { MapeamentoConta } from '../../interface/sispag/FornecedorContaBoleto.js';
import ContaBeneficiariaBoleto from '../../libs/boleto/ContaBeneficiariaBoleto.js';
import type FornecedorContaBoletoRepository from '../../repository/sispag/FornecedorContaBoletoRepository.js';
import FornecedorBoletoDda from './FornecedorBoletoDda.js';

const BRADESCO = '23797155500001521302370091362260338500207020';
const ITAU = '34193155500000300001090049258469260408340000';
const SEM_LAYOUT_329 = '32995155600000257731126204724926063308900107';

const linha = (codbar?: string): BoletoDdaConsolidado => ({
    ddcCod: 1,
    ditCod: 1,
    valor: 10,
    arquivos: 1,
    vencido: false,
    situacao: 'SEM_TITULO',
    candidatos: [],
    ...(codbar ? { codbar } : {}),
});

const mapa = (...ms: Array<Partial<MapeamentoConta> & { chave: string }>) =>
    new Map(
        ms.map((m) => [
            m.chave,
            {
                origem: 'INFERIDO',
                ambiguo: false,
                evidencias: 1,
                ultimaEvidenciaEm: new Date(),
                ...m,
            } as MapeamentoConta,
        ]),
    );

const build = (mapeamentos: Map<string, MapeamentoConta>) => {
    const repo = { listMapeamentos: jest.fn().mockResolvedValue(mapeamentos) };
    return new FornecedorBoletoDda(
        repo as unknown as FornecedorContaBoletoRepository,
        new ContaBeneficiariaBoleto(),
    );
};

describe('FornecedorBoletoDda — enriquece a lista com o fornecedor da conta (ADR-0081)', () => {
    it('põe o fornecedor, com a origem, no boleto cuja conta foi aprendida', async () => {
        const f = build(
            mapa(
                { chave: '237:2370/0020702', pesCod: '10', credor: 'ACME LTDA' },
                { chave: '341:9260/40834', pesCod: '20', credor: 'BETA SA', origem: 'VINCULADO' },
            ),
        );
        const [a, b] = await f.enriquecer([linha(BRADESCO), linha(ITAU)]);
        expect(a?.fornecedor).toEqual({ pesCod: '10', nome: 'ACME LTDA', origem: 'INFERIDO' });
        expect(b?.fornecedor).toEqual({ pesCod: '20', nome: 'BETA SA', origem: 'VINCULADO' });
    });

    it('conta ambígua, desconhecida, banco sem layout e boleto sem barras ficam sem fornecedor', async () => {
        const f = build(mapa({ chave: '237:2370/0020702', ambiguo: true }));
        const r = await f.enriquecer([
            linha(BRADESCO),
            linha(ITAU),
            linha(SEM_LAYOUT_329),
            linha(),
        ]);
        expect(r.every((b) => b.fornecedor === undefined)).toBe(true);
    });

    it('não altera situação, candidatos nem a ordem; mapeamento vazio devolve a MESMA lista', async () => {
        const entrada = [linha(BRADESCO), linha(ITAU)];
        expect(await build(new Map()).enriquecer(entrada)).toBe(entrada);
        const f = build(mapa({ chave: '237:2370/0020702', pesCod: '10', credor: 'ACME' }));
        const r = await f.enriquecer(entrada);
        expect(r.map((b) => b.codbar)).toEqual([BRADESCO, ITAU]);
        expect(r[0]).toMatchObject({ situacao: 'SEM_TITULO', candidatos: [] });
    });

    it('não muta as linhas de entrada', async () => {
        const entrada = [linha(BRADESCO)];
        await build(mapa({ chave: '237:2370/0020702', pesCod: '10', credor: 'ACME' })).enriquecer(
            entrada,
        );
        expect(entrada[0]?.fornecedor).toBeUndefined();
    });
});

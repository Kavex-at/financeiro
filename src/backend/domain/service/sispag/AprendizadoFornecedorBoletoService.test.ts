import 'reflect-metadata';
import ContaBeneficiariaBoleto from '../../libs/boleto/ContaBeneficiariaBoleto.js';
import type FornecedorContaBoletoRepository from '../../repository/sispag/FornecedorContaBoletoRepository.js';
import AprendizadoFornecedorBoletoService from './AprendizadoFornecedorBoletoService.js';
import ConsolidacaoFornecedorConta from './ConsolidacaoFornecedorConta.js';

// Barras reais do export de PRD de 30/10: a mesma conta Bradesco (2370/0020702) e uma Itaú.
const BRADESCO_A = '23797155500001521302370091362260338500207020';
const BRADESCO_B = '23797155500009999992370091362260338500207020';
const ITAU = '34193155500000300001090049258469260408340000';
const SANTANDER = '03397155500003471149004518500000003221400101';
const SANTANDER_OUTRO = '03397155500009999999004518500000003221400101';
const SEM_LAYOUT_329 = '32995155600000257731126204724926063308900107';
const visto = new Date('2026-10-30T12:00:00Z');

const build = (evidencias: unknown[]) => {
    const repo = {
        listEvidencias: jest.fn().mockResolvedValue(evidencias),
        substituir: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AprendizadoFornecedorBoletoService(
        repo as unknown as FornecedorContaBoletoRepository,
        new ContaBeneficiariaBoleto(),
        new ConsolidacaoFornecedorConta(),
    );
    return { service, repo };
};

describe('AprendizadoFornecedorBoletoService — conta do beneficiário → fornecedor (ADR-0081)', () => {
    it('agrupa boletos da mesma conta, ignora banco sem layout e grava o mapeamento inteiro', async () => {
        const { service, repo } = build([
            {
                codbar: BRADESCO_A,
                pesCod: '10',
                credor: 'ACME',
                origem: 'INFERIDO',
                vistoEm: visto,
            },
            {
                codbar: BRADESCO_B,
                pesCod: '10',
                credor: 'ACME',
                origem: 'INFERIDO',
                vistoEm: visto,
            },
            { codbar: ITAU, pesCod: '20', credor: 'BETA', origem: 'VINCULADO', vistoEm: visto },
            { codbar: SEM_LAYOUT_329, pesCod: '30', origem: 'INFERIDO', vistoEm: visto },
        ]);
        const r = await service.aprender();
        expect(repo.substituir).toHaveBeenCalledTimes(1);
        expect(repo.substituir.mock.calls[0]?.[0]).toEqual([
            expect.objectContaining({ chave: '237:2370/0020702', pesCod: '10', evidencias: 2 }),
            expect.objectContaining({ chave: '341:9260/40834', pesCod: '20', origem: 'VINCULADO' }),
        ]);
        expect(r).toEqual({
            chaves: 2,
            ambiguas: 0,
            porOrigem: { VINCULADO: 1, CONFIRMADO: 0, INFERIDO: 1 },
        });
    });

    it('conta com 2 fornecedores na mesma origem é gravada ambígua e não entra na contagem por origem', async () => {
        const { service, repo } = build([
            { codbar: SANTANDER, pesCod: '10', credor: 'ACME', origem: 'INFERIDO', vistoEm: visto },
            {
                codbar: SANTANDER_OUTRO,
                pesCod: '99',
                credor: 'OUTRA',
                origem: 'INFERIDO',
                vistoEm: visto,
            },
        ]);
        const r = await service.aprender();
        expect(repo.substituir.mock.calls[0]?.[0]).toEqual([
            expect.objectContaining({ chave: '033:0045185', ambiguo: true }),
        ]);
        expect(r).toMatchObject({ chaves: 1, ambiguas: 1 });
        expect(r.porOrigem.INFERIDO).toBe(0);
    });

    it('sem evidência, substitui por vazio (o mapeamento acompanha a evidência)', async () => {
        const { service, repo } = build([]);
        await service.aprender();
        expect(repo.substituir).toHaveBeenCalledWith([]);
    });

    it('erro de leitura propaga e NÃO apaga o mapeamento anterior', async () => {
        const { service, repo } = build([]);
        repo.listEvidencias.mockRejectedValue(new Error('db fora'));
        await expect(service.aprender()).rejects.toThrow('db fora');
        expect(repo.substituir).not.toHaveBeenCalled();
    });
});

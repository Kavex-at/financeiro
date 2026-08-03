import 'reflect-metadata';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosFin014Client from './ConexosFin014Client.js';

const buildBase = (over: Partial<Record<string, jest.Mock>> = {}) =>
    ({
        ensureSid: jest.fn().mockResolvedValue(undefined),
        runWithRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
        postGeneric: jest.fn(),
        postGenericOnce: jest.fn(),
        ...over,
    }) as unknown as ConexosBaseClient;

describe('ConexosFin014Client', () => {
    it('criarBordero: postGeneric /fin014 + Zod exige borCod', async () => {
        const postGeneric = jest.fn().mockResolvedValue({ borCod: 7300, filCod: 2 });
        const client = new ConexosFin014Client(buildBase({ postGeneric }));
        const r = await client.criarBordero({ filCod: 2, dataMovto: 0, gerNum: 330037 });
        expect(r.borCod).toBe(7300);
        expect(postGeneric.mock.calls[0][0]).toBe('fin014');
        expect(postGeneric.mock.calls[0][1]).toMatchObject({
            gerNum: 330037,
            frontModelName: 'bordero',
        });
    });

    it('criarBordero: resposta sem borCod → ConexosError', async () => {
        const client = new ConexosFin014Client(
            buildBase({ postGeneric: jest.fn().mockResolvedValue({}) }),
        );
        await expect(client.criarBordero({ filCod: 2, dataMovto: 0, gerNum: 1 })).rejects.toThrow();
    });

    it('criarBordero: captura o gerDes que o ERP ecoa (reusado na baixa)', async () => {
        const postGeneric = jest
            .fn()
            .mockResolvedValue({ borCod: 7300, filCod: 2, gerDes: 'BANCO BRASIL - CONTA 1' });
        const client = new ConexosFin014Client(buildBase({ postGeneric }));
        const r = await client.criarBordero({ filCod: 2, dataMovto: 0, gerNum: 330037 });
        expect(r.gerDes).toBe('BANCO BRASIL - CONTA 1');
    });

    it('listTitulosBorderoReceber: lov filtrado por docCod → título real (titCod/titEspNumero)', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            rows: [{ docCod: 18342, titCod: 1, titEspNumero: '2082026', titMnyAberto: 100 }],
        });
        const client = new ConexosFin014Client(buildBase({ postGeneric }));
        const r = await client.listTitulosBorderoReceber({ filCod: 2, docCod: 18342 });
        expect(postGeneric.mock.calls[0][0]).toBe('lov/TituloBorderoReceber');
        expect(postGeneric.mock.calls[0][1].filterList).toMatchObject({ 'docCod#EQ': 18342 });
        expect(r[0]).toMatchObject({ docCod: 18342, titCod: 1, titEspNumero: '2082026' });
    });

    it('validarTituloBaixa: envia titEspNumero + titCod reais (não o 1 fixo)', async () => {
        const postGeneric = jest
            .fn()
            .mockResolvedValue({ messages: [], responseData: { bxaMnyValor: 100 } });
        const client = new ConexosFin014Client(buildBase({ postGeneric }));
        await client.validarTituloBaixa({
            filCod: 2,
            borCod: 7300,
            docCod: 18342,
            titCod: 3,
            titEspNumero: '2082026',
        });
        expect(postGeneric.mock.calls[0][0]).toBe('fin014/baixas/validacao/tituloBaixa');
        expect(postGeneric.mock.calls[0][1]).toMatchObject({ titCod: 3, titEspNumero: '2082026' });
    });

    it('gravarBaixa: usa postGenericOnce (irreversível) e exige bxaCodSeq', async () => {
        const postGenericOnce = jest.fn().mockResolvedValue({ bxaCodSeq: 55 });
        const client = new ConexosFin014Client(buildBase({ postGenericOnce }));
        const r = await client.gravarBaixa({ filCod: 2, payload: { docCod: 18202 } });
        expect(r.bxaCodSeq).toBe(55);
        expect(postGenericOnce).toHaveBeenCalledTimes(1);
        expect(postGenericOnce.mock.calls[0][0]).toBe('fin014/baixas');
    });

    it('finalizarBordero: POST /fin014/finalizar/{borCod}', async () => {
        const postGeneric = jest.fn().mockResolvedValue({});
        const client = new ConexosFin014Client(buildBase({ postGeneric }));
        await client.finalizarBordero({ filCod: 2, borCod: 7300 });
        expect(postGeneric.mock.calls[0][0]).toBe('fin014/finalizar/7300');
    });
});

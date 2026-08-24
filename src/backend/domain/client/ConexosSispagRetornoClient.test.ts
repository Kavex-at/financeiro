import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosSispagRetornoClient from './ConexosSispagRetornoClient.js';

const buildBase = () => ({
    listGenericPaginated: jest.fn(),
    postMultipartOnce: jest.fn(),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});
const make = (base: ReturnType<typeof buildBase>) =>
    new ConexosSispagRetornoClient(base as unknown as ConexosBaseClient);

const validationError = (body: unknown) => ({ response: { status: 400, data: body } });

describe('ConexosSispagRetornoClient (fin052 retorno)', () => {
    it('listArquivosRetorno mapeia o grid e aplica filtros #EQ + serviceName fin052', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [
                {
                    filCod: 1,
                    bncCod: 4,
                    gtbCodSeq: 1,
                    garCodSeq: 7,
                    garEspArquivo: 'PG0707.RET',
                    garVldStatus: 1,
                    gtbDesNome: 'RETORNO SISPAG - ITAÚ',
                    titulosRejeitados: 2,
                },
            ],
        });
        const arqs = await make(base).listArquivosRetorno({
            filCod: 1,
            bncCod: 4,
            gtbCodSeq: 1,
            status: 1,
        });
        expect(base.runWithRetry).toHaveBeenCalledTimes(1);
        expect(arqs[0]).toMatchObject({
            filCod: 1,
            bncCod: 4,
            gtbCodSeq: 1,
            garCodSeq: 7,
            arquivo: 'PG0707.RET',
            status: 1,
            configNome: 'RETORNO SISPAG - ITAÚ',
            titulosRejeitados: 2,
        });
        const [endpoint, body] = base.listGenericPaginated.mock.calls[0];
        expect(endpoint).toBe('fin052/arquivosRetorno/list');
        expect(body).toMatchObject({
            serviceName: 'fin052',
            filterList: { 'bncCod#EQ': 4, 'gtbCodSeq#EQ': 1, 'garVldStatus#EQ': 1 },
        });
    });

    it('listDetalhe expõe a ponte bxaCodSeq/borCod/titCod (fin010)', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [
                {
                    filCod: 1,
                    bncCod: 4,
                    gtbCodSeq: 1,
                    garCodSeq: 7,
                    docCod: 900,
                    titCod: 1,
                    borCod: 1850,
                    bxaCodSeq: 42,
                    dpeNomPessoa: 'DC LOGISTICS',
                    itsMnyVlrPgto: 1000,
                },
            ],
        });
        const det = await make(base).listDetalhe({
            filCod: 1,
            bncCod: 4,
            gtbCodSeq: 1,
            garCodSeq: 7,
            // O ERP exige o código EXATO do evento como filtro (REQUIRED_FILTER_ERROR sem ele).
            eventoCod: '00',
        });
        const [, body] = base.listGenericPaginated.mock.calls[0];
        expect((body as { filterList: Record<string, unknown> }).filterList).toMatchObject({
            'fbeEspCod#EQ': '00',
            'fbeVldTipo#EQ': 2,
        });
        expect(det[0]).toMatchObject({
            docCod: '900',
            titCod: '1',
            borCod: 1850,
            bxaCodSeq: 42,
            favorecido: 'DC LOGISTICS',
            valorPago: 1000,
        });
        expect(base.listGenericPaginated.mock.calls[0][0]).toBe(
            'fin052/arquivosRetornoDetalhe/list',
        );
    });

    it('listErros mapeia linha + mensagem', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [
                {
                    bncCod: 4,
                    gtbCodSeq: 1,
                    garCodSeq: 7,
                    areCodLine: 12,
                    areEspErro: 'CNPJ inválido',
                },
            ],
        });
        const erros = await make(base).listErros({
            filCod: 1,
            bncCod: 4,
            gtbCodSeq: 1,
            garCodSeq: 7,
        });
        expect(erros[0]).toMatchObject({ linha: 12, mensagem: 'CNPJ inválido' });
    });

    it('listConfigsRetorno descobre os gtbCodSeq via ger015', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 1,
            rows: [{ bncCod: 4, gtbCodSeq: 1, gtbDesNome: 'RETORNO ITAÚ', gtbVldStatus: 1 }],
        });
        const cfgs = await make(base).listConfigsRetorno({ filCod: 1, bncCod: 4 });
        expect(cfgs[0]).toMatchObject({ bncCod: 4, gtbCodSeq: 1, nome: 'RETORNO ITAÚ', status: 1 });
        expect(base.listGenericPaginated.mock.calls[0][0]).toBe('ger015/list');
    });

    it('carregarArquivoRetorno usa postMultipartOnce com FormData + fileName na query', async () => {
        const base = buildBase();
        base.postMultipartOnce.mockResolvedValue({
            filCod: 1,
            bncCod: 4,
            gtbCodSeq: 1,
            garCodSeq: 8,
        });
        const res = await make(base).carregarArquivoRetorno({
            filCod: 1,
            bncCod: 4,
            gtbCodSeq: 1,
            fileName: 'PG0707.RET',
            conteudo: Buffer.from('34100000...'),
        });
        expect(res.garCodSeq).toBe(8);
        const [path, form, opts] = base.postMultipartOnce.mock.calls[0];
        expect(path).toBe('fin052/arquivosRetorno/carregar/4/1?fileName=PG0707.RET');
        expect(form).toBeInstanceOf(FormData);
        expect((form as FormData).has('file')).toBe(true);
        expect(opts).toEqual({ filCod: 1 });
    });

    it('erro do ERP vira ConexosError com a msg do VALIDATION_LIST', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockRejectedValue(
            validationError({
                type: 'VALIDATION_LIST',
                messages: [{ vars: { msg: 'CONFIG DE RETORNO INEXISTENTE' } }],
            }),
        );
        await expect(
            make(base).listArquivosRetorno({ filCod: 1, bncCod: 4, gtbCodSeq: 1 }),
        ).rejects.toBeInstanceOf(ConexosError);
        await expect(
            make(base).listArquivosRetorno({ filCod: 1, bncCod: 4, gtbCodSeq: 1 }),
        ).rejects.toMatchObject({ message: expect.stringContaining('CONFIG DE RETORNO') });
    });
});

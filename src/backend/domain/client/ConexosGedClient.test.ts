import 'reflect-metadata';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosGedClient from './ConexosGedClient.js';

const buildBase = () => ({
    getGeneric: jest.fn(),
    postGeneric: jest.fn(),
    listGenericPaginated: jest.fn(),
    getBinary: jest.fn(),
});

const clientCom = (base: ReturnType<typeof buildBase>) =>
    new ConexosGedClient(base as unknown as ConexosBaseClient);

// Respostas reais (captura de rede do `arq020`, título 41155/1, 2026-10-19), reduzidas.
const ARVORE = [
    {
        state: { opened: false },
        label: '0038BTC/26 (4100)',
        data: null,
        children: [
            {
                label: 'Nova Pasta',
                children: [],
                data: { dcmCod: 46415, dcmDesDescricao: 'Nova Pasta', filCod: 2, priCod: 4100 },
            },
        ],
    },
];
const ARQUIVOS = {
    count: 1,
    rows: [
        {
            dcmCod: 46415,
            adfCodSeq: 1,
            adfEspDescricao: 'NF_86666.PDF',
            tflDesDescricao: 'PDF',
            binEspName: 'NF_86666.PDF',
            binNumSize: 115850,
        },
    ],
};

describe('ConexosGedClient (arq020, ADR-0073) — só leitura', () => {
    it('priCodDoDocumento lê o processo do cabeçalho do com298', async () => {
        const base = buildBase();
        base.getGeneric.mockResolvedValue({ docCod: 41155, priCod: 4100 });
        expect(await clientCom(base).priCodDoDocumento({ filCod: 2, docCod: '41155' })).toBe(4100);
        expect(base.getGeneric).toHaveBeenCalledWith('com298/41155', { filCod: 2 });
    });

    it('priCodDoDocumento devolve undefined quando o documento não tem processo', async () => {
        const base = buildBase();
        base.getGeneric.mockResolvedValue({ docCod: 41155, priCod: null });
        expect(
            await clientCom(base).priCodDoDocumento({ filCod: 2, docCod: '41155' }),
        ).toBeUndefined();
    });

    it('pastasDoDocumento envia os parâmetros do psq014 e achata a árvore em dcmCod', async () => {
        const base = buildBase();
        base.postGeneric.mockResolvedValue(ARVORE);
        const pastas = await clientCom(base).pastasDoDocumento({
            filCod: 2,
            docCod: '41155',
            docTip: 2,
            priCod: 4100,
        });
        expect(pastas).toEqual([{ dcmCod: 46415, descricao: 'Nova Pasta' }]);
        expect(base.postGeneric).toHaveBeenCalledWith(
            'arq020/TelaDocumento/list',
            {
                parameters: {
                    filCod: '2',
                    vldTodos: 0,
                    docTip: '2',
                    docCod: '41155',
                    priCod: '4100',
                },
            },
            { filCod: 2 },
        );
    });

    it('pastasDoDocumento tolera resposta que não é árvore (sem pasta)', async () => {
        const base = buildBase();
        base.postGeneric.mockResolvedValue({ unexpected: true });
        expect(
            await clientCom(base).pastasDoDocumento({
                filCod: 2,
                docCod: '1',
                docTip: 2,
                priCod: 1,
            }),
        ).toEqual([]);
    });

    it('arquivosDaPasta filtra pelo documento e mapeia nome, tipo e tamanho', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue(ARQUIVOS);
        const arquivos = await clientCom(base).arquivosDaPasta(46415, {
            filCod: 2,
            docCod: '41155',
            docTip: 2,
        });
        expect(arquivos).toEqual([
            { dcmCod: 46415, adfCodSeq: 1, nome: 'NF_86666.PDF', tipo: 'PDF', tamanho: 115850 },
        ]);
        const [path, body, opts] = base.listGenericPaginated.mock.calls[0] as [
            string,
            Record<string, unknown>,
            unknown,
        ];
        expect(path).toBe('arq020/arqDocFiles/list/46415');
        expect(body).toMatchObject({
            serviceName: 'arq020.arquivos',
            filterList: { filCodFilterDoc: '2', docCodFilterDoc: '41155', docTipFilterDoc: '2' },
        });
        expect(opts).toEqual({ filCod: 2 });
    });

    it('arquivosDaPasta descarta linha sem adfCodSeq ou sem nome', async () => {
        const base = buildBase();
        base.listGenericPaginated.mockResolvedValue({
            count: 2,
            rows: [
                { dcmCod: 46415, adfEspDescricao: 'X.PDF' },
                { dcmCod: 46415, adfCodSeq: 2 },
            ],
        });
        expect(
            await clientCom(base).arquivosDaPasta(46415, { filCod: 2, docCod: '1', docTip: 2 }),
        ).toEqual([]);
    });

    it('baixarArquivo pede os bytes do arquivo da pasta', async () => {
        const base = buildBase();
        base.getBinary.mockResolvedValue(Buffer.from('%PDF-1.7'));
        const bytes = await clientCom(base).baixarArquivo({
            dcmCod: 46415,
            adfCodSeq: 1,
            filCod: 2,
        });
        expect(bytes.toString()).toBe('%PDF-1.7');
        expect(base.getBinary).toHaveBeenCalledWith('arq020/arqDocFiles/download/46415/1', {
            filCod: 2,
        });
    });
});

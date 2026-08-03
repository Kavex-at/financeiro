import 'reflect-metadata';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosNdeFiscalClient from './ConexosNdeFiscalClient.js';
import type { DocFiscal } from '../interface/recebimentos/NdeFiscal.js';

const buildBase = (over: Partial<Record<string, jest.Mock>> = {}) =>
    ({
        ensureSid: jest.fn().mockResolvedValue(undefined),
        getGeneric: jest.fn(),
        postGeneric: jest.fn(),
        postGenericOnce: jest.fn(),
        putGenericOnce: jest.fn(),
        // runWithRetry apenas executa o fn (sem espera real).
        runWithRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
        ...over,
    }) as unknown as ConexosBaseClient;

const docFiscalBase: DocFiscal = {
    filCod: 2,
    docTip: 1,
    docCod: 18337,
    fisCod: 1,
    fisVldTipoNfDebito: 0,
    fisVldTipoNfCredito: 0,
    // um campo "extra" qualquer p/ provar que o passthrough preserva os 73 campos
    fisEspSerie: 'A',
};

describe('ConexosNdeFiscalClient — (a) fiscal com300 (read-modify-write)', () => {
    it('lerDocFiscal: GET com300/{docTip}/{docCod}/{fisCod} devolve o objeto INTEIRO', async () => {
        const getGeneric = jest.fn().mockResolvedValue(docFiscalBase);
        const client = new ConexosNdeFiscalClient(buildBase({ getGeneric }));
        const doc = await client.lerDocFiscal({ filCod: 2, docTip: 1, docCod: 18337, fisCod: 1 });
        expect(getGeneric).toHaveBeenCalledWith('com300/1/18337/1', { filCod: 2 });
        expect(doc.fisEspSerie).toBe('A'); // passthrough preservou o campo extra
    });

    it('gravarDocFiscal: sucesso SÓ quando o eco traz fisVldTipoNfDebito===6', async () => {
        const putGenericOnce = jest
            .fn()
            .mockResolvedValue({ ...docFiscalBase, fisVldTipoNfDebito: 6 });
        const base = buildBase({ putGenericOnce });
        const client = new ConexosNdeFiscalClient(base);
        const eco = await client.gravarDocFiscal({
            filCod: 2,
            finDocFiscal: { ...docFiscalBase, fisVldTipoNfDebito: 6 },
        });
        expect(eco.fisVldTipoNfDebito).toBe(6);
        expect(putGenericOnce).toHaveBeenCalledTimes(1);
        expect(putGenericOnce.mock.calls[0][0]).toBe('com300');
        // objeto INTEIRO no corpo (não parcial)
        expect(putGenericOnce.mock.calls[0][1]).toMatchObject({ docCod: 18337, fisEspSerie: 'A' });
    });

    it('gravarDocFiscal: eco com fisVldTipoNfDebito!==6 FALHA (não é sucesso silencioso)', async () => {
        const putGenericOnce = jest
            .fn()
            .mockResolvedValue({ ...docFiscalBase, fisVldTipoNfDebito: 0 });
        const client = new ConexosNdeFiscalClient(buildBase({ putGenericOnce }));
        await expect(
            client.gravarDocFiscal({ filCod: 2, finDocFiscal: docFiscalBase }),
        ).rejects.toThrow(/com300/);
    });
});

describe('ConexosNdeFiscalClient — (b) observações com131', () => {
    it('gerarObservacoes: sucesso quando fisEspObs vem preenchido', async () => {
        const postGenericOnce = jest
            .fn()
            .mockResolvedValue({ fisEspObs: 'NOTA DE DEBITO AJUSTE SINIEF 49/2025 /' });
        const client = new ConexosNdeFiscalClient(buildBase({ postGenericOnce }));
        const r = await client.gerarObservacoes({ filCod: 2, docTip: 1, docCod: 18337 });
        expect(r.fisEspObs).toContain('AJUSTE SINIEF');
        expect(postGenericOnce).toHaveBeenCalledWith(
            'com131/geraObs',
            { docTip: 1, docCod: 18337 },
            {
                filCod: 2,
            },
        );
    });

    it('gerarObservacoes: fisEspObs vazio FALHA', async () => {
        const postGenericOnce = jest.fn().mockResolvedValue({ fisEspObs: '' });
        const client = new ConexosNdeFiscalClient(buildBase({ postGenericOnce }));
        await expect(
            client.gerarObservacoes({ filCod: 2, docTip: 1, docCod: 18337 }),
        ).rejects.toThrow(/geraObs/);
    });

    it('lerObservacoes: devolve fisEspObs p/ o guard de idempotência', async () => {
        const getGeneric = jest.fn().mockResolvedValue({ fisEspObs: 'X AJUSTE SINIEF Y /' });
        const client = new ConexosNdeFiscalClient(buildBase({ getGeneric }));
        const r = await client.lerObservacoes({ filCod: 2, docTip: 1, docCod: 18337 });
        expect(r.fisEspObs).toContain('AJUSTE SINIEF');
        expect(getGeneric).toHaveBeenCalledWith('com131/1/18337', { filCod: 2 });
    });
});

describe('ConexosNdeFiscalClient — (c) com194 + (poll) com297', () => {
    it('listValidacoes: mapeia as linhas fdv* do com194', async () => {
        const postGeneric = jest
            .fn()
            .mockResolvedValue({ rows: [{ fdvCodSeq: 1, fdvEspErr: 'condicao de pagamento' }] });
        const client = new ConexosNdeFiscalClient(buildBase({ postGeneric }));
        const rows = await client.listValidacoes({ filCod: 2, docTip: 1, docCod: 18337 });
        expect(rows).toHaveLength(1);
        expect(rows[0].fdvEspErr).toBe('condicao de pagamento');
        expect(postGeneric.mock.calls[0][0]).toBe('com194/documento/list');
    });

    it('lerDocParaPolling: lê vldAutorizado / vldTpNf / pré-condições do com297', async () => {
        const getGeneric = jest.fn().mockResolvedValue({
            vldAutorizado: 0,
            vldTpNf: '10',
            docVldConferencia: 1,
            docMnyValor: 0,
        });
        const client = new ConexosNdeFiscalClient(buildBase({ getGeneric }));
        const s = await client.lerDocParaPolling({ filCod: 2, docCod: 18337 });
        expect(s.vldAutorizado).toBe(0);
        expect(s.vldTpNf).toBe('10'); // normalizado p/ string
        expect(getGeneric).toHaveBeenCalledWith('com297/18337', { filCod: 2 });
    });
});

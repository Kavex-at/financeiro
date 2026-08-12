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

describe('ConexosNdeFiscalClient — (d) com297 comDocProdutos (itens da NDe)', () => {
    const itemBase = {
        docCod: 18347,
        fisCod: 1,
        prdCod: 41978,
        dprCodSeq: 1,
        prdDesNome: 'PAGAMENTO ANTECIPADO',
        dprLngDescrNf: null,
        // campo "extra" qualquer p/ provar que o passthrough preserva a linha inteira no RMW
        dprPreValorun: 15000,
    };

    it('listItensNde: POST comDocProdutos/list e normaliza descrição vazia p/ undefined', async () => {
        const postGeneric = jest.fn().mockResolvedValue({
            rows: [itemBase, { ...itemBase, dprCodSeq: 2, dprLngDescrNf: '   ' }],
        });
        const client = new ConexosNdeFiscalClient(buildBase({ postGeneric }));
        const itens = await client.listItensNde({ filCod: 2, docCod: 18347, fisCod: 1 });
        expect(postGeneric.mock.calls[0][0]).toBe('com297/comDocProdutos/list/18347/1');
        expect(itens).toHaveLength(2);
        // `null` e string em branco são a MESMA coisa p/ o invariante: não há descrição.
        expect(itens[0].dprLngDescrNf).toBeUndefined();
        expect(itens[1].dprLngDescrNf).toBeUndefined();
        expect(itens[0].prdDesNome).toBe('PAGAMENTO ANTECIPADO');
    });

    it('listItensNde: descrição preenchida sobrevive (é o caso no-op do fluxo)', async () => {
        const postGeneric = jest
            .fn()
            .mockResolvedValue({ rows: [{ ...itemBase, dprLngDescrNf: 'MERCADORIA X' }] });
        const client = new ConexosNdeFiscalClient(buildBase({ postGeneric }));
        const itens = await client.listItensNde({ filCod: 2, docCod: 18347, fisCod: 1 });
        expect(itens[0].dprLngDescrNf).toBe('MERCADORIA X');
    });

    it('lerItemNde: GET da chave composta devolve a linha INTEIRA (passthrough)', async () => {
        const getGeneric = jest.fn().mockResolvedValue(itemBase);
        const client = new ConexosNdeFiscalClient(buildBase({ getGeneric }));
        const item = await client.lerItemNde({
            filCod: 2,
            docCod: 18347,
            fisCod: 1,
            prdCod: 41978,
            dprCodSeq: 1,
        });
        expect(getGeneric).toHaveBeenCalledWith('com297/comDocProdutos/18347/1/41978/1', {
            filCod: 2,
        });
        expect(item.dprPreValorun).toBe(15000); // passthrough preservou o campo extra
    });

    it('gravarDescricaoItemNde: PUT com a linha INTEIRA + dprLngDescrNf, sucesso ⟺ eco não-vazio', async () => {
        const putGenericOnce = jest
            .fn()
            .mockResolvedValue({ ...itemBase, dprLngDescrNf: 'PAGAMENTO ANTECIPADO' });
        const client = new ConexosNdeFiscalClient(buildBase({ putGenericOnce }));
        const eco = await client.gravarDescricaoItemNde({
            filCod: 2,
            item: { ...itemBase, dprLngDescrNf: undefined },
            descricao: 'PAGAMENTO ANTECIPADO',
        });
        expect(putGenericOnce).toHaveBeenCalledTimes(1); // tentativa ÚNICA
        expect(putGenericOnce.mock.calls[0][0]).toBe('com297/comDocProdutos');
        // objeto INTEIRO no corpo (campo omitido viraria null no banco)
        expect(putGenericOnce.mock.calls[0][1]).toMatchObject({
            docCod: 18347,
            dprPreValorun: 15000,
            dprLngDescrNf: 'PAGAMENTO ANTECIPADO',
        });
        expect(eco.dprLngDescrNf).toBe('PAGAMENTO ANTECIPADO');
    });

    it('gravarDescricaoItemNde: eco SEM descrição FALHA (não é sucesso silencioso)', async () => {
        const putGenericOnce = jest.fn().mockResolvedValue({ ...itemBase, dprLngDescrNf: '' });
        const client = new ConexosNdeFiscalClient(buildBase({ putGenericOnce }));
        const erro = await client
            .gravarDescricaoItemNde({
                filCod: 2,
                item: itemBase,
                descricao: 'PAGAMENTO ANTECIPADO',
            })
            .catch((e: { cause?: Error }) => e);
        expect(String((erro as { cause?: Error }).cause?.message)).toMatch(/dprLngDescrNf/);
    });

    it('gravarDescricaoItemNde: recusa descrição vazia ANTES de chamar o ERP', async () => {
        const putGenericOnce = jest.fn();
        const client = new ConexosNdeFiscalClient(buildBase({ putGenericOnce }));
        const erro = await client
            .gravarDescricaoItemNde({ filCod: 2, item: itemBase, descricao: '   ' })
            .catch((e: { cause?: Error }) => e);
        expect(String((erro as { cause?: Error }).cause?.message)).toMatch(/vazia/);
        expect(putGenericOnce).not.toHaveBeenCalled();
    });

    /** O que de fato foi enviado no PUT — o payload é o que o Oracle vai receber. */
    const descricaoEnviada = (putGenericOnce: jest.Mock): string =>
        (putGenericOnce.mock.calls[0][1] as { dprLngDescrNf: string }).dprLngDescrNf;

    const gravar = async (descricao: string): Promise<jest.Mock> => {
        const putGenericOnce = jest.fn().mockResolvedValue({ ...itemBase, dprLngDescrNf: 'ok' });
        const client = new ConexosNdeFiscalClient(buildBase({ putGenericOnce }));
        await client.gravarDescricaoItemNde({ filCod: 2, item: itemBase, descricao });
        return putGenericOnce;
    };

    it('gravarDescricaoItemNde: trunca em 4000 BYTES (ASCII: 1 byte por char)', async () => {
        const enviada = descricaoEnviada(await gravar('A'.repeat(5000)));
        expect(Buffer.byteLength(enviada, 'utf8')).toBe(4000);
        expect(enviada).toHaveLength(4000); // em ASCII, byte e char coincidem
    });

    /**
     * A regressão que motivou o corte por byte: `VARCHAR2(4000 BYTE)` no Oracle conta BYTES, e cada
     * acento em pt-BR custa 2. Com `slice(0, 4000)` isto ia para o ERP com ~8000 bytes e voltava
     * `ORA-12899` — erro do banco, não da automação.
     */
    it('gravarDescricaoItemNde: texto acentuado corta por BYTE, não por caractere', async () => {
        const enviada = descricaoEnviada(await gravar('ã'.repeat(4000)));
        expect(Buffer.byteLength(enviada, 'utf8')).toBeLessThanOrEqual(4000);
        expect(enviada).toHaveLength(2000); // 2 bytes por 'ã' ⇒ metade dos caracteres
    });

    it('gravarDescricaoItemNde: não parte surrogate pair ao meio na borda do limite', async () => {
        // 3999 bytes de ASCII + um emoji de 4 bytes: o emoji NÃO cabe e sai inteiro, não pela metade.
        const enviada = descricaoEnviada(await gravar(`${'A'.repeat(3999)}😀BBBB`));
        expect(Buffer.byteLength(enviada, 'utf8')).toBeLessThanOrEqual(4000);
        expect(enviada).toBe('A'.repeat(3999));
        // UTF-8 válido ⇒ round-trip por Buffer preserva a string (sem U+FFFD de surrogate solto)
        expect(Buffer.from(enviada, 'utf8').toString('utf8')).toBe(enviada);
    });

    it('gravarDescricaoItemNde: texto dentro do limite passa intacto', async () => {
        const enviada = descricaoEnviada(await gravar('PAGAMENTO ANTECIPADO'));
        expect(enviada).toBe('PAGAMENTO ANTECIPADO');
    });

    it('preDescricaoProdutoNf: aceita string crua, envelope e objeto — e NUNCA lança', async () => {
        const client = (resp: unknown) =>
            new ConexosNdeFiscalClient(
                buildBase({ getGeneric: jest.fn().mockResolvedValue(resp) }),
            );
        const alvo = { filCod: 2, docCod: 18347, fisCod: 1, prdCod: 41978, dprCodSeq: 1 };
        await expect(client('DESCR CRUA').preDescricaoProdutoNf(alvo)).resolves.toBe('DESCR CRUA');
        await expect(
            client({ responseData: 'DO ENVELOPE' }).preDescricaoProdutoNf(alvo),
        ).resolves.toBe('DO ENVELOPE');
        await expect(
            client({ responseData: { dprLngDescrNf: 'DO OBJETO' } }).preDescricaoProdutoNf(alvo),
        ).resolves.toBe('DO OBJETO');
        // vazio ⇒ undefined (é justamente o caso do cadastro "Descrição DI")
        await expect(
            client({ dprLngDescrNf: '  ' }).preDescricaoProdutoNf(alvo),
        ).resolves.toBeUndefined();
        // erro de transporte ⇒ undefined, jamais throw (é só uma sugestão)
        const explode = new ConexosNdeFiscalClient(
            buildBase({ getGeneric: jest.fn().mockRejectedValue(new Error('500')) }),
        );
        await expect(explode.preDescricaoProdutoNf(alvo)).resolves.toBeUndefined();
    });
});

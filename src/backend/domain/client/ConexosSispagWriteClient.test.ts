import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import type { ContaPagadora } from '../interface/sispag/Fin015Write.js';
import type ConexosBaseClient from './ConexosBaseClient.js';
import ConexosSispagWriteClient from './ConexosSispagWriteClient.js';

const buildBase = () => ({
    ensureSid: jest.fn().mockResolvedValue(undefined),
    postGenericOnce: jest.fn(),
    getGeneric: jest.fn(),
    listGenericPaginated: jest.fn(),
    runWithRetry: jest.fn(<T>(fn: () => Promise<T>) => fn()),
});
const make = (base: ReturnType<typeof buildBase>) =>
    new ConexosSispagWriteClient(base as unknown as ConexosBaseClient);

const ITAU: ContaPagadora = {
    bncCod: 4,
    bncNumCodbanco: 341,
    ccoCod: 1,
    ccoNumConta: 55795,
    ccoEspDvconta: '4',
    ccoEspAgcod: '0641',
    conta: '55795-4',
    layoutConta: 'AG:0641/CT:55795-4',
};

/** Erro axios-shaped com corpo de validação do Conexos. */
const validationError = (body: unknown) => ({ response: { status: 400, data: body } });

describe('ConexosSispagWriteClient (fin015 write toolbox)', () => {
    describe('criarLote', () => {
        it('usa postGenericOnce (não-idempotente) e devolve o flpCod', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({ flpCod: 18 });
            const res = await make(base).criarLote({ filCod: 1, conta: ITAU, dataDebito: 123 });
            expect(res).toEqual({ flpCod: 18, filCod: 1, bncCod: 4 });
            // NÃO usa o post com retry
            const [endpoint, body] = base.postGenericOnce.mock.calls[0];
            expect(endpoint).toBe('fin015');
            expect(body).toMatchObject({
                filCod: 1,
                bncCod: 4,
                conta: '55795-4',
                layoutConta: 'AG:0641/CT:55795-4',
                flpDtaCredito: 123,
                flpVldStatus: 0,
            });
        });

        it('desembrulha a resposta em .data quando o ERP embrulha', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({ data: { flpCod: 42 } });
            expect(
                (await make(base).criarLote({ filCod: 1, conta: ITAU, dataDebito: 1 })).flpCod,
            ).toBe(42);
        });

        it('sem flpCod válido → ConexosError (não cria lote fantasma)', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({ message: 'ok mas sem id' });
            await expect(
                make(base).criarLote({ filCod: 1, conta: ITAU, dataDebito: 1 }),
            ).rejects.toBeInstanceOf(ConexosError);
        });
    });

    describe('importarTitulos', () => {
        // Shape provado ao vivo em HML (2026-08-20, flp 26): os campos de SELEÇÃO precisam
        // ir no nível da requisição E dentro de cada item. Só num dos dois → SELECTION_ERROR.
        it('repete os campos de seleção nos DOIS níveis e usa postGenericOnce', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({ valid: 'SUCESSO' });
            const item = { docCod: 520, titCod: 1, filCod: 2, filCodLote: 1, bncCod: 4, flpCod: 18 };
            await make(base).importarTitulos({ filCod: 1, bncCod: 4, flpCod: 18, itens: [item] });
            const [endpoint, body] = base.postGenericOnce.mock.calls[0];
            expect(endpoint).toBe('fin015/finItemSispag/titulosPendentes/importar');
            expect(body).toEqual({
                items: [
                    {
                        ...item,
                        op: 1,
                        bncCodFin015: 4,
                        titVldReflexoDdaAssoc: 0,
                        titVldReflexoDdaDesassoc: 0,
                    },
                ],
                op: 1,
                bncCodFin015: 4,
                titVldReflexoDdaAssoc: 0,
                titVldReflexoDdaDesassoc: 0,
            });
        });

        it('preserva a identidade do item verbatim (filCod do TÍTULO ≠ filCodLote)', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});
            // O grid de pendentes cruza filiais: forçar filCod = filial do lote devolve
            // `Not Found: FinTituloPag`. O client não pode reescrever a chave.
            const item = { docCod: 813, titCod: 1, filCod: 2, filCodLote: 1 };
            await make(base).importarTitulos({ filCod: 1, bncCod: 4, flpCod: 26, itens: [item] });
            const body = base.postGenericOnce.mock.calls[0][1] as {
                items: Array<Record<string, unknown>>;
            };
            expect(body.items[0].filCod).toBe(2);
            expect(body.items[0].filCodLote).toBe(1);
        });

        it('op é parametrizável', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});
            await make(base).importarTitulos({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                itens: [{ docCod: 1 }],
                op: 2,
            });
            const body = base.postGenericOnce.mock.calls[0][1] as { op: number };
            expect(body.op).toBe(2);
        });
    });

    describe('finalizarLote', () => {
        it('é um GET; sucesso não lança', async () => {
            const base = buildBase();
            base.getGeneric.mockResolvedValue({ valid: 'SUCESSO' });
            await expect(
                make(base).finalizarLote({ filCod: 1, bncCod: 4, flpCod: 18 }),
            ).resolves.toBeUndefined();
            expect(base.getGeneric.mock.calls[0][0]).toBe('fin015/finalizarLote/1/4/18');
        });

        it('R1/R2 (VALIDATION_LIST) → ConexosError com a msg do ERP no message', async () => {
            const base = buildBase();
            base.getGeneric.mockRejectedValue(
                validationError({
                    type: 'VALIDATION_LIST',
                    messages: [
                        { vars: { msg: 'A DATA DE DÉBITO NÃO PODE SER MENOR QUE A DATA DE HOJE' } },
                    ],
                }),
            );
            await expect(
                make(base).finalizarLote({ filCod: 1, bncCod: 4, flpCod: 18 }),
            ).rejects.toMatchObject({
                message: expect.stringContaining('DATA DE DÉBITO'),
            });
        });
    });

    describe('gerarRemessa', () => {
        // O ERP sinaliza falha com 400 (→ ConexosError). Um retorno 200 É o sucesso, mesmo
        // SEM `valid: 'SUCESSO'` no corpo — foi o caso da geração provada em HML
        // (2026-08-20, flp 26 → PG200893.REM), que o parse antigo marcava como falha.
        it('200 sem campo `valid` ainda é sucesso (regressão do parse antigo)', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});
            const res = await make(base).gerarRemessa({
                filCod: 1,
                bncCod: 4,
                flpCod: 26,
                grbCodSeq: 1,
                seqNum: 93,
                gabEspNomeArquivo: 'PG200893.REM',
            });
            expect(res.sucesso).toBe(true);
        });

        it('usa postGenericOnce e marca sucesso em SUCESSO', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({
                valid: 'SUCESSO',
                message: 'Generic.PROCEDIMENTO_SUCESSO',
            });
            const res = await make(base).gerarRemessa({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                grbCodSeq: 1,
                seqNum: 77,
                gabEspNomeArquivo: 'PG090777.REM',
            });
            expect(res.sucesso).toBe(true);
            const [endpoint, body] = base.postGenericOnce.mock.calls[0];
            expect(endpoint).toBe('fin015/gerArquivosBancos/gerarRemessa');
            expect(body).toEqual({
                filCodLote: 1,
                bncCod: 4,
                flpCod: 18,
                grbCodSeq: 1,
                seqNum: 77,
                gabEspNomeArquivo: 'PG090777.REM',
            });
        });

        it('campo faltante (VALIDATION) → ConexosError listando o campo', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue(
                validationError({
                    type: 'VALIDATION',
                    itemMessages: [{ item: 'seqNum', messages: [{ constraint: 'required' }] }],
                }),
            );
            await expect(
                make(base).gerarRemessa({
                    filCod: 1,
                    bncCod: 4,
                    flpCod: 18,
                    grbCodSeq: 1,
                    seqNum: 0,
                    gabEspNomeArquivo: 'x.REM',
                }),
            ).rejects.toMatchObject({ message: expect.stringContaining('seqNum') });
        });
    });

    describe('leituras (via runWithRetry)', () => {
        it('listarTitulosPendentes mapeia as linhas e passa pelo runWithRetry', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [
                    {
                        filCod: 1,
                        docCod: 520,
                        titCod: 1,
                        itsVldModalidade: 7,
                        itsMnyValor: 1000,
                        itsEspNomeFav: 'DC LOGISTICS',
                    },
                ],
            });
            const pend = await make(base).listarTitulosPendentes({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
            });
            expect(base.runWithRetry).toHaveBeenCalledTimes(1);
            expect(pend[0]).toMatchObject({
                docCod: '520',
                titCod: '1',
                itsVldModalidade: 7,
                valor: 1000,
                favorecido: 'DC LOGISTICS',
            });
            expect(pend[0].raw).toBeDefined();
            expect(base.listGenericPaginated.mock.calls[0][0]).toBe(
                'fin015/finItemSispag/titulosPendentes/list/1/4/18',
            );
        });

        it('listarArquivosRemessa expõe o .REM em conteudo (gabLngDados)', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({
                count: 1,
                rows: [
                    {
                        gabCod: 17,
                        gabEspNomeArquivo: 'PG171101.REM',
                        gabLngDados: '34100000COLUMBIA...',
                    },
                ],
            });
            const arqs = await make(base).listarArquivosRemessa({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
            });
            expect(arqs[0]).toMatchObject({
                gabCod: 17,
                nomeArquivo: 'PG171101.REM',
                conteudo: '34100000COLUMBIA...',
            });
        });

        it('baixarRemessa devolve o conteúdo como string', async () => {
            const base = buildBase();
            base.getGeneric.mockResolvedValue('34100000...REM-CONTENT');
            expect(await make(base).baixarRemessa({ filCod: 1, gabCod: 17 })).toBe(
                '34100000...REM-CONTENT',
            );
        });
    });
    describe('listarTitulosPendentes — paginação (performance-3)', () => {
        /** Grid falso: `total` linhas, servidas em páginas de `pageSize`. */
        const gridDe = (total: number) => (_path: string, body: Record<string, unknown>) => {
            const pageSize = Number(body.pageSize);
            const pageNumber = Number(body.pageNumber);
            const inicio = (pageNumber - 1) * pageSize;
            const rows = Array.from({ length: Math.max(0, Math.min(pageSize, total - inicio)) }, (_, i) => ({
                filCod: 1,
                docCod: inicio + i + 1,
                titCod: 1,
            }));
            return Promise.resolve({ count: total, rows });
        };

        it('varre TODAS as páginas até esgotar o grid', async () => {
            // A filial 2 tem ~2020 pendentes. A versão anterior via 500 e chamava o resto
            // de "não elegível" — com o lote nativo já criado e órfão.
            const base = buildBase();
            base.listGenericPaginated.mockImplementation(gridDe(2020));

            const pend = await make(base).listarTitulosPendentes({
                filCod: 2,
                bncCod: 4,
                flpCod: 30,
                pageSize: 500,
            });

            expect(pend).toHaveLength(2020);
            expect(base.listGenericPaginated).toHaveBeenCalledTimes(5);
        });

        it('para assim que encontra todas as chaves pedidas', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockImplementation(gridDe(2020));

            const pend = await make(base).listarTitulosPendentes({
                filCod: 2,
                bncCod: 4,
                flpCod: 30,
                pageSize: 500,
                chavesDesejadas: new Set(['3:1', '7:1']),
            });

            // Ambas estão na primeira página — não faz sentido puxar as outras quatro.
            expect(base.listGenericPaginated).toHaveBeenCalledTimes(1);
            expect(pend).toHaveLength(500);
        });

        it('NÃO para na primeira página quando falta uma chave', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockImplementation(gridDe(2020));

            await make(base).listarTitulosPendentes({
                filCod: 2,
                bncCod: 4,
                flpCod: 30,
                pageSize: 500,
                // 1600 só aparece na 4ª página — era exatamente o falso negativo.
                chavesDesejadas: new Set(['3:1', '1600:1']),
            });

            expect(base.listGenericPaginated).toHaveBeenCalledTimes(4);
        });

        it('avisa em vez de truncar calado quando bate o guarda de páginas', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockImplementation(gridDe(10_000));
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

            const pend = await make(base).listarTitulosPendentes({
                filCod: 2,
                bncCod: 4,
                flpCod: 30,
                pageSize: 500,
                maxPaginas: 2,
            });

            expect(pend).toHaveLength(1000);
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('truncado em 2 páginas'));
            warn.mockRestore();
        });

        it('uma página curta encerra a varredura (grid menor que o pageSize)', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockImplementation(gridDe(12));

            const pend = await make(base).listarTitulosPendentes({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                pageSize: 500,
            });

            expect(pend).toHaveLength(12);
            expect(base.listGenericPaginated).toHaveBeenCalledTimes(1);
        });
    });

    describe('importarTitulos — UM item por chamada', () => {
        /**
         * Medido em HML (2026-08-25): dois itens no mesmo `items[]` devolvem
         * `400 SELECTION_ERROR` com um `Generic.MODEL_INCONSISTENCY` POR ITEM. Os mesmos
         * dois, um por chamada, entram e ambos ficam no lote.
         *
         * A validação original passou porque foi feita com UM título. Qualquer lote com 2+,
         * que é o caso normal, quebrava — e quebrava no caminho NORMAL, não só na retomada.
         */
        const item = (docCod: number) => ({ filCod: 2, docCod, titCod: 1 });

        it('quebra o lote em uma chamada por item', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});

            await make(base).importarTitulos({
                filCod: 2,
                bncCod: 4,
                flpCod: 30,
                itens: [item(801), item(802), item(803)],
            });

            expect(base.postGenericOnce).toHaveBeenCalledTimes(3);
            for (const chamada of base.postGenericOnce.mock.calls) {
                expect((chamada[1] as { items: unknown[] }).items).toHaveLength(1);
            }
        });

        it('um item só continua sendo uma chamada só', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});

            await make(base).importarTitulos({
                filCod: 2,
                bncCod: 4,
                flpCod: 30,
                itens: [item(801)],
            });

            expect(base.postGenericOnce).toHaveBeenCalledTimes(1);
        });

        it('cada chamada leva os 4 campos de seleção nos DOIS níveis', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});

            await make(base).importarTitulos({
                filCod: 2,
                bncCod: 4,
                flpCod: 30,
                itens: [item(801), item(802)],
            });

            for (const chamada of base.postGenericOnce.mock.calls) {
                const body = chamada[1] as Record<string, unknown> & { items: Array<Record<string, unknown>> };
                expect(body).toMatchObject({ op: 1, bncCodFin015: 4 });
                expect(body.items[0]).toMatchObject({ op: 1, bncCodFin015: 4 });
            }
        });

        it('falha no meio PROPAGA — a retomada trata o import parcial', async () => {
            // Não é atômico e não finge ser: o item 1 entrou, o 2 falhou. Engolir aqui
            // deixaria o lote incompleto e "bem-sucedido".
            const base = buildBase();
            base.postGenericOnce
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(validationError({ type: 'SELECTION_ERROR' }));

            await expect(
                make(base).importarTitulos({
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 30,
                    itens: [item(801), item(802)],
                }),
            ).rejects.toBeInstanceOf(ConexosError);
            expect(base.postGenericOnce).toHaveBeenCalledTimes(2);
        });
    });

});

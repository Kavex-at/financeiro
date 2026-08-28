import 'reflect-metadata';
import ConexosError from '../errors/ConexosError.js';
import ErpPerguntaError from '../errors/ErpPerguntaError.js';
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
const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    }) as unknown as import('../service/LogService.js').default;

const make = (base: ReturnType<typeof buildBase>, log = buildLog()) =>
    new ConexosSispagWriteClient(base as unknown as ConexosBaseClient, log);

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
            const item = {
                docCod: 520,
                titCod: 1,
                filCod: 2,
                filCodLote: 1,
                bncCod: 4,
                flpCod: 18,
            };
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

    describe('boleto DDA (titVldReflexoDdaAssoc + resposta à pergunta do ERP)', () => {
        const item = { filCod: 1, docCod: 520, titCod: 1 };
        const perguntaBarcode = validationError({
            type: 'QUESTION',
            questions: [
                {
                    id: '1',
                    key: 'FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO',
                    answerList: [
                        { id: 'YES', key: 'YES', type: 'SIMPLE' },
                        { id: 'NO', key: 'NO', type: 'SIMPLE' },
                    ],
                },
            ],
        });

        it('sem associarDda mantém o payload histórico (assoc = 0)', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});
            await make(base).importarTitulos({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                itens: [item],
            });
            const [, body] = base.postGenericOnce.mock.calls[0];
            expect(body).toMatchObject({ titVldReflexoDdaAssoc: 0, titVldReflexoDdaDesassoc: 0 });
            expect((body as { items: unknown[] }).items[0]).toMatchObject({
                titVldReflexoDdaAssoc: 0,
            });
            expect(base.postGenericOnce).toHaveBeenCalledTimes(1);
        });

        it('associarDda manda 1 nos DOIS níveis que a seleção do ERP exige', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});
            await make(base).importarTitulos({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                itens: [item],
                associarDda: true,
            });
            const [, body] = base.postGenericOnce.mock.calls[0];
            expect(body).toMatchObject({ titVldReflexoDdaAssoc: 1 });
            expect((body as { items: unknown[] }).items[0]).toMatchObject({
                titVldReflexoDdaAssoc: 1,
            });
        });

        it('responde YES à pergunta do barcode e reenvia o MESMO body (answers por id)', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValueOnce(perguntaBarcode).mockResolvedValueOnce({});
            await make(base).importarTitulos({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                itens: [item],
                associarDda: true,
            });
            expect(base.postGenericOnce).toHaveBeenCalledTimes(2);
            const [, primeiro] = base.postGenericOnce.mock.calls[0];
            const [, segundo] = base.postGenericOnce.mock.calls[1];
            // `answers` é um MAP chaveado pelo `id` da pergunta — não pelo `key`, não um array.
            expect(segundo).toMatchObject({ answers: { '1': 'YES' } });
            // e o resto do body vai VERBATIM (a identidade do item não pode ser reescrita)
            expect((segundo as { items: unknown[] }).items).toEqual(
                (primeiro as { items: unknown[] }).items,
            );
        });

        it('registra a auto-resposta em log (auditoria da escrita automatizada)', async () => {
            // Decisão automatizada num fluxo que move dinheiro precisa ser provável depois.
            const base = buildBase();
            const log = buildLog();
            base.postGenericOnce.mockRejectedValueOnce(perguntaBarcode).mockResolvedValueOnce({});
            await make(base, log).importarTitulos({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                itens: [item],
                associarDda: true,
            });
            expect(log.info).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('auto-respondida'),
                    data: expect.objectContaining({
                        questionId: '1',
                        pergunta: 'FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO',
                        flpCod: 18,
                    }),
                }),
            );
        });

        it('NÃO loga auto-resposta quando não houve pergunta', async () => {
            const base = buildBase();
            const log = buildLog();
            base.postGenericOnce.mockResolvedValue({});
            await make(base, log).importarTitulos({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                itens: [item],
                associarDda: true,
            });
            expect(log.info).not.toHaveBeenCalled();
        });

        it('pergunta FORA da allowlist → ErpPerguntaError, sem segundo POST', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue(
                validationError({
                    type: 'QUESTION',
                    questions: [
                        {
                            id: '1',
                            key: 'FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA_TITULO_PROPRIO',
                        },
                    ],
                }),
            );
            await expect(
                make(base).importarTitulos({
                    filCod: 1,
                    bncCod: 4,
                    flpCod: 18,
                    itens: [item],
                    associarDda: true,
                }),
            ).rejects.toBeInstanceOf(ErpPerguntaError);
            expect(base.postGenericOnce).toHaveBeenCalledTimes(1);
        });

        it('envelope com 2 perguntas não é auto-respondível, mesmo contendo a allowlistada', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue(
                validationError({
                    type: 'QUESTION',
                    questions: [
                        { id: '1', key: 'FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO' },
                        { id: '2', key: 'FIN_041.OUTRA_COISA_QUALQUER' },
                    ],
                }),
            );
            await expect(
                make(base).importarTitulos({
                    filCod: 1,
                    bncCod: 4,
                    flpCod: 18,
                    itens: [item],
                    associarDda: true,
                }),
            ).rejects.toBeInstanceOf(ErpPerguntaError);
            expect(base.postGenericOnce).toHaveBeenCalledTimes(1);
        });

        it('pergunta repetida após a resposta NÃO vira laço — falha na segunda', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue(perguntaBarcode);
            await expect(
                make(base).importarTitulos({
                    filCod: 1,
                    bncCod: 4,
                    flpCod: 18,
                    itens: [item],
                    associarDda: true,
                }),
            ).rejects.toBeInstanceOf(ErpPerguntaError);
            expect(base.postGenericOnce).toHaveBeenCalledTimes(2);
        });

        it('propaga associarDda na quebra de 1-item-por-chamada', async () => {
            const base = buildBase();
            base.postGenericOnce.mockResolvedValue({});
            await make(base).importarTitulos({
                filCod: 1,
                bncCod: 4,
                flpCod: 18,
                itens: [item, { ...item, docCod: 521 }],
                associarDda: true,
            });
            expect(base.postGenericOnce).toHaveBeenCalledTimes(2);
            for (const [, body] of base.postGenericOnce.mock.calls) {
                expect(body).toMatchObject({ titVldReflexoDdaAssoc: 1 });
                expect((body as { items: unknown[] }).items).toHaveLength(1);
            }
        });
    });

    describe('listarTitulosComBoletoDda', () => {
        it('usa o lote nativo mais recente como contexto e devolve só quem tem o flag', async () => {
            const base = buildBase();
            base.listGenericPaginated
                // 1ª chamada: fin015/list (lotes) — o maior flpCod vira contexto
                .mockResolvedValueOnce({
                    count: 2,
                    rows: [
                        { flpCod: 3, filCod: 1, bncCod: 4 },
                        { flpCod: 9, filCod: 1, bncCod: 4 },
                    ],
                })
                // 2ª: o grid de pendentes daquele contexto
                .mockResolvedValueOnce({
                    count: 2,
                    rows: [
                        { filCod: 1, docCod: 100, titCod: 1, titVldReflexoDdaAssoc: 1 },
                        { filCod: 1, docCod: 200, titCod: 1, titVldReflexoDdaAssoc: 0 },
                    ],
                });
            const set = await make(base).listarTitulosComBoletoDda({ filCod: 1, bncCod: 4 });
            expect(set).toEqual(new Set(['1:100:1']));
            expect(base.listGenericPaginated.mock.calls[1][0]).toBe(
                'fin015/finItemSispag/titulosPendentes/list/1/4/9',
            );
        });

        it('filial sem lote nativo → conjunto vazio, sem ler o grid', async () => {
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValueOnce({ count: 0, rows: [] });
            const set = await make(base).listarTitulosComBoletoDda({ filCod: 6, bncCod: 4 });
            expect(set.size).toBe(0);
            expect(base.listGenericPaginated).toHaveBeenCalledTimes(1);
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
                // sem `titVldReflexoDdaAssoc` na linha = sem boleto DDA
                temBoletoDda: false,
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
            const rows = Array.from(
                { length: Math.max(0, Math.min(pageSize, total - inicio)) },
                (_, i) => ({
                    filCod: 2,
                    docCod: inicio + i + 1,
                    titCod: 1,
                }),
            );
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
                chavesDesejadas: new Set(['2:3:1', '2:7:1']),
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
                chavesDesejadas: new Set(['2:3:1', '2:1600:1']),
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
                const body = chamada[1] as Record<string, unknown> & {
                    items: Array<Record<string, unknown>>;
                };
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

    describe('listarLotesNativos — filtra por FILIAL', () => {
        it('manda filCod#EQ no filterList, não só no contexto', async () => {
            // O `filCod` de `opts` é o contexto da sessão, não um filtro. Sem `filCod#EQ`
            // o ERP devolve lotes de todas as filiais — medido: 74 linhas das filiais
            // 1, 2 e 7 numa consulta que deveria trazer 30.
            const base = buildBase();
            base.listGenericPaginated.mockResolvedValue({ count: 0, rows: [] });

            await make(base).listarLotesNativos({ filCod: 2, bncCod: 4 });

            const [, body] = base.listGenericPaginated.mock.calls[0];
            expect((body as { filterList: Record<string, unknown> }).filterList).toEqual({
                'bncCod#EQ': 4,
                'filCod#EQ': 2,
            });
        });
    });

    describe('protocolo QUESTION do ERP (regis: integrability-1)', () => {
        /** Resposta interativa do Conexos — não é falha, é pergunta. */
        const question = (key: string) => ({
            response: {
                status: 400,
                data: {
                    type: 'QUESTION',
                    questions: [
                        {
                            key,
                            parameterValueList: { bncDesNome: 'ITAÚ', pesCod: '14' },
                            answerList: [{ id: 'YES' }, { id: 'NO', type: 'ABORT' }],
                        },
                    ],
                },
            },
        });
        const FIN041 = 'FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO_MODALIDADE_ALTERADA';

        it('importarTitulos devolve ErpPerguntaError, não ConexosError genérico', async () => {
            // Antes: o ledger ia para `error`, a retomada refazia o mesmo caminho e falhava
            // igual. Do lado de quem opera, "o ERP quer confirmação" virava "sistema quebrou".
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue(question(FIN041));

            await expect(
                make(base).importarTitulos({
                    filCod: 2,
                    bncCod: 4,
                    flpCod: 30,
                    itens: [{ filCod: 2, docCod: 801, titCod: 1 }],
                }),
            ).rejects.toBeInstanceOf(ErpPerguntaError);
        });

        it('criarLote também — a detecção vale para TODA chamada do cliente', async () => {
            const base = buildBase();
            base.postGenericOnce.mockRejectedValue(question(FIN041));

            await expect(
                make(base).criarLote({ filCod: 2, conta: ITAU, dataDebito: 1_790_000_000_000 }),
            ).rejects.toBeInstanceOf(ErpPerguntaError);
        });

        it('a pergunta carrega chave e parâmetros para a tela poder explicar', async () => {
            // `finalizarLote` usa `getGeneric` (o endpoint é GET apesar de mutar) — a
            // detecção precisa valer para ele também, e vale porque mora no wrapper de erro.
            const base = buildBase();
            base.getGeneric.mockRejectedValue(question(FIN041));

            const erro = await make(base)
                .finalizarLote({ filCod: 2, bncCod: 4, flpCod: 30 })
                .catch((e: unknown) => e);

            expect(erro).toMatchObject({
                code: 'ERP_PERGUNTA',
                details: expect.objectContaining({ chave: FIN041 }),
            });
        });

        it('erro COMUM continua ConexosError — a detecção não engole falha de verdade', async () => {
            const base = buildBase();
            base.getGeneric.mockRejectedValue(
                validationError({ type: 'SELECTION_ERROR', validation: {} }),
            );

            await expect(
                make(base).finalizarLote({ filCod: 2, bncCod: 4, flpCod: 30 }),
            ).rejects.toBeInstanceOf(ConexosError);
        });
    });
});

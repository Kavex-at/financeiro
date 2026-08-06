import 'reflect-metadata';
import BorderoGestaoService from './BorderoGestaoService.js';

const row = (over: Partial<Record<string, unknown>> = {}) => ({
    idempotencyKey: 'k',
    adiantamentoDocCod: '9027',
    invoiceDocCod: '18779',
    filCod: 2,
    status: 'settled',
    dryRun: false,
    borCod: 14699,
    bxaCodSeq: 1,
    valorBaixado: 99.61,
    juros: 6.16,
    contaJuros: 131,
    executadoPor: 'yuri',
    criadoEm: new Date('2026-06-23T19:39:17Z'),
    atualizadoEm: new Date('2026-06-23T19:39:17Z'),
    ...over,
});

const build = (getBorderoImpl: jest.Mock) => {
    const conexosClient = {
        getBordero: getBorderoImpl,
        listBorderos: jest.fn().mockResolvedValue([]),
        listBaixas: jest.fn().mockResolvedValue([]),
        listFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }]),
        excluirBaixa: jest.fn(),
        excluirBordero: jest.fn(),
        finalizarBordero: jest.fn(),
        cancelarBordero: jest.fn(),
        estornarBordero: jest.fn(),
    };
    const environmentProvider = {
        getEnvironmentVars: jest
            .fn()
            .mockResolvedValue({ conexosWriteEnabled: true, conexosFilCod: 2 }),
    };
    const execucaoRepository = {
        listComBordero: jest.fn(),
        findByBorCodInvoice: jest.fn(),
        deleteByBorCodInvoice: jest.fn().mockResolvedValue(1),
        countByBorCod: jest.fn().mockResolvedValue(1),
        listByBorCod: jest.fn(),
        deleteByBorCod: jest.fn().mockResolvedValue(1),
        listBorderoCache: jest.fn().mockResolvedValue([]),
        replaceBorderoCache: jest.fn().mockResolvedValue(undefined),
        updateBorderoCacheSituacao: jest.fn().mockResolvedValue(1),
        deleteBorderoCache: jest.fn().mockResolvedValue(1),
    };
    const logService = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new BorderoGestaoService(
        conexosClient as never, // ConexosBaixaClient (fin010)
        conexosClient as never, // ConexosCadastroClient (listFiliais)
        environmentProvider as never,
        execucaoRepository as never,
        logService as never,
    );
    return { service, conexosClient, environmentProvider, execucaoRepository };
};

describe('BorderoGestaoService', () => {
    it('lista do CACHE, enriquece baixas da trilha e soma o total', async () => {
        const { service, execucaoRepository } = build(jest.fn());
        execucaoRepository.listBorderoCache.mockResolvedValue([
            { borCod: 14699, filCod: 2, borVldFinalizado: 1, borCodEstornado: null },
        ]);
        execucaoRepository.listComBordero.mockResolvedValue([
            row({ borCod: 14699, invoiceDocCod: '18779', valorBaixado: 99.61 }),
            row({ borCod: 14699, invoiceDocCod: '18780', valorBaixado: 99.61 }),
        ]);

        const out = await service.listarBorderos();

        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            borCod: 14699,
            filCod: 2,
            situacao: 'FINALIZADO',
            finalizado: true,
            estornado: false,
            totalBaixado: 199.22,
        });
        expect(out[0].baixas).toHaveLength(2);
    });

    it('situação: finalizado / cancelado / estornado (borCodEstornado → ESTORNADO)', async () => {
        const { service, execucaoRepository } = build(jest.fn());
        execucaoRepository.listBorderoCache.mockResolvedValue([
            { borCod: 14699, filCod: 2, borVldFinalizado: 1, borCodEstornado: null }, // finalizado
            { borCod: 14676, filCod: 2, borVldFinalizado: 2, borCodEstornado: null }, // cancelado
            { borCod: 14674, filCod: 2, borVldFinalizado: 0, borCodEstornado: 555 }, // estornado
        ]);
        execucaoRepository.listComBordero.mockResolvedValue([]);

        const out = await service.listarBorderos();
        const byCod = Object.fromEntries(out.map((b) => [b.borCod, b.situacao]));
        expect(byCod[14699]).toBe('FINALIZADO');
        expect(byCod[14676]).toBe('CANCELADO');
        expect(byCod[14674]).toBe('ESTORNADO'); // beco sem saída → permuta liberada p/ re-lançar
        // ordenado por borCod desc
        expect(out.map((b) => b.borCod)).toEqual([14699, 14676, 14674]);
    });

    it('mostra borderô CANCELADO mesmo SEM trilha local (divergência)', async () => {
        const { service, execucaoRepository } = build(jest.fn());
        execucaoRepository.listBorderoCache.mockResolvedValue([
            {
                borCod: 14707,
                filCod: 2,
                borVldFinalizado: 2,
                borCodEstornado: null,
                vlrTotalLiquido: 199.22,
            },
        ]);
        execucaoRepository.listComBordero.mockResolvedValue([]); // trilha apagada

        const out = await service.listarBorderos();

        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({
            borCod: 14707,
            situacao: 'CANCELADO',
            totalBaixado: 199.22,
        });
        expect(out[0].baixas).toHaveLength(0);
    });

    it('best-effort: falha ao listar no ERP → lista vazia (não quebra)', async () => {
        const { service, conexosClient, execucaoRepository } = build(jest.fn());
        conexosClient.listBorderos.mockRejectedValue(new Error('ERP down'));
        execucaoRepository.listComBordero.mockResolvedValue([row({ borCod: 14699 })]);

        const out = await service.listarBorderos();

        expect(out).toEqual([]);
    });

    it('live=true → refresca o cache (busca filiais no ERP e regrava)', async () => {
        const { service, conexosClient, execucaoRepository } = build(jest.fn());
        conexosClient.listFiliais.mockResolvedValue([{ filCod: 2 }, { filCod: 4 }]);
        conexosClient.listBorderos.mockResolvedValue([
            { borCod: 14709, filCod: 2, borVldFinalizado: 0, borCodEstornado: null },
        ]);
        execucaoRepository.listComBordero.mockResolvedValue([]);

        await service.listarBorderos({ live: true });

        expect(conexosClient.listFiliais).toHaveBeenCalled();
        expect(execucaoRepository.replaceBorderoCache).toHaveBeenCalled();
    });

    it('resgata borderô da trilha fora do top-1000 (borCod#IN) e o inclui no cache', async () => {
        const { service, conexosClient, execucaoRepository } = build(jest.fn());
        conexosClient.listFiliais.mockResolvedValue([{ filCod: 2 }]);
        // Bulk (sem borCods) → só o recente 16884; o 15593 da trilha caiu fora da janela.
        // Resgate (com borCods) → devolve o 15593.
        conexosClient.listBorderos.mockImplementation((p: { borCods?: number[] }) =>
            Promise.resolve(
                p.borCods
                    ? [{ borCod: 15593, filCod: 2, borVldFinalizado: 1, borCodEstornado: null }]
                    : [{ borCod: 16884, filCod: 2, borVldFinalizado: 0, borCodEstornado: null }],
            ),
        );
        execucaoRepository.listComBordero.mockResolvedValue([row({ borCod: 15593, filCod: 2 })]);

        await service.listarBorderos({ live: true });

        // Buscou os faltantes da trilha por borCod#IN.
        expect(conexosClient.listBorderos).toHaveBeenCalledWith(
            expect.objectContaining({ filCod: 2, borCods: [15593] }),
        );
        // Cache regravado com o recente + o resgatado.
        const cacheArg = execucaoRepository.replaceBorderoCache.mock.calls[0][0] as Array<{
            borCod: number;
        }>;
        expect(cacheArg.map((c) => c.borCod).sort((a, b) => a - b)).toEqual([15593, 16884]);
    });

    it('listarBaixasErp mapeia as baixas do ERP (invoice + valor líquido)', async () => {
        const { service, conexosClient } = build(jest.fn());
        conexosClient.listBaixas.mockResolvedValue([
            { docCod: 18779, bxaCodSeq: 1, bxaMnyLiquidoPermuta: 99.61 },
        ]);

        const out = await service.listarBaixasErp({ borCod: 14709, filCod: 2 });

        expect(out).toEqual([{ invoiceDocCod: '18779', bxaCodSeq: 1, valorLiquido: 99.61 }]);
    });

    describe('statusPorAdiantamento', () => {
        it('settled + borderô EM CADASTRO → aguardando-finalizacao; FINALIZADO → finalizado; CANCELADO → omitido', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.listComBordero.mockResolvedValue([
                row({ adiantamentoDocCod: '9026', borCod: 14735, status: 'settled', filCod: 2 }),
                row({ adiantamentoDocCod: '9027', borCod: 14736, status: 'settled', filCod: 2 }),
                row({ adiantamentoDocCod: '9028', borCod: 14737, status: 'settled', filCod: 2 }),
            ]);
            conexosClient.listBorderos.mockResolvedValue([
                { borCod: 14735, filCod: 2, borVldFinalizado: 1, borCodEstornado: null }, // finalizado
                { borCod: 14736, filCod: 2, borVldFinalizado: 0, borCodEstornado: null }, // em cadastro
                { borCod: 14737, filCod: 2, borVldFinalizado: 2, borCodEstornado: null }, // cancelado
            ]);

            const out = await service.statusPorAdiantamento();

            expect(out['9026']).toMatchObject({ borCod: 14735, permutaStatus: 'finalizado' });
            expect(out['9027']).toMatchObject({
                borCod: 14736,
                permutaStatus: 'aguardando-finalizacao',
            });
            expect(out['9028']).toBeUndefined(); // cancelado → permuta volta a pendente
        });

        it('adto com VÁRIOS borderôs (re-baixa): escolhe o válido mais recente, ignora o cancelado', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            // 9026 baixado 2x: 14735 (cancelado/estornado) e 14761 (em aberto, atual).
            execucaoRepository.listComBordero.mockResolvedValue([
                row({ adiantamentoDocCod: '9026', borCod: 14761, status: 'settled', filCod: 2 }),
                row({ adiantamentoDocCod: '9026', borCod: 14735, status: 'settled', filCod: 2 }),
            ]);
            conexosClient.listBorderos.mockResolvedValue([
                { borCod: 14735, filCod: 2, borVldFinalizado: 2, borCodEstornado: null }, // cancelado
                { borCod: 14761, filCod: 2, borVldFinalizado: 0, borCodEstornado: null }, // em aberto
            ]);

            const out = await service.statusPorAdiantamento();

            expect(out['9026']).toMatchObject({
                borCod: 14761,
                permutaStatus: 'aguardando-finalizacao',
            });
        });

        it('borderô ESTORNADO → permuta liberada (volta a pendente, sem vínculo)', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.listComBordero.mockResolvedValue([
                row({ adiantamentoDocCod: '9027', borCod: 14708, status: 'settled', filCod: 2 }),
            ]);
            conexosClient.listBorderos.mockResolvedValue([
                { borCod: 14708, filCod: 2, borVldFinalizado: 0, borCodEstornado: 999 }, // estornado
            ]);

            const out = await service.statusPorAdiantamento();

            expect(out['9027']).toBeUndefined(); // estornado → reabre p/ novo lançamento
        });

        it('sem execução settled → mapa vazio (sem chamar o ERP)', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.listComBordero.mockResolvedValue([
                row({ adiantamentoDocCod: '9026', borCod: undefined, status: 'error' }),
            ]);
            const out = await service.statusPorAdiantamento();
            expect(out).toEqual({});
            expect(conexosClient.listBorderos).not.toHaveBeenCalled();
        });
    });

    describe('excluirBaixa', () => {
        it('exclui no ERP (filCod/bxaCodSeq da trilha) e remove a linha local', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.findByBorCodInvoice.mockResolvedValue(
                row({ borCod: 14707, invoiceDocCod: '18780', filCod: 2, bxaCodSeq: 1 }),
            );

            const out = await service.excluirBaixa({
                borCod: 14707,
                invoiceDocCod: '18780',
                executadoPor: 'yuri',
            });

            expect(conexosClient.excluirBaixa).toHaveBeenCalledWith({
                filCod: 2,
                borCod: 14707,
                invoiceDocCod: 18780,
                titCod: 1,
                bxaCodSeq: 1,
            });
            expect(execucaoRepository.deleteByBorCodInvoice).toHaveBeenCalledWith(14707, '18780');
            expect(out).toMatchObject({ excluido: true });
        });

        it('apaga o borderô no ERP quando a baixa removida era a última (count=0)', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.findByBorCodInvoice.mockResolvedValue(
                row({ borCod: 14707, invoiceDocCod: '18780', filCod: 2, bxaCodSeq: 1 }),
            );
            execucaoRepository.countByBorCod.mockResolvedValue(0);

            const out = await service.excluirBaixa({
                borCod: 14707,
                invoiceDocCod: '18780',
                executadoPor: 'yuri',
            });

            expect(conexosClient.excluirBordero).toHaveBeenCalledWith({ filCod: 2, borCod: 14707 });
            expect(out).toMatchObject({ borderoExcluido: true });
        });

        it('NÃO apaga o borderô quando ainda há baixas (count>0)', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.findByBorCodInvoice.mockResolvedValue(
                row({ borCod: 14707, invoiceDocCod: '18780', filCod: 2, bxaCodSeq: 1 }),
            );
            execucaoRepository.countByBorCod.mockResolvedValue(1);

            const out = await service.excluirBaixa({
                borCod: 14707,
                invoiceDocCod: '18780',
                executadoPor: 'yuri',
            });

            expect(conexosClient.excluirBordero).not.toHaveBeenCalled();
            expect(out).toMatchObject({ borderoExcluido: false });
        });

        it('excluirBordero: enumera baixas do ERP, remove cada uma + o borderô e limpa a trilha', async () => {
            const { service, conexosClient, execucaoRepository } = build(
                jest.fn().mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null }),
            );
            // filCod vem da TRILHA (autorização server-side), não do request.
            execucaoRepository.listByBorCod.mockResolvedValue([row({ borCod: 14707, filCod: 2 })]);
            conexosClient.listBaixas.mockResolvedValue([
                { filCod: 2, docCod: 18779, titCod: 1, bxaCodSeq: 1 },
                { filCod: 2, docCod: 18780, titCod: 1, bxaCodSeq: 1 },
            ]);

            const out = await service.excluirBordero({ borCod: 14707, executadoPor: 'yuri' });

            expect(conexosClient.excluirBaixa).toHaveBeenCalledTimes(2);
            expect(conexosClient.excluirBordero).toHaveBeenCalledWith({ filCod: 2, borCod: 14707 });
            expect(execucaoRepository.deleteByBorCod).toHaveBeenCalledWith(14707);
            expect(out).toMatchObject({ excluido: true, baixasExcluidas: 2 });
        });

        it('AUTORIZAÇÃO: borderô FORA da trilha (de terceiro) → FORBIDDEN, nada é escrito', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.listByBorCod.mockResolvedValue([]); // sem trilha → não é nosso

            await expect(
                service.excluirBordero({ borCod: 14709, executadoPor: 'admin' }),
            ).rejects.toThrow(/FORBIDDEN/);
            expect(conexosClient.excluirBaixa).not.toHaveBeenCalled();
            expect(conexosClient.excluirBordero).not.toHaveBeenCalled();
        });

        it('AUTORIZAÇÃO: finalizar borderô de terceiro → FORBIDDEN', async () => {
            const { service, conexosClient, execucaoRepository } = build(jest.fn());
            execucaoRepository.listByBorCod.mockResolvedValue([]); // sem trilha

            await expect(
                service.finalizarBordero({ borCod: 14709, executadoPor: 'admin' }),
            ).rejects.toThrow(/FORBIDDEN/);
            expect(conexosClient.finalizarBordero).not.toHaveBeenCalled();
        });

        it('finalizarBordero: aprova no ERP quando em cadastro', async () => {
            const { service, conexosClient, execucaoRepository } = build(
                jest.fn().mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null }),
            );
            execucaoRepository.listByBorCod.mockResolvedValue([row({ borCod: 14707, filCod: 2 })]);
            conexosClient.listBaixas.mockResolvedValue([{ docCod: 18779, bxaCodSeq: 1 }]);

            const out = await service.finalizarBordero({ borCod: 14707, executadoPor: 'yuri' });

            expect(conexosClient.finalizarBordero).toHaveBeenCalledWith({
                filCod: 2,
                borCod: 14707,
            });
            expect(out).toMatchObject({ finalizado: true });
        });

        // I-Write-7 — regressão do borderô 18538 (2026-08-06): casco vazio deixado por uma baixa que
        // falhou depois de criar o borderô. O ERP recusava com "NÃO POSSUI ITENS" só APÓS o POST.
        it('finalizarBordero: borderô SEM baixa no ERP → recusa antes de chamar o ERP', async () => {
            const { service, conexosClient, execucaoRepository } = build(
                jest.fn().mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null }),
            );
            execucaoRepository.listByBorCod.mockResolvedValue([row({ borCod: 18538, filCod: 2 })]);
            conexosClient.listBaixas.mockResolvedValue([]); // casco vazio

            await expect(
                service.finalizarBordero({ borCod: 18538, executadoPor: 'simone' }),
            ).rejects.toThrow(/não possui baixas/i);
            expect(conexosClient.finalizarBordero).not.toHaveBeenCalled();
        });

        // A trilha guarda linhas `error` COM bor_cod — contá-las daria o casco como "cheio". O guard
        // lê o ERP, não a trilha: mesmo com trilha não-vazia, sem item no ERP não se aprova.
        it('finalizarBordero: trilha com linha `error` não conta como item do borderô', async () => {
            const { service, conexosClient, execucaoRepository } = build(
                jest.fn().mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null }),
            );
            execucaoRepository.listByBorCod.mockResolvedValue([
                row({ borCod: 18538, filCod: 2, status: 'error', bxaCodSeq: undefined }),
            ]);
            conexosClient.listBaixas.mockResolvedValue([]);

            await expect(
                service.finalizarBordero({ borCod: 18538, executadoPor: 'simone' }),
            ).rejects.toThrow(/não possui baixas/i);
            expect(conexosClient.finalizarBordero).not.toHaveBeenCalled();
        });

        it('cancelarBordero: cancela no ERP quando em cadastro', async () => {
            const { service, conexosClient, execucaoRepository } = build(
                jest.fn().mockResolvedValue({ borVldFinalizado: 0, borCodEstornado: null }),
            );
            execucaoRepository.listByBorCod.mockResolvedValue([row({ borCod: 14707, filCod: 2 })]);

            const out = await service.cancelarBordero({ borCod: 14707, executadoPor: 'yuri' });

            expect(conexosClient.cancelarBordero).toHaveBeenCalledWith({
                filCod: 2,
                borCod: 14707,
            });
            expect(out).toMatchObject({ cancelado: true });
        });

        it('estornarBordero: estorna no ERP quando finalizado', async () => {
            const { service, conexosClient, execucaoRepository } = build(
                jest.fn().mockResolvedValue({ borVldFinalizado: 1, borCodEstornado: null }),
            );
            execucaoRepository.listByBorCod.mockResolvedValue([row({ borCod: 14708, filCod: 2 })]);

            const out = await service.estornarBordero({ borCod: 14708, executadoPor: 'yuri' });

            expect(conexosClient.estornarBordero).toHaveBeenCalledWith({
                filCod: 2,
                borCod: 14708,
            });
            expect(out).toMatchObject({ estornado: true });
        });

        it('bloqueia quando a escrita está desabilitada', async () => {
            const { service, conexosClient, environmentProvider } = build(jest.fn());
            environmentProvider.getEnvironmentVars.mockResolvedValue({
                conexosWriteEnabled: false,
            });

            await expect(
                service.excluirBaixa({ borCod: 1, invoiceDocCod: '2', executadoPor: 'y' }),
            ).rejects.toThrow(/desabilitada/);
            expect(conexosClient.excluirBaixa).not.toHaveBeenCalled();
        });

        it('erro quando a baixa não está na trilha', async () => {
            const { service, execucaoRepository } = build(jest.fn());
            execucaoRepository.findByBorCodInvoice.mockResolvedValue(null);

            await expect(
                service.excluirBaixa({ borCod: 9, invoiceDocCod: '9', executadoPor: 'y' }),
            ).rejects.toThrow(/não encontrada/);
        });
    });
});

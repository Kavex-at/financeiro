import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

interface DbMock {
    selectMany: jest.Mock;
    selectFirst: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
}

const buildDb = (): DbMock & { withTransaction: jest.Mock } => {
    const db = {
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        withTransaction: jest.fn(),
    };
    // A transação roda sobre o MESMO mock: as asserções enxergam as queries de dentro dela.
    db.withTransaction.mockImplementation(async (fn: (tx: DbMock) => unknown) => fn(db));
    return db;
};

const header = (over: Record<string, unknown> = {}) => ({
    id: 'L1',
    fil_cod: 2,
    banco: null,
    conta: null,
    status: 'RASCUNHO',
    criado_por: 'u1',
    finalizado_por: null,
    finalizado_em: null,
    versao: 1,
    criado_em: new Date('2026-07-07T00:00:00Z'),
    ...over,
});

const itemRow = (over: Record<string, unknown> = {}) => ({
    lote_id: 'L1',
    fil_cod: 2,
    doc_cod: '100',
    tit_cod: '1',
    credor: 'ACME',
    valor: '1000.5',
    vencimento: new Date('2026-08-01T00:00:00Z'),
    incluido_por: 'u1',
    incluido_em: new Date('2026-07-07T12:00:00Z'),
    ...over,
});

const make = (db: DbMock) => {
    const pg = db as unknown as PostgreeDatabaseClient;
    return new LotePagamentoRepository(pg, new VerificacaoEventoRepository(pg));
};

describe('LotePagamentoRepository', () => {
    it('criarLote insere e devolve o lote com itens', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue(header());
        db.selectMany.mockResolvedValue([]);
        const lote = await make(db).criarLote({ filCod: 2, criadoPor: 'u1' });
        expect(db.insert).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO lote_pagamento'),
            expect.objectContaining({ filCod: 2, criadoPor: 'u1', banco: null, conta: null }),
        );
        expect(lote).toMatchObject({ id: 'L1', filCod: 2, status: 'RASCUNHO', itens: [] });
    });

    it('getLoteComItens mapeia header + itens (valor numérico, datas ISO/epoch)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue(
            header({ finalizado_por: 'u2', finalizado_em: new Date('2026-07-07T15:00:00Z') }),
        );
        db.selectMany.mockResolvedValue([itemRow()]);
        const lote = await make(db).getLoteComItens('L1');
        expect(lote?.finalizadoPor).toBe('u2');
        expect(lote?.itens[0]).toMatchObject({ docCod: '100', titCod: '1', valor: 1000.5 });
        expect(typeof lote?.itens[0].vencimento).toBe('number');
    });

    it('getLoteComItens devolve null quando o lote não existe', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue(null);
        expect(await make(db).getLoteComItens('X')).toBeNull();
    });

    it('listLotes agrupa itens por lote', async () => {
        const db = buildDb();
        db.selectMany
            .mockResolvedValueOnce([header({ id: 'L1' }), header({ id: 'L2' })])
            .mockResolvedValueOnce([
                itemRow({ lote_id: 'L1' }),
                itemRow({ lote_id: 'L1' }),
                itemRow({ lote_id: 'L2' }),
            ]);
        const lotes = await make(db).listLotes({ status: 'RASCUNHO' });
        expect(lotes).toHaveLength(2);
        expect(lotes[0].itens).toHaveLength(2);
        expect(lotes[1].itens).toHaveLength(1);
    });

    it('listLotes com zero lotes não busca itens', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([]);
        const lotes = await make(db).listLotes({});
        expect(lotes).toEqual([]);
        expect(db.selectMany).toHaveBeenCalledTimes(1);
    });

    it('loteRascunhoComTitulo devolve o loteId ou null (I3)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ lote_id: 'L9' });
        expect(
            await make(db).loteRascunhoComTitulo({ filCod: 2, docCod: '100', titCod: '1' }),
        ).toBe('L9');
        db.selectFirst.mockResolvedValueOnce(null);
        expect(
            await make(db).loteRascunhoComTitulo({ filCod: 2, docCod: '100', titCod: '1' }),
        ).toBeNull();
    });

    it('adicionarItem converte vencimento epoch→Date e usa ON CONFLICT', async () => {
        const db = buildDb();
        await make(db).adicionarItem({
            loteId: 'L1',
            filCod: 2,
            docCod: '100',
            titCod: '1',
            valor: 50,
            vencimento: 1_760_000_000_000,
            incluidoPor: 'u1',
        });
        const [sql, params] = db.insert.mock.calls[0];
        expect(sql).toContain('ON CONFLICT');
        expect((params as { vencimento: Date }).vencimento).toBeInstanceOf(Date);
    });

    it('listTitulosEmRascunho traz o lote e se ele é automático (ADR-0050)', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValue([
            { fil_cod: 2, doc_cod: '100', tit_cod: '1', lote_id: 'L1', automatico: true },
        ]);
        const r = await make(db).listTitulosEmRascunho();
        expect(db.selectMany.mock.calls[0][0]).toContain("WHERE l.status = 'RASCUNHO'");
        expect(r).toEqual([
            { filCod: 2, docCod: '100', titCod: '1', loteId: 'L1', automatico: true },
        ]);
    });

    it('removerItem devolve rowCount', async () => {
        const db = buildDb();
        db.update.mockResolvedValue(1);
        expect(
            await make(db).removerItem({ loteId: 'L1', filCod: 2, docCod: '100', titCod: '1' }),
        ).toBe(1);
    });

    it('contarItens converte o count', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue({ n: '3' });
        expect(await make(db).contarItens('L1')).toBe(3);
    });

    it('tocarLote incrementa versão', async () => {
        const db = buildDb();
        await make(db).tocarLote('L1');
        expect(db.update).toHaveBeenCalledWith(expect.stringContaining('versao = versao + 1'), {
            loteId: 'L1',
        });
    });

    it('transicionarStatus p/ FINALIZADO passa finalizadoPor', async () => {
        const db = buildDb();
        db.update.mockResolvedValue(1);
        const n = await make(db).transicionarStatus({
            id: 'L1',
            de: ['RASCUNHO'],
            para: 'FINALIZADO',
            versaoEsperada: 1,
            finalizadoPor: 'u1',
        });
        expect(n).toBe(1);
        const [, params] = db.update.mock.calls[0];
        expect(params).toMatchObject({
            para: 'FINALIZADO',
            finalizadoPor: 'u1',
            versaoEsperada: 1,
        });
    });

    describe('dataDebito (I8, ADR-0049)', () => {
        it('getLoteComItens lê data_debito como texto YYYY-MM-DD e devolve a string', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header({ data_debito: '2026-09-23' }));
            const lote = await make(db).getLoteComItens('L1');
            const [sql] = db.selectFirst.mock.calls[0];
            expect(sql).toContain("to_char(data_debito, 'YYYY-MM-DD') AS data_debito");
            expect(lote?.dataDebito).toBe('2026-09-23');
        });

        it('getLoteComItens com data_debito NULL não expõe a chave', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header({ data_debito: null }));
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.dataDebito).toBeUndefined();
            expect(lote).not.toHaveProperty('dataDebito');
        });

        it('listLotes também devolve dataDebito', async () => {
            const db = buildDb();
            db.selectMany
                .mockResolvedValueOnce([header({ id: 'L1', data_debito: '2026-09-24' })])
                .mockResolvedValueOnce([]);
            const lotes = await make(db).listLotes({});
            const [sql] = db.selectMany.mock.calls[0];
            expect(sql).toContain("to_char(data_debito, 'YYYY-MM-DD') AS data_debito");
            expect(lotes[0]?.dataDebito).toBe('2026-09-24');
        });

        it('listLotes devolve a remessa e as chaves nativas (o botão "Baixar remessa" depende disso)', async () => {
            // Causa-raiz do "não vi o download": a lista da aba Finalizados vinha sem
            // `remessa_arquivo`, então o card escondia o botão em toda carga de página.
            const db = buildDb();
            db.selectMany
                .mockResolvedValueOnce([
                    header({
                        id: 'L1',
                        status: 'REMESSA_GERADA',
                        native_fil_cod: 7,
                        native_bnc_cod: 341,
                        native_flp_cod: 26,
                        native_gab_cod: 46,
                        remessa_arquivo: 'PG200893.REM',
                        remessa_num: 93,
                        remessa_gerada_em: new Date('2026-10-06T13:30:00Z'),
                    }),
                ])
                .mockResolvedValueOnce([]);
            const lotes = await make(db).listLotes({});
            const [sql] = db.selectMany.mock.calls[0];
            expect(sql).toContain('remessa_arquivo');
            expect(sql).toContain('native_gab_cod');
            expect(lotes[0]).toMatchObject({
                nativeFilCod: 7,
                nativeBncCod: 341,
                nativeFlpCod: 26,
                nativeGabCod: 46,
                remessaArquivo: 'PG200893.REM',
                remessaNum: 93,
                remessaGeradaEm: '2026-10-06T13:30:00.000Z',
            });
        });

        it('listLotesPorIds filtra por id com parâmetro, sem interpolar', async () => {
            const db = buildDb();
            db.selectMany
                .mockResolvedValueOnce([header({ id: 'L1' })])
                .mockResolvedValueOnce([itemRow({ lote_id: 'L1' })]);
            const lotes = await make(db).listLotesPorIds(['L1', 'L2']);
            const [sql, params] = db.selectMany.mock.calls[0];
            expect(sql).toContain('id = ANY($ids)');
            expect(sql).not.toContain("'L1'");
            expect(params).toEqual({ ids: ['L1', 'L2'] });
            expect(lotes).toHaveLength(1);
            expect(lotes[0]?.itens).toHaveLength(1);
        });

        it('listLotesPorIds com lista vazia não consulta o banco', async () => {
            const db = buildDb();
            expect(await make(db).listLotesPorIds([])).toEqual([]);
            expect(db.selectMany).not.toHaveBeenCalled();
        });

        it('setDataDebito grava com parâmetros nomeados, sem interpolar a data', async () => {
            const db = buildDb();
            await make(db).setDataDebito({ loteId: 'L1', dataDebito: '2026-09-23' });
            const [sql, params] = db.update.mock.calls[0];
            expect(sql).toContain('data_debito = $dataDebito');
            expect(sql).toContain('WHERE id = $loteId');
            expect(sql).not.toContain('2026-09-23');
            expect(params).toEqual({ loteId: 'L1', dataDebito: '2026-09-23' });
        });

        it('setDataDebito usa a transação quando recebe uma', async () => {
            const db = buildDb();
            const tx = buildDb();
            await make(db).setDataDebito(
                { loteId: 'L1', dataDebito: '2026-09-23' },
                tx as unknown as Parameters<LotePagamentoRepository['setDataDebito']>[1],
            );
            expect(tx.update).toHaveBeenCalledTimes(1);
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    it('transicionarStatus p/ RASCUNHO (reabrir) não exige finalizadoPor', async () => {
        const db = buildDb();
        await make(db).transicionarStatus({
            id: 'L1',
            de: ['FINALIZADO'],
            para: 'RASCUNHO',
            versaoEsperada: 2,
        });
        const [sql, params] = db.update.mock.calls[0];
        expect(sql).toContain('finalizado_por');
        expect(params).not.toHaveProperty('finalizadoPor');
    });
    // ── ADR-0054 — destino manual do item (I10e, I10g, I10h) ─────────────────────────────
    describe('autorização do favorecido usada no item (ADR-0065, I10f)', () => {
        it('item sem autorização registrada: sem favorecidoAutorizadoId', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([itemRow()]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]?.favorecidoAutorizadoId).toBeUndefined();
        });

        it('mapeia a autorização usada sem nenhum valor de destino', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([itemRow({ favorecido_autorizado_id: 'AUT-1' })]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]?.favorecidoAutorizadoId).toBe('AUT-1');
        });

        it('setFavorecidoAutorizadoItem grava só o id, com parâmetros nomeados e sem bump', async () => {
            const db = buildDb();
            const n = await make(db).setFavorecidoAutorizadoItem({
                loteId: 'L1',
                filCod: 2,
                docCod: '100',
                titCod: '1',
                autorizacaoId: 'AUT-1',
            });
            expect(n).toBe(1);
            const [sql, params] = db.update.mock.calls[0];
            expect(sql).toMatch(/SET favorecido_autorizado_id = \$autorizacaoId/);
            expect(sql).not.toMatch(/versao/);
            expect(params).toEqual({
                loteId: 'L1',
                filCod: 2,
                docCod: '100',
                titCod: '1',
                autorizacaoId: 'AUT-1',
            });
        });

        it('as colunas apagadas pela 0080 não são mais lidas', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([]);
            await make(db).getLoteComItens('L1');
            const sqlItens = String(db.selectMany.mock.calls[0]?.[0]);
            const sqlHeader = String(db.selectFirst.mock.calls[0]?.[0]);
            for (const c of ['destino_manual', 'destino_origem', 'excecao_destino_id']) {
                expect(sqlItens).not.toContain(c);
            }
            for (const c of ['conferido_por', 'devolvido_por', 'motivo_devolucao']) {
                expect(sqlHeader).not.toContain(c);
            }
            expect(sqlItens).toMatch(/favorecido_autorizado_id/);
            expect(sqlItens).toMatch(/autorizacao_aviso/);
        });
    });

    describe('sincronização pelo título (ADR-0055, I11)', () => {
        const itemPersistir = (over: Record<string, unknown> = {}) => ({
            filCod: 2,
            docCod: '38682',
            titCod: '1',
            situacao: 'PAGO' as const,
            rejeitado: false,
            divergencia: false,
            retornoEvento: 'BD',
            borCod: 22320,
            baixaFonte: 'TITULO' as const,
            origemBaixa: 'FORA_DO_RETORNO' as const,
            sincronizadoEm: '2026-09-29T15:35:00.000Z',
            ...over,
        });

        it('getLoteComItens devolve os campos novos do item (API/UI)', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header({ status: 'BAIXADO' }));
            db.selectMany.mockResolvedValue([
                itemRow({
                    situacao: 'PAGO',
                    pago_em: new Date('2026-09-24T15:00:00Z'),
                    pago_observado_em: new Date('2026-09-29T15:35:00Z'),
                    valor_pago: '275.00',
                    origem_baixa: 'FORA_DO_RETORNO',
                    baixa_fonte: 'TITULO',
                    divergencia: false,
                    sincronizado_em: new Date('2026-09-29T15:35:00Z'),
                    bor_cod: 22320,
                }),
            ]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]).toEqual(
                expect.objectContaining({
                    situacao: 'PAGO',
                    pagoEm: '2026-09-24T15:00:00.000Z',
                    pagoObservadoEm: '2026-09-29T15:35:00.000Z',
                    valorPago: 275,
                    origemBaixa: 'FORA_DO_RETORNO',
                    baixaFonte: 'TITULO',
                    divergencia: false,
                    sincronizadoEm: '2026-09-29T15:35:00.000Z',
                    borCod: 22320,
                }),
            );
            const sql = db.selectMany.mock.calls[0][0] as string;
            expect(sql).toMatch(/i\.situacao/);
            expect(sql).toMatch(/i\.sincronizado_em/);
        });

        it('item nunca sincronizado: divergencia=false e sem situacao', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([itemRow()]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]?.divergencia).toBe(false);
            expect(lote?.itens[0]?.situacao).toBeUndefined();
        });

        it('listLotes também traz situação/divergência dos itens', async () => {
            const db = buildDb();
            db.selectMany
                .mockResolvedValueOnce([header({ status: 'RETORNADO' })])
                .mockResolvedValueOnce([
                    itemRow({ situacao: 'REJEITADO', divergencia: true, divergencia_detalhe: 'x' }),
                ]);
            const [lote] = await make(db).listLotes({});
            expect(lote?.itens[0]).toEqual(
                expect.objectContaining({
                    situacao: 'REJEITADO',
                    divergencia: true,
                    divergenciaDetalhe: 'x',
                }),
            );
        });

        it('listLotesSincronizaveis: REMESSA_GERADA/RETORNADO + BAIXADO na janela, parametrizado', async () => {
            const db = buildDb();
            db.selectMany.mockResolvedValue([{ id: 'L1' }, { id: 'L2' }]);
            const ids = await make(db).listLotesSincronizaveis(30);
            expect(ids).toEqual(['L1', 'L2']);
            const [sql, params] = db.selectMany.mock.calls[0];
            expect(params).toEqual({
                ativos: ['REMESSA_GERADA', 'RETORNADO'],
                baixado: 'BAIXADO',
                dias: 30,
            });
            expect(sql).toMatch(/native_fil_cod IS NOT NULL/);
            expect(sql).not.toMatch(/\$\{/);
        });

        it('aplicarSincronizacao: trava + itens + transição numa ÚNICA transação', async () => {
            const db = buildDb();
            db.update.mockResolvedValue(1);
            const r = await make(db).aplicarSincronizacao({
                loteId: 'L1',
                versaoEsperada: 7,
                statusAtual: 'REMESSA_GERADA',
                para: 'BAIXADO',
                itens: [itemPersistir()],
            });
            expect(r).toBe('APLICADO');
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            const [lockSql, lockParams] = db.update.mock.calls[0];
            expect(lockSql).toMatch(/versao = versao \+ 1/);
            expect(lockSql).toMatch(/WHERE id = \$loteId AND versao = \$versaoEsperada/);
            expect(lockParams).toEqual({
                loteId: 'L1',
                versaoEsperada: 7,
                statusAtual: 'REMESSA_GERADA',
                para: 'BAIXADO',
            });
            const [itemSql, itemParams] = db.update.mock.calls[1];
            expect(itemSql).toMatch(/UPDATE lote_pagamento_item/);
            expect(itemParams).toEqual(
                expect.objectContaining({
                    situacao: 'PAGO',
                    borCod: 22320,
                    bxaCodSeq: null,
                    pagoEm: null,
                    baixaFonte: 'TITULO',
                    origemBaixa: 'FORA_DO_RETORNO',
                    divergencia: false,
                }),
            );
        });

        it('aplicarSincronizacao: conflito de versão → CONFLITO e NENHUM item gravado', async () => {
            const db = buildDb();
            db.update.mockResolvedValueOnce(0);
            const r = await make(db).aplicarSincronizacao({
                loteId: 'L1',
                versaoEsperada: 7,
                statusAtual: 'REMESSA_GERADA',
                itens: [itemPersistir()],
            });
            expect(r).toBe('CONFLITO');
            expect(db.update).toHaveBeenCalledTimes(1);
        });

        it('aplicarSincronizacao sem transição mantém o status (COALESCE com NULL)', async () => {
            const db = buildDb();
            await make(db).aplicarSincronizacao({
                loteId: 'L1',
                versaoEsperada: 2,
                statusAtual: 'REMESSA_GERADA',
                itens: [itemPersistir({ situacao: 'AGENDADO' })],
            });
            expect(db.update.mock.calls[0][1]).toEqual(expect.objectContaining({ para: null }));
        });

        it('tocarSincronizacao só mexe em sincronizado_em — nunca em versao (I11h)', async () => {
            const db = buildDb();
            await make(db).tocarSincronizacao({
                loteId: 'L1',
                itens: [{ filCod: 1, docCod: '4030', titCod: '7' }],
                em: '2026-09-29T15:35:00.000Z',
            });
            const [sql, params] = db.update.mock.calls[0];
            expect(sql).toMatch(/SET sincronizado_em = \$em/);
            expect(sql).not.toMatch(/versao/);
            expect(sql).not.toMatch(/UPDATE lote_pagamento\s/);
            expect(params).toEqual({
                loteId: 'L1',
                em: '2026-09-29T15:35:00.000Z',
                chaves: ['1:4030:7'],
            });
        });

        it('tocarSincronizacao sem itens não faz query', async () => {
            const db = buildDb();
            await make(db).tocarSincronizacao({ loteId: 'L1', itens: [], em: 'x' });
            expect(db.update).not.toHaveBeenCalled();
        });

        it('findByChaveNativa usa a filial PASSADA (a da linha do .RET), não outra (T3)', async () => {
            const db = buildDb();
            db.selectFirst
                .mockResolvedValueOnce({ id: 'L-fil1' })
                .mockResolvedValueOnce({ id: 'L-fil2' });
            const repo = make(db);
            // Mesmo arquivo (gar 9) com linhas de fil 1/flp 8 e fil 2/flp 24.
            expect(
                await repo.findByChaveNativa({ nativeFilCod: 1, nativeBncCod: 4, nativeFlpCod: 8 }),
            ).toBe('L-fil1');
            expect(
                await repo.findByChaveNativa({
                    nativeFilCod: 2,
                    nativeBncCod: 4,
                    nativeFlpCod: 24,
                }),
            ).toBe('L-fil2');
            expect(db.selectFirst.mock.calls[0][1]).toEqual({
                nativeFilCod: 1,
                nativeBncCod: 4,
                nativeFlpCod: 8,
            });
            expect(db.selectFirst.mock.calls[1][1]).toEqual({
                nativeFilCod: 2,
                nativeBncCod: 4,
                nativeFlpCod: 24,
            });
        });
    });
});

/** Todas as queries vistas pelo mock, na ordem (insert/update/select), com os parâmetros. */
const todas = (db: DbMock): Array<[string, Record<string, unknown> | undefined]> =>
    [db.insert, db.update, db.selectMany, db.selectFirst].flatMap((m) =>
        m.mock.calls.map(
            ([q, p]) =>
                [String(q), p as Record<string, unknown> | undefined] as [
                    string,
                    Record<string, unknown> | undefined,
                ],
        ),
    );

const eventosGravados = (db: DbMock): Array<Record<string, unknown> | undefined> =>
    db.insert.mock.calls
        .filter(([q]) => String(q).includes('INSERT INTO sispag_verificacao_evento'))
        .map(([, p]) => p as Record<string, unknown> | undefined);

describe('LotePagamentoRepository — verificação TED/PIX (ADR-0063, ADR-0065)', () => {
    it('lê o estado da verificação e o selo no item; destino só mascarado', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue(header({ status: 'RASCUNHO' }));
        db.selectMany.mockResolvedValue([
            itemRow({
                modalidade: 'TED',
                verificacao_estado: 'OK',
                verificado_em: new Date('2026-10-05T09:00:00Z'),
                destino_mascarado: 'banco 341 · ag. 0641 · cc ****7766-5',
                autorizacao_aviso: 'DESTINO_ALTERADO',
            }),
        ]);
        const lote = await make(db).getLoteComItens('L1');
        expect(lote?.itens[0]).toMatchObject({
            verificacaoEstado: 'OK',
            destinoMascarado: 'banco 341 · ag. 0641 · cc ****7766-5',
            autorizacaoAviso: 'DESTINO_ALTERADO',
        });
        const [sqlItens] = db.selectMany.mock.calls[0] ?? [];
        expect(String(sqlItens)).toMatch(/i\.verificacao_estado, i\.verificado_em/);
    });

    it('voltar a RASCUNHO (L4) só limpa a finalização — não há conferência', async () => {
        const db = buildDb();
        await make(db).transicionarStatus({
            id: 'L1',
            de: ['FINALIZADO'],
            para: 'RASCUNHO',
            versaoEsperada: 3,
        });
        const [sql, params] = db.update.mock.calls[0] ?? [];
        expect(String(sql)).not.toMatch(/conferido_por|motivo_devolucao/);
        expect(params).toMatchObject({ para: 'RASCUNHO', versaoEsperada: 3 });
    });

    it('marcarVerificacaoItem grava estado, máscara e selo, parametrizado, sem bump de versão', async () => {
        const db = buildDb();
        await make(db).marcarVerificacaoItem({
            loteId: 'L1',
            filCod: 4,
            docCod: '6173',
            titCod: '1',
            estado: 'OK',
            destinoMascarado: 'PIX CPF/CNPJ ***.444.777-**',
            autorizacaoAviso: 'FAVORECIDO_NAO_AUTORIZADO',
        });
        const [sql, params] = db.update.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/SET verificacao_estado = \$estado/);
        expect(String(sql)).toMatch(/autorizacao_aviso = CASE WHEN \$estado = 'OK'/);
        expect(String(sql)).not.toMatch(/versao/);
        expect(params).toMatchObject({
            estado: 'OK',
            autorizacaoAviso: 'FAVORECIDO_NAO_AUTORIZADO',
        });
    });

    it.each([
        'SEM_DADO_PAGAMENTO',
        'FAVORECIDO_NAO_AUTORIZADO',
        'DESTINO_ALTERADO',
    ] as const)('removerItemPeloSistema (%s): DELETE só em RASCUNHO + bump + evento com o motivo; não marca manual', async (motivo) => {
        const db = buildDb();
        const ok = await make(db).removerItemPeloSistema(
            { loteId: 'L1', filCod: 4, docCod: '6173', titCod: '1', motivo },
            db as never,
        );
        expect(ok).toBe(true);
        const sqls = todas(db).map(([q]) => q);
        expect(
            sqls.some((q) =>
                /DELETE FROM lote_pagamento_item[\s\S]*l\.status = 'RASCUNHO'/.test(q),
            ),
        ).toBe(true);
        expect(sqls.some((q) => /versao = versao \+ 1/.test(q))).toBe(true);
        expect(sqls.some((q) => /automatico = FALSE/.test(q))).toBe(false);
        expect(eventosGravados(db)).toEqual([
            expect.objectContaining({
                evento: 'ITEM_REMOVIDO_SISTEMA',
                ator: 'sistema',
                loteId: 'L1',
                dados: JSON.stringify({ motivo }),
            }),
        ]);
        expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('removerItemPeloSistema: item fora do lote RASCUNHO não gera evento', async () => {
        const db = buildDb();
        db.update.mockResolvedValueOnce(0);
        const ok = await make(db).removerItemPeloSistema(
            { loteId: 'L1', filCod: 4, docCod: '6173', titCod: '1', motivo: 'SEM_DADO_PAGAMENTO' },
            db as never,
        );
        expect(ok).toBe(false);
        expect(eventosGravados(db)).toEqual([]);
    });

    it('o repositório não expõe mais conferir/devolver (L12/L13 removidas)', () => {
        const repo = make(buildDb()) as unknown as Record<string, unknown>;
        expect(repo.conferir).toBeUndefined();
        expect(repo.devolver).toBeUndefined();
    });
});

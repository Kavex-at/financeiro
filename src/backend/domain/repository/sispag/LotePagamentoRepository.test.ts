import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';

interface DbMock {
    selectMany: jest.Mock;
    selectFirst: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
}

const buildDb = (): DbMock => ({
    selectMany: jest.fn().mockResolvedValue([]),
    selectFirst: jest.fn().mockResolvedValue(null),
    insert: jest.fn().mockResolvedValue(1),
    update: jest.fn().mockResolvedValue(1),
});

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

const make = (db: DbMock) => new LotePagamentoRepository(db as unknown as PostgreeDatabaseClient);

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

    it('lerEstadoParaEdicao trava a linha do lote (FOR UPDATE) na transação do serviço', async () => {
        const db = buildDb();
        const tx = buildDb();
        tx.selectFirst.mockResolvedValue({ status: 'RASCUNHO', automatico: true });
        const estado = await make(db).lerEstadoParaEdicao('L1', tx as never);
        expect(db.selectFirst).not.toHaveBeenCalled();
        const [sql, params] = tx.selectFirst.mock.calls[0];
        expect(sql).toMatch(
            /SELECT status, automatico FROM lote_pagamento\s+WHERE id = \$loteId\s+FOR UPDATE/,
        );
        expect(params).toEqual({ loteId: 'L1' });
        expect(estado).toEqual({ status: 'RASCUNHO', automatico: true });
    });

    it('lerEstadoParaEdicao devolve null quando o lote não existe', async () => {
        const tx = buildDb();
        expect(await make(buildDb()).lerEstadoParaEdicao('X', tx as never)).toBeNull();
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
});

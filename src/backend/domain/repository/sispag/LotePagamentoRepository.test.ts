import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import Logger from '../../libs/logger/Logger.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';

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
    // ── ADR-0054 — destino manual do item (I10e, I10g, I10h) ─────────────────────────────
    describe('destino manual', () => {
        const CONTA = {
            tipo: 'CONTA',
            bancoCod: '237',
            agencia: '1234',
            conta: '9876543',
            contaDv: '1',
            titularDocumento: '11144477735',
        } as const;
        const chave = { loteId: 'L1', filCod: 2, docCod: '100', titCod: '1' };

        it('setDestinoManualItem é UMA transação: trava, grava, bumpa a versão e grava a trilha', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValueOnce({ destino_manual: null });
            const r = await make(db).setDestinoManualItem({
                ...chave,
                versaoEsperada: 3,
                destino: CONTA,
                usuario: 'ana',
            });
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            expect(r.atualizado).toBe(true);
            expect(r.auditId).toMatch(/^[0-9a-f-]{36}$/);

            const [sqlTrava, pTrava] = db.selectFirst.mock.calls[0];
            expect(sqlTrava).toMatch(/l\.status = 'RASCUNHO'/);
            expect(sqlTrava).toMatch(/l\.versao = \$versaoEsperada/);
            expect(sqlTrava).toMatch(/FOR UPDATE/);
            expect(pTrava).toMatchObject({ ...chave, versaoEsperada: 3 });

            const updates = db.update.mock.calls.map(([sql]) => String(sql));
            expect(updates.some((q) => /SET destino_manual = \$destino::jsonb/.test(q))).toBe(true);
            expect(updates.some((q) => /versao = versao \+ 1/.test(q))).toBe(true);

            const [sqlAudit, pAudit] = db.insert.mock.calls[0];
            expect(sqlAudit).toMatch(/INSERT INTO lote_pagamento_item_destino_audit/);
            expect(pAudit).toMatchObject({ ...chave, alteradoPor: 'ana', antes: null });
            // A trilha guarda o valor completo (é a prova do I10g).
            expect(JSON.parse(String(pAudit.depois))).toEqual(CONTA);

            // Parametrizado: nenhum valor do destino dentro do texto SQL.
            const todoSql = [
                ...db.selectFirst.mock.calls,
                ...db.update.mock.calls,
                ...db.insert.mock.calls,
            ]
                .map(([sql]) => String(sql))
                .join('\n');
            expect(todoSql).not.toContain('9876543');
            expect(todoSql).not.toContain('11144477735');
            expect(todoSql).toMatch(/\$depois/);
        });

        it('versão errada ou lote fora de RASCUNHO: zero escrita e nenhuma trilha', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValueOnce(null);
            const r = await make(db).setDestinoManualItem({
                ...chave,
                versaoEsperada: 9,
                destino: CONTA,
                usuario: 'ana',
            });
            expect(r).toEqual({ atualizado: false });
            expect(db.update).not.toHaveBeenCalled();
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('limpar (destino undefined) grava NULL e a trilha com o antes', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValueOnce({ destino_manual: CONTA });
            const r = await make(db).setDestinoManualItem({
                ...chave,
                versaoEsperada: 3,
                usuario: 'ana',
            });
            expect(r.atualizado).toBe(true);
            const upd = db.update.mock.calls.find(([q]) => /destino_manual/.test(String(q)));
            expect(upd?.[1]).toMatchObject({ destino: null });
            const [, pAudit] = db.insert.mock.calls[0];
            expect(JSON.parse(String(pAudit.antes))).toEqual(CONTA);
            expect(pAudit.depois).toBeNull();
        });

        it('getLoteComItens devolve destinoManual parseado + quem informou (trilha mais recente)', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([
                itemRow({
                    destino_manual: CONTA,
                    destino_audit_id: 'a-1',
                    destino_informado_por: 'ana',
                    destino_informado_em: new Date('2026-09-28T12:00:00Z'),
                }),
            ]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]).toMatchObject({
                destinoManual: CONTA,
                destinoManualAuditId: 'a-1',
                destinoManualInformadoPor: 'ana',
                destinoManualInformadoEm: '2026-09-28T12:00:00.000Z',
            });
            const [sqlItens] = db.selectMany.mock.calls[0];
            expect(String(sqlItens)).toMatch(/destino_manual/);
        });

        it('D10 — a trilha vigente é a GRAVAÇÃO mais recente; a aprovação é a que aponta para ela', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([
                itemRow({
                    destino_manual: CONTA,
                    destino_audit_id: 'a-1',
                    destino_informado_por: 'ana',
                    destino_informado_em: new Date('2026-09-28T12:00:00Z'),
                    destino_aprovado_por: 'bia',
                    destino_aprovado_em: new Date('2026-09-28T13:00:00Z'),
                }),
            ]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]).toMatchObject({
                destinoManualAuditId: 'a-1',
                destinoManualAprovadoPor: 'bia',
                destinoManualAprovadoEm: '2026-09-28T13:00:00.000Z',
            });
            const sqlItens = String(db.selectMany.mock.calls[0]?.[0]);
            expect(sqlItens).toMatch(/d\.evento = 'GRAVACAO'/);
            expect(sqlItens).toMatch(/ap\.evento = 'APROVACAO' AND ap\.aprova_audit_id = a\.id/);
        });

        it('D10 — sem linha de aprovação: item sem aprovadoPor (pendente)', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([
                itemRow({
                    destino_manual: CONTA,
                    destino_audit_id: 'a-2',
                    destino_aprovado_por: null,
                }),
            ]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]).not.toHaveProperty('destinoManualAprovadoPor');
        });

        it('setDestinoManualItem grava a linha como GRAVACAO', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValueOnce({ destino_manual: null });
            await make(db).setDestinoManualItem({
                ...chave,
                versaoEsperada: 3,
                destino: CONTA,
                usuario: 'ana',
            });
            expect(String(db.insert.mock.calls[0]?.[0])).toMatch(/'GRAVACAO'/);
        });

        describe('aprovarDestinoManualItem (D10)', () => {
            it('UMA transação: trava sob versão/RASCUNHO, insere APROVACAO da gravação vigente e bumpa', async () => {
                const db = buildDb();
                db.selectFirst
                    .mockResolvedValueOnce({ tem_destino: true })
                    .mockResolvedValueOnce({ id: 'grav-1' });
                const r = await make(db).aprovarDestinoManualItem({
                    ...chave,
                    versaoEsperada: 4,
                    usuario: 'bia',
                });
                expect(db.withTransaction).toHaveBeenCalledTimes(1);
                expect(r.atualizado).toBe(true);
                expect(r.auditId).toMatch(/^[0-9a-f-]{36}$/);
                const [sqlTrava, pTrava] = db.selectFirst.mock.calls[0];
                expect(sqlTrava).toMatch(/l\.status = 'RASCUNHO'/);
                expect(sqlTrava).toMatch(/l\.versao = \$versaoEsperada/);
                expect(sqlTrava).toMatch(/FOR UPDATE/);
                expect(pTrava).toMatchObject({ ...chave, versaoEsperada: 4 });
                expect(String(db.selectFirst.mock.calls[1]?.[0])).toMatch(/evento = 'GRAVACAO'/);
                const [sqlIns, pIns] = db.insert.mock.calls[0];
                expect(sqlIns).toMatch(/'APROVACAO'/);
                expect(pIns).toMatchObject({
                    ...chave,
                    alteradoPor: 'bia',
                    aprovaAuditId: 'grav-1',
                });
                // A aprovação não copia o destino.
                expect(pIns).not.toHaveProperty('depois');
                expect(
                    db.update.mock.calls.some(([q]) => /versao = versao \+ 1/.test(String(q))),
                ).toBe(true);
                expect(db.update.mock.calls.some(([q]) => /destino_audit/.test(String(q)))).toBe(
                    false,
                );
            });

            it('versão errada ou fora de RASCUNHO: nada escrito', async () => {
                const db = buildDb();
                db.selectFirst.mockResolvedValueOnce(null);
                const r = await make(db).aprovarDestinoManualItem({
                    ...chave,
                    versaoEsperada: 9,
                    usuario: 'bia',
                });
                expect(r).toEqual({ atualizado: false });
                expect(db.insert).not.toHaveBeenCalled();
                expect(db.update).not.toHaveBeenCalled();
            });

            it('item sem destino digitado: semDestino, nada escrito', async () => {
                const db = buildDb();
                db.selectFirst.mockResolvedValueOnce({ tem_destino: false });
                const r = await make(db).aprovarDestinoManualItem({
                    ...chave,
                    versaoEsperada: 4,
                    usuario: 'bia',
                });
                expect(r).toEqual({ atualizado: false, semDestino: true });
                expect(db.insert).not.toHaveBeenCalled();
            });
        });

        it('JSON inválido no banco: item sem destino + aviso SEM o conteúdo', async () => {
            const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            const db = buildDb();
            db.selectFirst.mockResolvedValue(header());
            db.selectMany.mockResolvedValue([
                itemRow({ destino_manual: { tipo: 'CONTA', conta: '5550001' } }),
            ]);
            const lote = await make(db).getLoteComItens('L1');
            expect(lote?.itens[0]?.destinoManual).toBeUndefined();
            expect(warn).toHaveBeenCalled();
            expect(JSON.stringify(warn.mock.calls)).not.toContain('5550001');
            warn.mockRestore();
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

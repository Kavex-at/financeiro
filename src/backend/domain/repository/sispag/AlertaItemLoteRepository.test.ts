import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { AlertaItemLote } from '../../interface/sispag/SispagInterface.js';
import AlertaItemLoteRepository from './AlertaItemLoteRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

interface DbMock {
    selectMany: jest.Mock;
    selectFirst: jest.Mock;
    insert: jest.Mock;
    update: jest.Mock;
    withTransaction: jest.Mock;
}

const buildDb = (): DbMock => {
    const db = {
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        withTransaction: jest.fn(),
    };
    db.withTransaction.mockImplementation(async (fn: (tx: DbMock) => unknown) => fn(db));
    return db;
};

const make = (db: DbMock) => {
    const pg = db as unknown as PostgreeDatabaseClient;
    return new AlertaItemLoteRepository(pg, new VerificacaoEventoRepository(pg));
};

const CHAVE = { filCod: 4, docCod: '6173', titCod: '1' };

const eventos = (db: DbMock) =>
    db.insert.mock.calls
        .filter(([q]) => String(q).includes('sispag_verificacao_evento'))
        .map(([, p]) => p as Record<string, unknown>);

const alerta = (over: Partial<AlertaItemLote> = {}): AlertaItemLote => ({
    id: 'A1',
    loteId: 'L1',
    ...CHAVE,
    tipo: 'DUPLICIDADE_FORTE',
    contraparteFilCod: 4,
    contraparteDocCod: '6702',
    evidencia: {},
    estado: 'ABERTA',
    criadoEm: '2026-10-05T10:00:00.000Z',
    verificadoEm: '2026-10-05T10:00:00.000Z',
    ...over,
});

describe('AlertaItemLoteRepository (ADR-0063)', () => {
    it('criar: INSERT parametrizado + evento ALERTA_CRIADA na MESMA transação', async () => {
        const db = buildDb();
        const id = await make(db).criar(
            {
                loteId: 'L1',
                chave: CHAVE,
                tipo: 'DUPLICIDADE_FORTE',
                contraparteFilCod: 4,
                contraparteDocCod: '6702',
                contraparteTitulos: [{ titCod: '1', valor: 10, pago: true }],
                evidencia: { numeroNota: '45871' },
            },
            'ana',
        );
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        const [sql, params] = db.insert.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/INSERT INTO lote_pagamento_item_alerta/);
        expect(String(sql)).toMatch(/VALUES \(\$id, \$loteId, \$filCod/);
        expect(params).toMatchObject({ id, estado: 'ABERTA', contraparteDocCod: '6702' });
        expect(eventos(db)).toEqual([
            expect.objectContaining({ evento: 'ALERTA_CRIADA', ator: 'ana', alertaId: id }),
        ]);
    });

    it('criar dentro de uma transação existente não abre outra', async () => {
        const db = buildDb();
        await make(db).criar(
            { loteId: 'L1', chave: CHAVE, tipo: 'CANAL_HABITUAL', evidencia: {} },
            'sistema',
            db as never,
        );
        expect(db.withTransaction).not.toHaveBeenCalled();
        expect(eventos(db)).toHaveLength(1);
    });

    it('lista só as vivas (ABERTA | RESOLVIDA), mapeando justificativa', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValue([
            {
                id: 'A1',
                lote_id: 'L1',
                fil_cod: 4,
                doc_cod: '6173',
                tit_cod: '1',
                tipo: 'DUPLICIDADE_FORTE',
                contraparte_fil_cod: 4,
                contraparte_doc_cod: '6702',
                contraparte_titulos: [{ titCod: '1', valor: 10, pago: false }],
                evidencia: { numeroNota: '1' },
                estado: 'RESOLVIDA',
                resolucao: 'JUSTIFICADA',
                justificativa: 'NF de serviço e de produto',
                resolvido_por: 'ana',
                resolvido_em: new Date('2026-10-05T11:00:00Z'),
                criado_em: new Date('2026-10-05T10:00:00Z'),
                verificado_em: new Date('2026-10-05T10:30:00Z'),
            },
        ]);
        const [a] = await make(db).listVivasDosLotes(['L1']);
        expect(a).toMatchObject({
            estado: 'RESOLVIDA',
            resolucao: 'JUSTIFICADA',
            justificativa: 'NF de serviço e de produto',
            resolvidoPor: 'ana',
        });
        const [sql, params] = db.selectMany.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/estado = ANY\(\$vivas\)/);
        expect(params).toEqual({ loteIds: ['L1'], vivas: ['ABERTA', 'RESOLVIDA'] });
    });

    it('listVivasDosLotes sem lote não consulta', async () => {
        const db = buildDb();
        expect(await make(db).listVivasDosLotes([])).toEqual([]);
        expect(db.selectMany).not.toHaveBeenCalled();
    });

    it('fechar como OBSOLETA grava ALERTA_OBSOLETA; alerta já fechada não gera evento', async () => {
        const db = buildDb();
        expect(await make(db).fechar(alerta(), 'OBSOLETA', 'sistema')).toBe(true);
        expect(eventos(db)).toEqual([expect.objectContaining({ evento: 'ALERTA_OBSOLETA' })]);
        db.update.mockResolvedValueOnce(0);
        expect(await make(db).fechar(alerta(), 'DESCARTADA', 'ana')).toBe(false);
        expect(eventos(db)).toHaveLength(1);
    });

    it('descartarDoItem fecha cada viva como DESCARTADA com evento', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([
            {
                id: 'A1',
                lote_id: 'L1',
                ...{ fil_cod: 4, doc_cod: '6173', tit_cod: '1' },
                tipo: 'CANAL_HABITUAL',
                estado: 'ABERTA',
                criado_em: new Date(),
                verificado_em: new Date(),
            },
            {
                id: 'A2',
                lote_id: 'L1',
                ...{ fil_cod: 4, doc_cod: '6173', tit_cod: '1' },
                tipo: 'DUPLICIDADE_FORTE',
                contraparte_fil_cod: 4,
                contraparte_doc_cod: '6702',
                estado: 'ABERTA',
                criado_em: new Date(),
                verificado_em: new Date(),
            },
        ]);
        expect(await make(db).descartarDoItem('L1', CHAVE, 'ana')).toBe(2);
        expect(eventos(db).map((e) => e.evento)).toEqual([
            'ALERTA_DESCARTADA',
            'ALERTA_DESCARTADA',
        ]);
    });

    it('resolver: só ABERTA → RESOLVIDA, com resolução, ator e evento na transação dada', async () => {
        const db = buildDb();
        const ok = await make(db).resolver(
            {
                alerta: alerta(),
                resolucao: 'JUSTIFICADA',
                justificativa: 'são dois serviços',
                ator: 'ana',
            },
            db as never,
        );
        expect(ok).toBe(true);
        const [sql, params] = db.update.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/WHERE id = \$id AND estado = \$aberta/);
        expect(params).toMatchObject({
            resolucao: 'JUSTIFICADA',
            ator: 'ana',
            resolvida: 'RESOLVIDA',
        });
        expect(eventos(db)).toEqual([
            expect.objectContaining({ evento: 'ALERTA_JUSTIFICADA', ator: 'ana', alertaId: 'A1' }),
        ]);
    });

    it('resolver RETIRAR grava ALERTA_RETIRADA; alerta já resolvida não grava nada', async () => {
        const db = buildDb();
        await make(db).resolver(
            { alerta: alerta(), resolucao: 'RETIRADA', ator: 'ana' },
            db as never,
        );
        expect(eventos(db)[0]).toMatchObject({ evento: 'ALERTA_RETIRADA' });
        db.update.mockResolvedValueOnce(0);
        expect(
            await make(db).resolver(
                { alerta: alerta(), resolucao: 'RETIRADA', ator: 'ana' },
                db as never,
            ),
        ).toBe(false);
        expect(eventos(db)).toHaveLength(1);
    });

    it('confirmar só atualiza instante e snapshot (sem evento)', async () => {
        const db = buildDb();
        await make(db).confirmar('A1', { evidencia: { x: 1 } });
        expect(String(db.update.mock.calls[0]?.[0])).toMatch(/SET verificado_em = now\(\)/);
        expect(eventos(db)).toEqual([]);
    });
});

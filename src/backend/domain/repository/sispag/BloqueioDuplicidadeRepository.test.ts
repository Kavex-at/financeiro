import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
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
    return new BloqueioDuplicidadeRepository(pg, new VerificacaoEventoRepository(pg));
};

const CHAVE = { filCod: 4, docCod: '6702', titCod: '1' };

const eventos = (db: DbMock) =>
    db.insert.mock.calls
        .filter(([q]) => String(q).includes('sispag_verificacao_evento'))
        .map(([, p]) => p as Record<string, unknown>);

const row = (over: Record<string, unknown> = {}) => ({
    id: 'B1',
    fil_cod: 4,
    doc_cod: '6702',
    tit_cod: '1',
    pes_cod: '90001',
    alerta_id: 'A1',
    lote_id_origem: 'L1',
    motivo: 'duplicata do 6173',
    estado: 'ATIVO',
    marcado_por: 'ana',
    marcado_em: new Date('2026-10-05T10:00:00Z'),
    encerrado_em: null,
    desfeito_por: null,
    desfeito_em: null,
    motivo_desfazer: null,
    ...over,
});

describe('BloqueioDuplicidadeRepository (ADR-0063, I13g)', () => {
    it('criar: INSERT ATIVO parametrizado + evento BLOQUEIO_CRIADO na transação dada', async () => {
        const db = buildDb();
        const id = await make(db).criar(
            {
                chave: CHAVE,
                pesCod: '90001',
                alertaId: 'A1',
                loteIdOrigem: 'L1',
                motivo: 'duplicata do 6173',
                ator: 'ana',
            },
            db as never,
        );
        const [sql, params] = db.insert.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(
            /ON CONFLICT \(fil_cod, doc_cod, tit_cod\) WHERE estado = 'ATIVO'/,
        );
        expect(params).toMatchObject({ id, ...CHAVE, ativo: 'ATIVO', ator: 'ana' });
        expect(eventos(db)).toEqual([
            expect.objectContaining({ evento: 'BLOQUEIO_CRIADO', bloqueioId: id, ator: 'ana' }),
        ]);
        expect(db.withTransaction).not.toHaveBeenCalled();
    });

    it('criar com bloqueio ATIVO já existente reaproveita o existente, sem evento', async () => {
        const db = buildDb();
        db.insert.mockResolvedValueOnce(0);
        db.selectFirst.mockResolvedValueOnce(row({ id: 'B0' }));
        const id = await make(db).criar(
            { chave: CHAVE, alertaId: 'A2', loteIdOrigem: 'L1', motivo: 'x', ator: 'ana' },
            db as never,
        );
        expect(id).toBe('B0');
        expect(eventos(db)).toEqual([]);
    });

    it('findAtivo filtra por título e estado ATIVO', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce(row());
        const b = await make(db).findAtivo(CHAVE);
        expect(b).toMatchObject({ id: 'B1', estado: 'ATIVO', motivo: 'duplicata do 6173' });
        expect(db.selectFirst.mock.calls[0]?.[1]).toEqual({ ...CHAVE, ativo: 'ATIVO' });
    });

    it('encerrarDeTitulosInativos: um UPDATE em lote + um evento por bloqueio, ator sistema, uma transação', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([
            { id: 'B1', fil_cod: 4, doc_cod: '6702', tit_cod: '1' },
            { id: 'B2', fil_cod: 1, doc_cod: '10', tit_cod: '2' },
        ]);
        expect(await make(db).encerrarDeTitulosInativos()).toBe(2);
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        const [sql] = db.selectMany.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/FROM titulo_a_pagar t[\s\S]*t\.ativo = FALSE/);
        expect(eventos(db).map((e) => [e.evento, e.ator, e.bloqueioId])).toEqual([
            ['BLOQUEIO_ENCERRADO', 'sistema', 'B1'],
            ['BLOQUEIO_ENCERRADO', 'sistema', 'B2'],
        ]);
    });

    it('desfazer: ATIVO → DESFEITO com motivo e evento; sem ATIVO devolve null', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce(
            row({ estado: 'DESFEITO', desfeito_por: 'ana', motivo_desfazer: 'cancelado o 6173' }),
        );
        const b = await make(db).desfazer({
            chave: CHAVE,
            motivo: 'cancelado o 6173',
            ator: 'ana',
        });
        expect(b).toMatchObject({ estado: 'DESFEITO', motivoDesfazer: 'cancelado o 6173' });
        expect(eventos(db)).toEqual([
            expect.objectContaining({ evento: 'BLOQUEIO_DESFEITO', ator: 'ana', bloqueioId: 'B1' }),
        ]);
        const vazio = buildDb();
        expect(await make(vazio).desfazer({ chave: CHAVE, motivo: 'x', ator: 'ana' })).toBeNull();
        expect(eventos(vazio)).toEqual([]);
    });
});

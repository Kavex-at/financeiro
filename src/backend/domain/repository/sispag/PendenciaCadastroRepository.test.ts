import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import PendenciaCadastroRepository, {
    type OcorrenciaPendencia,
} from './PendenciaCadastroRepository.js';
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
    return new PendenciaCadastroRepository(pg, new VerificacaoEventoRepository(pg));
};

const eventos = (db: DbMock) =>
    db.insert.mock.calls
        .filter(([q]) => String(q).includes('sispag_verificacao_evento'))
        .map(([, p]) => p as Record<string, unknown>);

const OCORRENCIA: OcorrenciaPendencia = {
    pesCod: '90001',
    filCod: 4,
    credor: 'FORNECEDOR A',
    tipo: 'CONTA',
    loteId: 'L1',
    chave: { filCod: 4, docCod: '6173', titCod: '1' },
    desfecho: 'RETIRADO',
};

describe('PendenciaCadastroRepository (ADR-0063, I13j/I13k)', () => {
    it('abre a pendência nova: INSERT ABERTA + origem + evento PENDENCIA_ABERTA, ator sistema, uma transação', async () => {
        const db = buildDb();
        const r = await make(db).abrirOuAcrescentar(OCORRENCIA);
        expect(r.aberta).toBe(true);
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        const [sqlPendencia, pPendencia] = db.insert.mock.calls[0] ?? [];
        expect(String(sqlPendencia)).toMatch(
            /ON CONFLICT \(pes_cod, tipo\) WHERE estado = 'ABERTA' DO NOTHING/,
        );
        expect(pPendencia).toMatchObject({ pesCod: '90001', tipo: 'CONTA', ator: 'sistema' });
        const [sqlOrigem, pOrigem] = db.insert.mock.calls[1] ?? [];
        expect(String(sqlOrigem)).toMatch(/INSERT INTO pendencia_cadastro_origem/);
        expect(pOrigem).toMatchObject({
            pendenciaId: r.pendenciaId,
            docCod: '6173',
            desfecho: 'RETIRADO',
        });
        expect(eventos(db)).toEqual([
            expect.objectContaining({
                evento: 'PENDENCIA_ABERTA',
                ator: 'sistema',
                pendenciaId: r.pendenciaId,
            }),
        ]);
    });

    it('com ABERTA existente só ACRESCENTA a origem (I13k) — evento PENDENCIA_ORIGEM_ACRESCENTADA', async () => {
        const db = buildDb();
        db.insert.mockResolvedValueOnce(0); // a pendência já existe
        db.selectFirst.mockResolvedValueOnce({ id: 'P0' });
        const r = await make(db).abrirOuAcrescentar(OCORRENCIA);
        expect(r).toEqual({ pendenciaId: 'P0', aberta: false });
        expect(eventos(db)).toEqual([
            expect.objectContaining({ evento: 'PENDENCIA_ORIGEM_ACRESCENTADA', pendenciaId: 'P0' }),
        ]);
    });

    it('mesma origem de novo não duplica nem gera evento', async () => {
        const db = buildDb();
        db.insert.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
        db.selectFirst.mockResolvedValueOnce({ id: 'P0' });
        await make(db).abrirOuAcrescentar(OCORRENCIA);
        expect(eventos(db)).toEqual([]);
    });

    it('resolverDoFavorecido: ABERTA → RESOLVIDA pelo sistema, com evento; sem ABERTA nada', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce({ id: 'P1' });
        expect(await make(db).resolverDoFavorecido('90001', 'CONTA')).toBe(1);
        const [sql, params] = db.selectFirst.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(
            /WHERE pes_cod = \$pesCod AND tipo = \$tipo AND estado = \$aberta/,
        );
        expect(params).toMatchObject({ ator: 'sistema', resolvida: 'RESOLVIDA' });
        expect(eventos(db)).toEqual([
            expect.objectContaining({
                evento: 'PENDENCIA_RESOLVIDA',
                ator: 'sistema',
                pendenciaId: 'P1',
            }),
        ]);
        const vazio = buildDb();
        expect(await make(vazio).resolverDoFavorecido('90001', 'CONTA')).toBe(0);
        expect(eventos(vazio)).toEqual([]);
    });

    it('listAbertas traz as origens agrupadas, sem coluna de conta/chave', async () => {
        const db = buildDb();
        db.selectMany
            .mockResolvedValueOnce([
                {
                    id: 'P1',
                    pes_cod: '90001',
                    fil_cod: 4,
                    credor: 'FORNECEDOR A',
                    tipo: 'CHAVE_PIX',
                    estado: 'ABERTA',
                    aberta_por: 'sistema',
                    aberta_em: new Date('2026-10-05T10:00:00Z'),
                    resolvida_por: null,
                    resolvida_em: null,
                    ultima_conferencia_em: null,
                },
            ])
            .mockResolvedValueOnce([
                {
                    pendencia_id: 'P1',
                    lote_id: 'L1',
                    fil_cod: 4,
                    doc_cod: '6173',
                    tit_cod: '1',
                    desfecho: 'MANTIDO_POR_EXCECAO',
                    registrada_em: new Date('2026-10-05T10:00:00Z'),
                },
            ]);
        const [p] = await make(db).listAbertas();
        expect(p).toMatchObject({
            id: 'P1',
            tipo: 'CHAVE_PIX',
            origens: [{ loteId: 'L1', docCod: '6173', desfecho: 'MANTIDO_POR_EXCECAO' }],
        });
        for (const [q] of db.selectMany.mock.calls) {
            expect(String(q)).not.toMatch(/chave_pix|conta\b/);
        }
    });
});

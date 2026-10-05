import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import ExcecaoNaoEncontradaError from '../../errors/ExcecaoNaoEncontradaError.js';
import type { DestinoManual } from '../../interface/sispag/SispagInterface.js';
import Logger from '../../libs/logger/Logger.js';
import ExcecaoDestinoRepository from './ExcecaoDestinoRepository.js';

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
    db.withTransaction.mockImplementation(async (fn: (tx: DbMock) => unknown) => fn(db));
    return db;
};

const make = (db: DbMock) => new ExcecaoDestinoRepository(db as unknown as PostgreeDatabaseClient);

const CONTA: DestinoManual = {
    tipo: 'CONTA',
    bancoCod: '237',
    agencia: '1234',
    conta: '99887766',
    contaDv: '1',
    titularDocumento: '11144477735',
};
const CHAVE: DestinoManual = {
    tipo: 'CHAVE_PIX',
    chavePixTipo: 'CPF_CNPJ',
    chavePix: '11144477735',
    titularDocumento: '11144477735',
};

const row = (over: Record<string, unknown> = {}) => ({
    id: 'E1',
    pes_cod: '7001',
    fil_cod: 1,
    tipo: 'CONTA',
    banco_cod: '237',
    agencia: '1234',
    agencia_dv: null,
    conta: '99887766',
    conta_dv: '1',
    chave_pix_tipo: null,
    chave_pix: null,
    titular_documento: '11144477735',
    estado: 'PENDENTE',
    origem: 'MANUAL',
    carga_id: null,
    justificativa: 'cadastro desatualizado',
    cadastrado_por: 'ana',
    cadastrado_em: new Date('2026-10-05T10:00:00Z'),
    aprovado_por: null,
    aprovado_em: null,
    decidido_por: null,
    decidido_em: null,
    motivo_decisao: null,
    substituida_em: null,
    versao: 1,
    ...over,
});

const sqls = (m: jest.Mock): string[] => m.mock.calls.map(([q]) => String(q));

describe('ExcecaoDestinoRepository (ADR-0061)', () => {
    describe('insert', () => {
        it('UMA transação: grava PENDENTE com o destino em colunas e a trilha CADASTRO', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(row());
            const e = await make(db).insert({
                pesCod: '7001',
                filCod: 1,
                destino: CONTA,
                origem: 'MANUAL',
                justificativa: 'cadastro desatualizado',
                cadastradoPor: 'ana',
            });
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            const [sqlExc, pExc] = db.insert.mock.calls[0];
            expect(sqlExc).toMatch(/INSERT INTO excecao_destino/);
            expect(sqlExc).toMatch(/'PENDENTE'/);
            expect(pExc).toMatchObject({
                pesCod: '7001',
                filCod: 1,
                tipo: 'CONTA',
                bancoCod: '237',
                conta: '99887766',
                chavePix: null,
                titular: '11144477735',
                cadastradoPor: 'ana',
                cargaId: null,
            });
            const [sqlAud, pAud] = db.insert.mock.calls[1];
            expect(sqlAud).toMatch(/INSERT INTO excecao_destino_audit/);
            expect(pAud).toMatchObject({ evento: 'CADASTRO', ator: 'ana' });
            expect(e).toMatchObject({ id: 'E1', estado: 'PENDENTE', pesCod: '7001' });
            expect(e.destino).toEqual(CONTA);
        });

        it('PIX grava a chave e deixa as colunas da conta nulas', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(
                row({
                    tipo: 'CHAVE_PIX',
                    banco_cod: null,
                    agencia: null,
                    conta: null,
                    conta_dv: null,
                    chave_pix_tipo: 'CPF_CNPJ',
                    chave_pix: '11144477735',
                }),
            );
            await make(db).insert({
                pesCod: '7001',
                filCod: 1,
                destino: CHAVE,
                origem: 'MANUAL',
                justificativa: 'j',
                cadastradoPor: 'ana',
            });
            expect(db.insert.mock.calls[0][1]).toMatchObject({
                tipo: 'CHAVE_PIX',
                bancoCod: null,
                conta: null,
                chavePixTipo: 'CPF_CNPJ',
                chavePix: '11144477735',
            });
        });

        it('se a trilha falha, o erro sobe da transação (o estado não persiste)', async () => {
            const db = buildDb();
            db.insert.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('trilha caiu'));
            await expect(
                make(db).insert({
                    pesCod: '7001',
                    filCod: 1,
                    destino: CONTA,
                    origem: 'MANUAL',
                    justificativa: 'j',
                    cadastradoPor: 'ana',
                }),
            ).rejects.toThrow('trilha caiu');
        });
    });

    describe('transition', () => {
        const t = {
            id: 'E1',
            de: 'PENDENTE' as const,
            para: 'REJEITADA' as const,
            evento: 'REJEICAO' as const,
            ator: 'bia',
            motivo: 'conta de terceiro',
        };

        it('UPDATE com WHERE estado = $de e trilha na MESMA transação', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(row({ estado: 'REJEITADA' }));
            await make(db).transition(t);
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            const [sql, params] = db.update.mock.calls[0];
            expect(sql).toMatch(/WHERE id = \$id AND estado = \$de/);
            expect(sql).toMatch(/decidido_por = \$ator/);
            expect(params).toMatchObject({
                id: 'E1',
                de: 'PENDENTE',
                para: 'REJEITADA',
                ator: 'bia',
                motivo: 'conta de terceiro',
            });
            const [, pAud] = db.insert.mock.calls[0];
            expect(pAud).toMatchObject({ evento: 'REJEICAO', ator: 'bia' });
            expect(JSON.parse(pAud.depois)).toMatchObject({
                estado: 'REJEITADA',
                motivo: 'conta de terceiro',
            });
        });

        it('0 linhas afetadas = ExcecaoEstadoInvalidoError e NENHUMA trilha', async () => {
            const db = buildDb();
            db.update.mockResolvedValue(0);
            await expect(make(db).transition(t)).rejects.toBeInstanceOf(ExcecaoEstadoInvalidoError);
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('falha na trilha propaga (a transação do banco desfaz o UPDATE)', async () => {
            const db = buildDb();
            db.insert.mockRejectedValue(new Error('trilha caiu'));
            await expect(make(db).transition(t)).rejects.toThrow('trilha caiu');
        });

        it('aprovação grava aprovado_por/aprovado_em; substituição grava substituida_em', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(row());
            await make(db).transition({
                ...t,
                para: 'APROVADA',
                evento: 'APROVACAO',
                motivo: undefined,
            });
            expect(sqls(db.update)[0]).toMatch(/aprovado_por = \$ator, aprovado_em = now\(\)/);
            await make(db).transition({
                ...t,
                de: 'APROVADA',
                para: 'SUBSTITUIDA',
                evento: 'SUBSTITUICAO',
                motivo: undefined,
            });
            expect(sqls(db.update)[1]).toMatch(/substituida_em = now\(\)/);
        });
    });

    describe('aprovar', () => {
        it('trava a pendente, substitui a APROVADA anterior do mesmo (favorecido, tipo) e aprova — tudo numa transação, com os dois eventos', async () => {
            const db = buildDb();
            db.selectFirst
                .mockResolvedValueOnce({ pes_cod: '7001', tipo: 'CONTA', estado: 'PENDENTE' })
                .mockResolvedValueOnce({ id: 'ANT' })
                .mockResolvedValue(row({ estado: 'APROVADA', aprovado_por: 'bia' }));
            const e = await make(db).aprovar({ id: 'E1', ator: 'bia' });
            expect(db.withTransaction).toHaveBeenCalledTimes(1);
            expect(String(db.selectFirst.mock.calls[0][0])).toMatch(/FOR UPDATE/);
            expect(String(db.selectFirst.mock.calls[1][0])).toMatch(/estado = 'APROVADA'/);
            expect(db.update.mock.calls[0][1]).toMatchObject({ id: 'ANT', para: 'SUBSTITUIDA' });
            expect(db.update.mock.calls[1][1]).toMatchObject({ id: 'E1', para: 'APROVADA' });
            const eventos = db.insert.mock.calls.map(([, p]) => p.evento);
            expect(eventos).toEqual(['SUBSTITUICAO', 'APROVACAO']);
            expect(e.estado).toBe('APROVADA');
        });

        it('sem APROVADA anterior: só a aprovação', async () => {
            const db = buildDb();
            db.selectFirst
                .mockResolvedValueOnce({ pes_cod: '7001', tipo: 'CONTA', estado: 'PENDENTE' })
                .mockResolvedValueOnce(null)
                .mockResolvedValue(row({ estado: 'APROVADA' }));
            await make(db).aprovar({ id: 'E1', ator: 'bia' });
            expect(db.insert.mock.calls.map(([, p]) => p.evento)).toEqual(['APROVACAO']);
        });

        it('não pendente: ExcecaoEstadoInvalidoError, nada escrito', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValueOnce({
                pes_cod: '7001',
                tipo: 'CONTA',
                estado: 'REVOGADA',
            });
            await expect(make(db).aprovar({ id: 'E1', ator: 'bia' })).rejects.toBeInstanceOf(
                ExcecaoEstadoInvalidoError,
            );
            expect(db.update).not.toHaveBeenCalled();
            expect(db.insert).not.toHaveBeenCalled();
        });

        it('inexistente: ExcecaoNaoEncontradaError', async () => {
            const db = buildDb();
            await expect(make(db).aprovar({ id: 'X', ator: 'bia' })).rejects.toBeInstanceOf(
                ExcecaoNaoEncontradaError,
            );
        });

        it('falha na trilha da aprovação propaga: a transação desfaz a substituição também', async () => {
            const db = buildDb();
            db.selectFirst
                .mockResolvedValueOnce({ pes_cod: '7001', tipo: 'CONTA', estado: 'PENDENTE' })
                .mockResolvedValueOnce({ id: 'ANT' });
            db.insert.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('trilha caiu'));
            await expect(make(db).aprovar({ id: 'E1', ator: 'bia' })).rejects.toThrow(
                'trilha caiu',
            );
        });
    });

    describe('leituras', () => {
        it('findAprovada filtra por favorecido, tipo e estado APROVADA', async () => {
            const db = buildDb();
            db.selectFirst.mockResolvedValue(row({ estado: 'APROVADA' }));
            const e = await make(db).findAprovada('7001', 'CONTA');
            const [sql, p] = db.selectFirst.mock.calls[0];
            expect(sql).toMatch(/estado = 'APROVADA'/);
            expect(p).toEqual({ pesCod: '7001', tipo: 'CONTA' });
            expect(e?.estado).toBe('APROVADA');
        });

        it('findAprovada devolve null quando não há', async () => {
            const db = buildDb();
            expect(await make(db).findAprovada('7001', 'CONTA')).toBeNull();
        });

        it('list filtra por estado e favorecido com parâmetros nomeados', async () => {
            const db = buildDb();
            db.selectMany.mockResolvedValue([row()]);
            const r = await make(db).list({ estado: 'PENDENTE', pesCod: '7001' });
            const [sql, p] = db.selectMany.mock.calls[0];
            expect(sql).toMatch(/\$estado/);
            expect(sql).toMatch(/\$pesCod/);
            expect(p).toEqual({ estado: 'PENDENTE', pesCod: '7001' });
            expect(r).toHaveLength(1);
        });

        it('destino inválido no banco: a exceção é descartada com aviso SEM o conteúdo', async () => {
            const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            const db = buildDb();
            db.selectMany.mockResolvedValue([row({ conta: 'abc-9988776655' })]);
            const r = await make(db).list();
            expect(r).toEqual([]);
            expect(warn).toHaveBeenCalled();
            expect(JSON.stringify(warn.mock.calls)).not.toContain('9988776655');
            warn.mockRestore();
        });

        it('listEventos tira o destino da trilha antes de devolver (I10h)', async () => {
            const db = buildDb();
            db.selectMany.mockResolvedValue([
                {
                    id: 'A1',
                    excecao_id: 'E1',
                    evento: 'APROVACAO',
                    ator: 'bia',
                    ocorrido_em: new Date('2026-10-05T11:00:00Z'),
                    depois: { estado: 'APROVADA' },
                },
            ]);
            const r = await make(db).listEventos('E1');
            expect(String(db.selectMany.mock.calls[0][0])).toMatch(/\(depois - 'destino'\)/);
            expect(r[0]).toMatchObject({ evento: 'APROVACAO', ator: 'bia' });
        });

        it('contarPorEstado zera os estados ausentes', async () => {
            const db = buildDb();
            db.selectMany.mockResolvedValue([{ estado: 'PENDENTE', n: 3 }]);
            expect(await make(db).contarPorEstado()).toEqual({
                PENDENTE: 3,
                APROVADA: 0,
                REJEITADA: 0,
                SUBSTITUIDA: 0,
                REVOGADA: 0,
            });
        });
    });

    describe('appendAudit / marcarUso', () => {
        it('só INSERT na trilha (nunca UPDATE/DELETE) e sem o destino em claro no USO', async () => {
            const db = buildDb();
            await make(db).marcarUso({ excecaoId: 'E1', ator: 'sistema', loteId: 'L1' });
            const [sql, p] = db.insert.mock.calls[0];
            expect(sql).toMatch(/INSERT INTO excecao_destino_audit/);
            expect(p).toMatchObject({ evento: 'USO', ator: 'sistema' });
            expect(JSON.parse(p.depois)).toEqual({ loteId: 'L1' });
            expect(db.update).not.toHaveBeenCalled();
        });
    });

    it('nenhuma query interpola valor: só parâmetros nomeados ($nome)', () => {
        // O texto do SQL é montado só a partir de constantes; os valores vão no objeto de params.
        const db = buildDb();
        db.selectFirst.mockResolvedValue(row());
        return make(db)
            .getById('E1')
            .then(() => {
                expect(String(db.selectFirst.mock.calls[0][0])).toMatch(/\$id/);
                expect(String(db.selectFirst.mock.calls[0][0])).not.toContain('E1');
            });
    });
});

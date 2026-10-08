import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import AuthorizedPayeeActiveExistsError from '../../errors/AuthorizedPayeeActiveExistsError.js';
import AuthorizedPayeeRepository from './AuthorizedPayeeRepository.js';

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

const make = (db: DbMock) => new AuthorizedPayeeRepository(db as unknown as PostgreeDatabaseClient);

const ROW = {
    id: 'a1',
    pes_cod: '7001',
    credor: 'ACME',
    modalidade: 'TED',
    estado: 'AUTORIZADO',
    fingerprint: 'fp',
    fingerprint_chave_id: 'v1',
    destino_mascarado: 'banco 237 · ag. 1 · cc ****4321-0',
    avisos: [],
    fingerprint_observado: null,
    destino_observado_mascarado: null,
    origem_solicitacao: 'MANUAL',
    fil_cod_leitura: 1,
    solicitado_por: 'ana',
    solicitado_em: new Date('2026-10-08T10:00:00Z'),
    decidido_por: 'bia',
    decidido_em: new Date('2026-10-08T11:00:00Z'),
    motivo_decisao: null,
    ultima_conferencia_em: null,
    ultima_conferencia_resultado: null,
    criado_em: new Date('2026-10-08T10:00:00Z'),
    versao: 2,
};

/** Nenhum valor é interpolado: todo dado entra como parâmetro nomeado. */
const semInterpolacao = (sql: string): void => {
    expect(sql).not.toMatch(/'7001'|'ana'|'TED'/);
};

describe('AuthorizedPayeeRepository (ADR-0065)', () => {
    it('buscarVigente: parametrizado, só os estados vigentes, mapeia a linha (nulos viram ausência)', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValue(ROW);
        const r = await make(db).buscarVigente('7001', 'TED');
        const [sql, params] = db.selectFirst.mock.calls[0];
        semInterpolacao(sql);
        expect(sql).toMatch(/estado = ANY\(\$ativos::text\[\]\)/);
        expect(params).toEqual({
            pesCod: '7001',
            modalidade: 'TED',
            ativos: ['PENDENTE', 'AUTORIZADO', 'REAPROVACAO_PENDENTE'],
        });
        expect(r).toMatchObject({
            id: 'a1',
            pesCod: '7001',
            estado: 'AUTORIZADO',
            fingerprintChaveId: 'v1',
            solicitadoEm: '2026-10-08T10:00:00.000Z',
            versao: 2,
        });
        expect(r).not.toHaveProperty('motivoDecisao');
    });

    it('listarVigentesPorPesCods: UMA consulta para todos, deduplicada; vazio não consulta', async () => {
        const db = buildDb();
        await make(db).listarVigentesPorPesCods([]);
        expect(db.selectMany).not.toHaveBeenCalled();
        await make(db).listarVigentesPorPesCods(['1', '2', '1']);
        expect(db.selectMany).toHaveBeenCalledTimes(1);
        expect(db.selectMany.mock.calls[0][1].pesCods).toEqual(['1', '2']);
    });

    it('inserir: estado fixo PENDENTE no SQL, ator nos parâmetros', async () => {
        const db = buildDb();
        const id = await make(db).inserir({
            pesCod: '7001',
            modalidade: 'TED',
            origemSolicitacao: 'ITEM',
            filCodLeitura: 2,
            solicitadoPor: 'ana',
        });
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        const [sql, params] = db.insert.mock.calls[0];
        semInterpolacao(sql);
        expect(sql).toMatch(/'PENDENTE'/);
        expect(params).toMatchObject({ pesCod: '7001', solicitadoPor: 'ana', filCod: 2 });
    });

    it('inserir: violação do índice de vigência (23505) vira AuthorizedPayeeActiveExistsError (409)', async () => {
        const db = buildDb();
        db.insert.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));
        await expect(
            make(db).inserir({
                pesCod: '7001',
                modalidade: 'PIX',
                origemSolicitacao: 'MANUAL',
                filCodLeitura: 1,
                solicitadoPor: 'ana',
            }),
        ).rejects.toBeInstanceOf(AuthorizedPayeeActiveExistsError);
    });

    it('atualizarComVersao: WHERE id + versao, versao + 1, só as colunas do patch, null limpa', async () => {
        const db = buildDb();
        db.update.mockResolvedValue(0);
        const n = await make(db).atualizarComVersao('a1', 3, {
            estado: 'REAPROVACAO_PENDENTE',
            solicitadoPor: null,
            avisos: ['PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO'],
        });
        expect(n).toBe(0);
        const [sql, params] = db.update.mock.calls[0];
        expect(sql).toMatch(/WHERE id = \$id AND versao = \$versao/);
        expect(sql).toMatch(/versao = versao \+ 1/);
        expect(sql).toMatch(/estado = \$p_estado/);
        expect(sql).toMatch(/solicitado_por = \$p_solicitadoPor/);
        expect(sql).toMatch(/avisos = \$p_avisos::jsonb/);
        expect(sql).not.toMatch(/fingerprint/);
        expect(params).toEqual({
            id: 'a1',
            versao: 3,
            p_estado: 'REAPROVACAO_PENDENTE',
            p_solicitadoPor: null,
            p_avisos: '["PIX_CHAVE_NAO_E_DOCUMENTO_DO_FAVORECIDO"]',
        });
    });

    it('registrarEvento: só INSERT, dados em JSON', async () => {
        const db = buildDb();
        await make(db).registrarEvento({
            autorizacaoId: 'a1',
            evento: 'APROVADO',
            ator: 'bia',
            dados: { destinoMascarado: 'banco 237 · cc ****4321-0' },
        });
        const [sql, params] = db.insert.mock.calls[0];
        expect(sql).toMatch(/^INSERT INTO sispag_favorecido_autorizado_evento/);
        expect(params.dados).toBe('{"destinoMascarado":"banco 237 · cc ****4321-0"}');
        expect(db.update).not.toHaveBeenCalled();
    });
});

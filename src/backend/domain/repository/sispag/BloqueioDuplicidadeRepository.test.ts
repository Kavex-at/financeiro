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

describe('BloqueioDuplicidadeRepository — origem por código de barras (ADR-0069 emenda 1, I16g)', () => {
    const MANTIDO = { filCod: 4, docCod: '6701', titCod: '1' };

    it('criar com origem de código de barras aceita sem alertaId e grava máscara + título mantido', async () => {
        const db = buildDb();
        const id = await make(db).criar(
            {
                chave: CHAVE,
                loteIdOrigem: 'L1',
                motivo: 'boleto repetido no lote',
                ator: 'sistema',
                origem: 'CODIGO_BARRAS_REPETIDO',
                codigoMascarado: '34191…5555',
                tituloMantido: MANTIDO,
            },
            db as never,
        );
        const [sql, params] = db.insert.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/origem[\s\S]*codigo_mascarado[\s\S]*titulo_mantido_fil_cod/);
        expect(String(sql)).toMatch(
            /ON CONFLICT \(fil_cod, doc_cod, tit_cod\) WHERE estado = 'ATIVO'/,
        );
        expect(params).toMatchObject({
            id,
            ...CHAVE,
            alertaId: null,
            origem: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: '34191…5555',
            mantidoFilCod: 4,
            mantidoDocCod: '6701',
            mantidoTitCod: '1',
        });
        expect(eventos(db)).toEqual([
            expect.objectContaining({ evento: 'BLOQUEIO_CRIADO', bloqueioId: id, ator: 'sistema' }),
        ]);
        const dados = JSON.parse(String(eventos(db)[0]?.dados));
        expect(dados).toMatchObject({
            origem: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: '34191…5555',
        });
    });

    it('DUPLICIDADE_TITULO sem alertaId continua inválido', async () => {
        const db = buildDb();
        await expect(
            make(db).criar(
                { chave: CHAVE, loteIdOrigem: 'L1', motivo: 'x', ator: 'ana' },
                db as never,
            ),
        ).rejects.toThrow(/alertaId/);
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('recusa máscara que não é 5+4 (nunca o código completo)', async () => {
        const db = buildDb();
        await expect(
            make(db).criar(
                {
                    chave: CHAVE,
                    loteIdOrigem: 'L1',
                    motivo: 'x',
                    ator: 'sistema',
                    origem: 'CODIGO_BARRAS_REPETIDO',
                    codigoMascarado: '1'.repeat(44),
                },
                db as never,
            ),
        ).rejects.toThrow(/mascarad/i);
        expect(db.insert).not.toHaveBeenCalled();
    });

    it('marca ATIVA preexistente de outra origem não é sobrescrita nem gera evento', async () => {
        const db = buildDb();
        db.insert.mockResolvedValueOnce(0);
        db.selectFirst.mockResolvedValueOnce(row({ id: 'B0', origem: 'DUPLICIDADE_TITULO' }));
        const id = await make(db).criar(
            {
                chave: CHAVE,
                loteIdOrigem: 'L1',
                motivo: 'x',
                ator: 'sistema',
                origem: 'CODIGO_BARRAS_REPETIDO',
                codigoMascarado: '34191…5555',
            },
            db as never,
        );
        expect(id).toBe('B0');
        expect(eventos(db)).toEqual([]);
    });

    it('map devolve origem, máscara e título mantido; linha legada vira DUPLICIDADE_TITULO', async () => {
        const db = buildDb();
        db.selectFirst.mockResolvedValueOnce(
            row({
                origem: 'CODIGO_BARRAS_REPETIDO',
                codigo_mascarado: '34191…5555',
                titulo_mantido_fil_cod: 4,
                titulo_mantido_doc_cod: '6701',
                titulo_mantido_tit_cod: '1',
            }),
        );
        expect(await make(db).findAtivo(CHAVE)).toMatchObject({
            origem: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: '34191…5555',
            tituloMantido: MANTIDO,
        });
        const legado = buildDb();
        legado.selectFirst.mockResolvedValueOnce(row());
        const b = await make(legado).findAtivo(CHAVE);
        expect(b?.origem).toBe('DUPLICIDADE_TITULO');
        expect(b?.codigoMascarado).toBeUndefined();
        expect(b?.tituloMantido).toBeUndefined();
    });

    it('encerrarPorSinaisDeCodigoDeBarras: só as origens de código, só sinais baratos, um evento por marca', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([
            { id: 'B1', fil_cod: 4, doc_cod: '6702', tit_cod: '1', lote_id_origem: 'L1' },
        ]);
        expect(await make(db).encerrarPorSinaisDeCodigoDeBarras()).toBe(1);
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        const [sql, params] = db.selectMany.mock.calls[0] ?? [];
        // (a) item mantido inativo/pago; (b) lote de origem CANCELADO sem remessa gerada.
        expect(String(sql)).toMatch(/k\.ativo = FALSE OR k\.pago = TRUE/);
        expect(String(sql)).toMatch(/l\.status = 'CANCELADO'[\s\S]*l\.remessa_gerada_em IS NULL/);
        // Nenhum sinal caro (fin124/boleto mudou) nem a duplicidade de título.
        expect(String(sql)).not.toMatch(/fin124|titVldReflexoDdaAssoc/);
        expect(params).toMatchObject({
            ativo: 'ATIVO',
            encerrado: 'ENCERRADO',
            origens: [
                'CODIGO_BARRAS_REPETIDO',
                'CODIGO_BARRAS_ILEGIVEL',
                'VINCULO_CODIGO_BARRAS_FALHOU',
            ],
        });
        expect(eventos(db)).toEqual([
            expect.objectContaining({
                evento: 'BLOQUEIO_ENCERRADO',
                ator: 'sistema',
                bloqueioId: 'B1',
                loteId: 'L1',
            }),
        ]);
    });

    it('listAtivosPorOrigemComTitulo junta credor/valor/vencimento e mapeia a origem', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([
            {
                ...row({
                    origem: 'CODIGO_BARRAS_REPETIDO',
                    codigo_mascarado: '34191…5555',
                    titulo_mantido_fil_cod: 4,
                    titulo_mantido_doc_cod: '6701',
                    titulo_mantido_tit_cod: '1',
                }),
                t_credor: 'PEDRONI',
                t_valor: '1412.00',
                t_vencimento: new Date('2026-10-20T00:00:00Z'),
            },
        ]);
        const r = await make(db).listAtivosPorOrigemComTitulo(['CODIGO_BARRAS_REPETIDO']);
        expect(r[0]).toMatchObject({
            origem: 'CODIGO_BARRAS_REPETIDO',
            codigoMascarado: '34191…5555',
            credor: 'PEDRONI',
            valor: 1412,
            vencimento: '2026-10-20',
        });
        const [sql] = db.selectMany.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/LEFT JOIN titulo_a_pagar t/);
        expect(String(sql)).toMatch(/b\.origem = ANY\(\$origens\)/);
    });

    it('listAtivosPorOrigem filtra por origem(ns) e por estado ATIVO', async () => {
        const db = buildDb();
        db.selectMany.mockResolvedValueOnce([row({ origem: 'CODIGO_BARRAS_REPETIDO' })]);
        const r = await make(db).listAtivosPorOrigem([
            'CODIGO_BARRAS_REPETIDO',
            'CODIGO_BARRAS_ILEGIVEL',
        ]);
        expect(r).toHaveLength(1);
        const [sql, params] = db.selectMany.mock.calls[0] ?? [];
        expect(String(sql)).toMatch(/estado = \$ativo[\s\S]*origem = ANY\(\$origens\)/);
        expect(params).toEqual({
            ativo: 'ATIVO',
            origens: ['CODIGO_BARRAS_REPETIDO', 'CODIGO_BARRAS_ILEGIVEL'],
        });
    });
});

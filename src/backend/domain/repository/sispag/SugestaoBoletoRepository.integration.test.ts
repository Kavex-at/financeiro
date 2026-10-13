import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import SqlBuilder from '../../libs/sql/SqlBuilder.js';
import SugestaoBoletoRepository, {
    type NovaDecisao,
    type NovoPar,
} from './SugestaoBoletoRepository.js';

/**
 * `SugestaoBoletoRepository` contra um Postgres DE VERDADE com todas as migrations aplicadas
 * (ADR-0068, 0084). Roda no `npm run test:sql` (ver `migrations/0084_*.integration.test.ts`).
 * O DSN precisa ser LOCAL: o teste apaga e recria o banco `sispag_sug_boleto_repo_it`.
 */
jest.setTimeout(180_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
const BANCO = 'sispag_sug_boleto_repo_it';
const MIGRATIONS = path.join(__dirname, '../../../migrations');

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

/** Adaptador mínimo do `PostgreeDatabaseClient` sobre um `pg.Client` (mesmo SqlBuilder). */
const adaptar = (db: Client): PostgreeDatabaseClient => {
    const sb = new SqlBuilder();
    const run = async (q: string, p?: Record<string, unknown>) => {
        const { query, params } = p ? sb.build(q, p) : { query: q, params: undefined };
        return db.query(query, params as unknown[] | undefined);
    };
    return {
        selectMany: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rows,
        selectFirst: async (q: string, p?: Record<string, unknown>) =>
            (await run(q, p)).rows[0] ?? null,
        insert: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rowCount ?? 0,
        update: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rowCount ?? 0,
    } as unknown as PostgreeDatabaseClient;
};

const par = (over: Partial<NovoPar> = {}): NovoPar => ({
    pesCod: '7001',
    credor: 'ACME',
    emissorChave: '341:1234:12345',
    layoutEmissor: 'ITAU_341',
    bancoEmissor: '341',
    emissorMascarado: '341 / 1234 / ***2345',
    evidencia: { tier: 'FORTE' },
    confirmadoPor: 'ana',
    ...over,
});

const decisao = (parId: string, over: Partial<NovaDecisao> = {}): NovaDecisao => ({
    filCod: 2,
    docCod: '9001',
    titCod: '1',
    pesCod: '7001',
    ddcCod: 10,
    ditCod: 3,
    codbarMascarado: '341…0100',
    valorTitulo: 100,
    vencimentoTitulo: '2026-10-20',
    valorBoleto: 100.03,
    vencimentoBoleto: '2026-10-20',
    deltaValor: 0.03,
    deltaPercentual: 0.03,
    deltaDias: 0,
    sinais: ['MESMO_DIA'],
    tier: 'FORTE',
    emissorChave: '341:1234:12345',
    decisao: 'CONFIRMADA',
    decididoPor: 'ana',
    confirmacaoEmissorId: parId,
    ...over,
});

describeComBanco('SugestaoBoletoRepository — integração (ADR-0068)', () => {
    let db: Client;
    let db2: Client;
    let repo: SugestaoBoletoRepository;
    let repo2: SugestaoBoletoRepository;

    beforeAll(async () => {
        const dsn = ADMIN_DSN ?? '';
        if (!['localhost', '127.0.0.1', '::1'].includes(new URL(dsn).hostname)) {
            throw new Error('METRICAS_CICLO_TEST_DSN precisa ser local');
        }
        const raiz = new Client({ connectionString: dsn });
        await raiz.connect();
        await raiz.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
        await raiz.query(`CREATE DATABASE ${BANCO}`);
        await raiz.end();
        const url = new URL(dsn);
        url.pathname = `/${BANCO}`;
        db = new Client({ connectionString: url.toString() });
        db2 = new Client({ connectionString: url.toString() });
        await db.connect();
        await db2.connect();
        for (const f of readdirSync(MIGRATIONS)
            .filter((n) => /^\d{4}_.*\.sql$/.test(n))
            .sort()) {
            await db.query(readFileSync(path.join(MIGRATIONS, f), 'utf8'));
        }
        repo = new SugestaoBoletoRepository(adaptar(db));
        repo2 = new SugestaoBoletoRepository(adaptar(db2));
    });

    afterAll(async () => {
        await db?.end();
        await db2?.end();
    });

    it('par: duas confirmações concorrentes do mesmo (credor, emissor) → uma linha, a perdedora relê', async () => {
        const [a, b] = await Promise.all([
            repo.inserirPar(par({ pesCod: '8001' })),
            repo2.inserirPar(par({ pesCod: '8001', confirmadoPor: 'bia' })),
        ]);
        expect([a.criado, b.criado].filter(Boolean)).toHaveLength(1);
        expect(a.par.id).toBe(b.par.id);
        const n = await db.query(
            "SELECT count(*)::int AS n FROM sispag_confirmacao_emissor_boleto WHERE pes_cod = '8001' AND estado = 'VIGENTE'",
        );
        expect(n.rows[0].n).toBe(1);
    });

    it('par: revogar com versão, reconfirmar cria linha nova; versão velha não revoga', async () => {
        const { par: p } = await repo.inserirPar(par({ pesCod: '8002' }));
        expect(
            await repo.revogarPar({ id: p.id, versaoEsperada: 99, ator: 'bia', motivo: 'x' }),
        ).toBe(0);
        expect(
            await repo.revogarPar({
                id: p.id,
                versaoEsperada: 1,
                ator: 'bia',
                motivo: 'conta trocada',
            }),
        ).toBe(1);
        expect(
            await repo.revogarPar({ id: p.id, versaoEsperada: 2, ator: 'cid', motivo: 'de novo' }),
        ).toBe(0);
        const revogada = await repo.buscarParPorId(p.id);
        expect(revogada).toMatchObject({
            estado: 'REVOGADA',
            revogadoPor: 'bia',
            motivoRevogacao: 'conta trocada',
            versao: 2,
        });
        expect(await repo.buscarParVigente('8002', '341:1234:12345')).toBeNull();
        const novo = await repo.inserirPar(par({ pesCod: '8002' }));
        expect(novo.criado).toBe(true);
        expect(novo.par.id).not.toBe(p.id);
    });

    it('decisão: duas confirmações concorrentes do mesmo título → uma linha; a perdedora relê a vencedora', async () => {
        const { par: p } = await repo.inserirPar(par({ pesCod: '8003' }));
        const d = (boleto: number) =>
            decisao(p.id, { pesCod: '8003', docCod: '5001', ddcCod: 20, ditCod: boleto });
        const [a, b] = await Promise.all([repo.inserirDecisao(d(1)), repo2.inserirDecisao(d(2))]);
        expect([a.criada, b.criada].filter(Boolean)).toHaveLength(1);
        expect(a.decisao.id).toBe(b.decisao.id);
        const n = await db.query(
            "SELECT count(*)::int AS n FROM sispag_decisao_sugestao_boleto WHERE doc_cod = '5001'",
        );
        expect(n.rows[0].n).toBe(1);
    });

    it('decisão: reconfirmar o mesmo (título, boleto) devolve a existente; boleto de outro título volta o dono', async () => {
        const { par: p } = await repo.inserirPar(par({ pesCod: '8004' }));
        const base = decisao(p.id, { pesCod: '8004', docCod: '5002', ddcCod: 30, ditCod: 1 });
        const primeira = await repo.inserirDecisao(base);
        expect(primeira.criada).toBe(true);
        const repetida = await repo.inserirDecisao(base);
        expect(repetida.criada).toBe(false);
        expect(repetida.decisao.id).toBe(primeira.decisao.id);
        // Mesmo boleto, outro título: o índice único por boleto recusa e devolve a dona.
        const outro = await repo.inserirDecisao({ ...base, titCod: '2' });
        expect(outro.criada).toBe(false);
        expect(outro.decisao.id).toBe(primeira.decisao.id);
        expect(outro.decisao).toMatchObject({ docCod: '5002', titCod: '1' });
    });

    it('decisão: rejeição relê por (título, boleto) e convive com a confirmação de outro boleto', async () => {
        const { par: p } = await repo.inserirPar(par({ pesCod: '8005' }));
        const { confirmacaoEmissorId: _c, ...semPar } = decisao(p.id, {
            pesCod: '8005',
            docCod: '5003',
            ddcCod: 40,
            ditCod: 1,
        });
        const rej = { ...semPar, decisao: 'REJEITADA' as const, motivo: 'outro credor' };
        const a = await repo.inserirDecisao(rej);
        const b = await repo.inserirDecisao(rej);
        expect(a.criada).toBe(true);
        expect(b.criada).toBe(false);
        expect(b.decisao.id).toBe(a.decisao.id);
        const conf = await repo.inserirDecisao(
            decisao(p.id, { pesCod: '8005', docCod: '5003', ddcCod: 40, ditCod: 2 }),
        );
        expect(conf.criada).toBe(true);
        const listadas = await repo.listarDecisoes({ docCod: '5003' });
        expect(listadas.map((x) => x.decisao).sort()).toEqual(['CONFIRMADA', 'REJEITADA']);
        const confirmadas = await repo.listarChaveadas('CONFIRMADA');
        expect(confirmadas).toContainEqual({
            filCod: 2,
            docCod: '5003',
            titCod: '1',
            ddcCod: 40,
            ditCod: 2,
        });
    });

    it('decisão: mapeia numéricos e datas civis sem deslocar o dia', async () => {
        const { par: p } = await repo.inserirPar(par({ pesCod: '8006' }));
        const { decisao: d } = await repo.inserirDecisao(
            decisao(p.id, { pesCod: '8006', docCod: '5004', ddcCod: 50, ditCod: 1 }),
        );
        expect(d).toMatchObject({
            valorTitulo: 100,
            valorBoleto: 100.03,
            deltaValor: 0.03,
            vencimentoTitulo: '2026-10-20',
            vencimentoBoleto: '2026-10-20',
            sinais: ['MESMO_DIA'],
            tier: 'FORTE',
            confirmacaoEmissorId: p.id,
        });
    });

    it('trilha: inserirEvento grava e a trilha recusa UPDATE/DELETE (append-only)', async () => {
        const id = await repo.inserirEvento({
            tipo: 'LINHA_COPIADA',
            ator: 'ana',
            filCod: 2,
            docCod: '5004',
            titCod: '1',
            ddcCod: 50,
            ditCod: 1,
            detalhe: { codbarMascarado: '341…0100' },
        });
        const eventos = await repo.listarEventos({ tipo: 'LINHA_COPIADA', docCod: '5004' });
        expect(eventos).toHaveLength(1);
        expect(eventos[0]).toMatchObject({ id, ator: 'ana', ddcCod: 50 });
        await expect(
            db.query('UPDATE sispag_sugestao_boleto_evento SET ator = $1 WHERE id = $2', ['x', id]),
        ).rejects.toThrow(/so de inclusao/);
        await expect(
            db.query('DELETE FROM sispag_sugestao_boleto_evento WHERE id = $1', [id]),
        ).rejects.toThrow(/so de inclusao/);
    });

    it('nenhuma coluna das três tabelas guarda 44 dígitos seguidos', async () => {
        const { rows } = await db.query(
            `SELECT (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM sispag_confirmacao_emissor_boleto t)::text
                 || (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM sispag_decisao_sugestao_boleto t)::text
                 || (SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM sispag_sugestao_boleto_evento t)::text AS tudo`,
        );
        expect(rows[0].tudo).not.toMatch(/\d{44}/);
    });
});

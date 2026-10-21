import 'reflect-metadata';
import { Client } from 'pg';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * ADR-0076 (I19j/I3) contra um Postgres DE VERDADE: o lock TRANSACIONAL que `incluirGrupo` toma
 * nas chaves I3 dos títulos exclui o lock de SESSÃO que `incluirTitulo` tenta na mesma chave —
 * incluir o grupo e incluir um título dele avulso nunca correm juntos. Roda no `npm run test:sql`
 * com DSN LOCAL; não precisa de schema.
 */

jest.setTimeout(60_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('LotePagamentoRepository.travarTitulosNaTransacao (integração)', () => {
    let pool: PostgreeDatabaseClient;
    let repo: LotePagamentoRepository;
    let outra: Client;

    beforeAll(async () => {
        const dsn = ADMIN_DSN ?? '';
        const host = new URL(dsn).hostname;
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
            throw new Error(`METRICAS_CICLO_TEST_DSN precisa ser local; recebido host "${host}"`);
        }
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsn }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        const eventos = new VerificacaoEventoRepository(pool);
        repo = new LotePagamentoRepository(
            pool,
            eventos,
            new BloqueioDuplicidadeRepository(pool, eventos),
        );
        outra = new Client({ connectionString: dsn });
        await outra.connect();
    });

    afterAll(async () => {
        await outra?.end();
        await pool?.close();
    });

    const tentarSessao = async (chave: number): Promise<boolean> => {
        const r = await outra.query('SELECT pg_try_advisory_lock($1) AS ok', [chave]);
        const ok = r.rows[0]?.ok === true;
        if (ok) await outra.query('SELECT pg_advisory_unlock($1)', [chave]);
        return ok;
    };

    it('com a transação aberta, o lock de sessão na mesma chave (incluirTitulo) falha; depois do COMMIT, passa', async () => {
        const chave = -123_456_789; // chaves I3 são int32 com sinal (hash de filCod:docCod:titCod)
        let duranteATransacao: boolean | undefined;
        await pool.withTransaction(async (tx) => {
            await repo.travarTitulosNaTransacao([chave, 42], tx);
            duranteATransacao = await tentarSessao(chave);
        });
        expect(duranteATransacao).toBe(false);
        expect(await tentarSessao(chave)).toBe(true);
    });

    it('com o lock de sessão tomado (incluirTitulo em curso), a transação do grupo espera até ele soltar', async () => {
        const chave = 987_654;
        await outra.query('SELECT pg_advisory_lock($1)', [chave]);
        let travou = false;
        const grupo = pool.withTransaction(async (tx) => {
            await repo.travarTitulosNaTransacao([chave], tx);
            travou = true;
        });
        await new Promise((r) => setTimeout(r, 300));
        expect(travou).toBe(false);
        await outra.query('SELECT pg_advisory_unlock($1)', [chave]);
        await grupo;
        expect(travou).toBe(true);
    });
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { ETAPA_STATUS, STATUS_WORKFLOW } from '../domain/interface/aprovacoes/constants.js';
import type { EtapaAprovacao } from '../domain/interface/aprovacoes/EtapaAprovacao.js';
import type { TituloAprovacao } from '../domain/interface/aprovacoes/TituloAprovacao.js';
import EtapaAprovacaoRepository from '../domain/repository/aprovacoes/EtapaAprovacaoRepository.js';
import TituloAprovacaoRepository from '../domain/repository/aprovacoes/TituloAprovacaoRepository.js';

/**
 * Verificação do SQL da Frente V contra um **PostgreSQL de verdade**, sem Docker.
 *
 * ## Por que existe, e por que é script em vez de teste
 *
 * A revisão de arquitetura marcou como P0 o fato de a migration `0049` nunca ter sido aplicada: ela
 * estrearia em produção sem que sintaxe, tipos ou CHECK jamais tivessem sido exercitados. O
 * `AprovacoesSql.test.ts` valida só consistência de parâmetros nomeados.
 *
 * A forma natural seria um `*.integration.test.ts`, mas o `embedded-postgres` é ESM puro e o jest do
 * projeto transforma apenas `.ts` para CJS. Fazê-lo transformar ESM de `node_modules` exigiria mexer
 * na config compartilhada por todas as frentes — blast radius desproporcional para uma
 * devDependency de uma verificação. Como script rodado por `tsx` (que executa ESM nativamente), o
 * mesmo valor é obtido com risco zero para as outras suítes.
 *
 * ## Sem Docker, de propósito
 *
 * `embedded-postgres` baixa os binários oficiais e os roda como processo filho (~108 MB, uma vez).
 * Não precisa de Docker Desktop, que custaria vários GB e uma VM.
 *
 * Uso: `npm run verify:sql-aprovacoes`
 */

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(DIR, '../migrations/0049_aprovacao_trilha.sql');
const PORT = Number(process.env.VERIFY_PG_PORT ?? 55491);

let falhas = 0;
const checar = (nome: string, condicao: boolean, detalhe = ''): void => {
    if (condicao) {
        console.log(`  ok   ${nome}`);
    } else {
        falhas += 1;
        console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
    }
};

const esperaErro = async (nome: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
        await fn();
        falhas += 1;
        console.error(`  FALHA ${nome} — deveria ter sido rejeitado e não foi`);
    } catch {
        console.log(`  ok   ${nome}`);
    }
};

/** Dublê do `PostgreeDatabaseClient` sobre um `pg.Client` real, com parâmetros nomeados. */
const criarDatabaseClient = (c: Client) => {
    const traduzir = (query: string, params: Record<string, unknown> = {}) => {
        const indices = new Map<string, number>();
        const valores: unknown[] = [];
        const convertida = query.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, nome: string) => {
            if (!indices.has(nome)) {
                valores.push(params[nome]);
                indices.set(nome, valores.length);
            }
            return `$${indices.get(nome)}`;
        });
        return { convertida, valores };
    };
    const run = async (query: string, params?: Record<string, unknown>) => {
        const { convertida, valores } = traduzir(query, params);
        return c.query(convertida, valores);
    };
    return {
        selectMany: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rows,
        selectFirst: async (q: string, p?: Record<string, unknown>) =>
            (await run(q, p)).rows[0] ?? null,
        update: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rowCount ?? 0,
        insert: async (q: string, p?: Record<string, unknown>) => (await run(q, p)).rowCount ?? 0,
        withTransaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
            await c.query('BEGIN');
            try {
                const r = await fn({
                    update: run,
                    selectMany: async (q: string, p?: Record<string, unknown>) =>
                        (await run(q, p)).rows,
                });
                await c.query('COMMIT');
                return r;
            } catch (e) {
                await c.query('ROLLBACK');
                throw e;
            }
        },
    };
};

const titulo = (over: Partial<TituloAprovacao> = {}): TituloAprovacao => ({
    filCod: 1,
    docCod: 4156,
    titCod: 1,
    documentoNumero: '17',
    fornecedorCod: 5129,
    fornecedorNome: 'CLONEX TECNOLOGIA LTDA',
    valor: 11125,
    dataEmissao: new Date('2026-04-14T00:00:00Z'),
    statusWorkflow: STATUS_WORKFLOW.APROVADO,
    etapasConcluidas: 1,
    etapasTotais: 1,
    lacunas: [],
    ativo: true,
    observadoEm: new Date('2026-08-19T12:00:00Z'),
    ...over,
});

const etapa = (over: Partial<EtapaAprovacao> = {}): EtapaAprovacao => ({
    filCod: 1,
    docCod: 4156,
    titCod: 1,
    fblCod: 6,
    ftbCod: 1,
    nome: 'CONTROLLER',
    alcada: 'COMPRAS',
    acao: 'LIBERAR',
    responsavelNome: 'DANILO_LARA',
    statusErp: 2,
    status: ETAPA_STATUS.CONCLUIDA,
    recebidoEm: new Date(1778753566000),
    agidoEm: new Date(1778838100000),
    duracaoSegundos: 84534,
    ativo: true,
    observadoEm: new Date('2026-08-19T12:00:00Z'),
    ...over,
});

const main = async (): Promise<void> => {
    const pg = new EmbeddedPostgres({
        databaseDir: path.resolve(DIR, '../.pg-verify'),
        user: 'postgres',
        password: 'postgres',
        port: PORT,
        persistent: false,
    });

    console.log('Subindo PostgreSQL embarcado...');
    await pg.initialise();
    await pg.start();

    const admin = pg.getPgClient();
    await admin.connect();
    // `TEMPLATE template0` + UTF8 é obrigatório: num Windows com locale pt-BR o `initdb` cria o
    // cluster em WIN1252, e a migration — que tem caracteres de caixa nos comentários — falha com
    // "no equivalent in encoding WIN1252". Produção (Supabase/Linux) já é UTF8.
    await admin.query(`CREATE DATABASE aprovacoes WITH ENCODING 'UTF8' TEMPLATE template0`);
    await admin.end();

    const c = new Client({
        host: '127.0.0.1',
        port: PORT,
        user: 'postgres',
        password: 'postgres',
        database: 'aprovacoes',
    });
    await c.connect();
    await c.query("SET client_encoding TO 'UTF8'");

    const sql = readFileSync(MIGRATION, 'utf8');

    console.log('\n── Migration 0049 ──');
    await c.query(sql);
    console.log('  ok   aplica sem erro de sintaxe');
    await c.query(sql);
    console.log('  ok   reaplicar é inofensivo (idempotente)');

    const tabelas = await c.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_name LIKE 'aprovacao%' ORDER BY 1`,
    );
    checar(
        'cria as três tabelas',
        tabelas.rows.length === 3,
        `encontradas: ${tabelas.rows.map((r) => r.table_name).join(', ')}`,
    );

    const indices = await c.query(
        `SELECT count(*)::int n FROM pg_indexes WHERE tablename LIKE 'aprovacao%'`,
    );
    checar('cria os índices', indices.rows[0].n >= 10, `${indices.rows[0].n} índices`);

    console.log('\n── Constraints ──');
    await esperaErro('CHECK de status_workflow rejeita valor fora do domínio', () =>
        c.query(
            `INSERT INTO aprovacao_titulo (fil_cod, doc_cod, tit_cod, status_workflow)
             VALUES (9, 9, 9, 'QUALQUER_COISA')`,
        ),
    );
    await esperaErro('CHECK de status de etapa rejeita valor fora do domínio', () =>
        c.query(
            `INSERT INTO aprovacao_etapa (fil_cod, doc_cod, tit_cod, fbl_cod, ftb_cod, status)
             VALUES (9, 9, 9, 1, 1, 'INVENTADO')`,
        ),
    );

    const db = criarDatabaseClient(c);
    // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
    const etapaRepo = new EtapaAprovacaoRepository(db as any);
    // biome-ignore lint/suspicious/noExplicitAny: dublê estrutural do cliente de banco
    const tituloRepo = new TituloAprovacaoRepository(db as any, etapaRepo);
    const chave = { filCod: 1, docCod: 4156, titCod: 1 };

    console.log('\n── Repositories contra o banco real ──');
    await c.query('TRUNCATE aprovacao_etapa, aprovacao_titulo, aprovacao_ingestao_run');

    await tituloRepo.upsert(titulo());
    await tituloRepo.upsert(titulo({ fornecedorNome: 'CLONEX v2' }));
    const lista = await tituloRepo.list({ page: 1, pageSize: 25, filCods: [1] });
    checar('upsert é idempotente', lista.total === 1, `total=${lista.total}`);
    checar(
        'upsert atualiza o registro existente',
        lista.items[0]?.fornecedorNome === 'CLONEX v2',
        String(lista.items[0]?.fornecedorNome),
    );

    await etapaRepo.sincronizarTrilha(chave, [etapa(), etapa({ fblCod: 7, nome: 'TI' })]);
    checar(
        'sincronizarTrilha grava as etapas',
        (await etapaRepo.listByTitulo(1, 4156, 1)).length === 2,
    );

    await etapaRepo.sincronizarTrilha(chave, [etapa()]);
    const ativas = await etapaRepo.listByTitulo(1, 4156, 1);
    const todas = await c.query('SELECT count(*)::int n FROM aprovacao_etapa');
    checar('etapa que sumiu do ERP fica inativa', ativas.length === 1);
    checar('etapa inativa NÃO é apagada (I6)', todas.rows[0].n === 2, `linhas=${todas.rows[0].n}`);

    await etapaRepo.sincronizarTrilha(chave, []);
    checar('trilha vazia inativa todas', (await etapaRepo.listByTitulo(1, 4156, 1)).length === 0);

    await c.query('TRUNCATE aprovacao_etapa');
    await etapaRepo.sincronizarTrilha({ filCod: 1, docCod: 100, titCod: 1 }, [
        etapa({ docCod: 100 }),
    ]);
    await etapaRepo.sincronizarTrilha({ filCod: 2, docCod: 200, titCod: 1 }, [
        etapa({ filCod: 2, docCod: 200 }),
    ]);
    const mapa = await etapaRepo.listByTitulos([
        { filCod: 1, docCod: 100, titCod: 1 },
        { filCod: 2, docCod: 200, titCod: 1 },
    ]);
    // Três `IN` independentes casariam também (1,200) e (2,100), que não existem.
    checar(
        'listByTitulos casa por TUPLA, sem pares cruzados',
        mapa.size === 2,
        `size=${mapa.size}`,
    );

    const composto = await tituloRepo.list({
        page: 1,
        pageSize: 25,
        filCods: [1],
        status: STATUS_WORKFLOW.APROVADO,
        fornecedorCod: 5129,
        responsavel: 'DANILO',
        emissaoDe: new Date('2026-01-01'),
        emissaoAte: new Date('2026-12-31'),
        busca: 'CLONEX',
    });
    checar('todos os filtros do painel compõem em SQL válido', composto.total >= 0);

    await c.query('TRUNCATE aprovacao_titulo');
    await tituloRepo.upsert(titulo({ filCod: 1, observadoEm: new Date('2026-08-01T00:00:00Z') }));
    await tituloRepo.upsert(
        titulo({ filCod: 2, docCod: 999, observadoEm: new Date('2026-08-19T00:00:00Z') }),
    );
    const antiga = await tituloRepo.ultimoSnapshot([1]);
    const recente = await tituloRepo.ultimoSnapshot([2]);
    checar(
        'ultimoSnapshot é escopado por filial (não afirma frescor alheio)',
        antiga !== null && recente !== null && antiga.getTime() < recente.getTime(),
        `fil1=${antiga?.toISOString()} fil2=${recente?.toISOString()}`,
    );

    const semFilial = await tituloRepo.list({ page: 1, pageSize: 25, filCods: [] });
    checar('allow-list vazia devolve nada, nunca tudo', semFilial.total === 0);

    await c.end();
    await pg.stop();

    console.log(`\n${falhas === 0 ? 'TUDO VERDE' : `${falhas} FALHA(S)`}`);
    process.exit(falhas === 0 ? 0 : 1);
};

main().catch((e) => {
    console.error('verify-sql-aprovacoes FALHOU:', e);
    process.exit(1);
});

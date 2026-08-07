import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';

/**
 * E2E REAL contra o Conexos de HOMOLOGAÇÃO (columbiatrading-hml) — Fase A: SEM ESCRITA no ERP.
 *
 * Roda o fluxo verdadeiro (rotas Express reais → services reais → clients Conexos reais com
 * login/sid HTTP) apontado ao HML, com persistência in-memory (sem Postgres):
 *   ingestão fin133→fin095 (365 dias, filial 2) → painel → clientes/processos (imp021) →
 *   solicitacao-numerario em DRY-RUN (pré-flight read-only; nenhum POST de documento).
 *
 * Guard-rails: CONEXOS_WRITE_ENABLED ausente e CONEXOS_DRY_RUN ausente ⇒ o gate default do
 * serviço mantém dry-run; além disso o body manda `dryRun:true` (cinto e suspensório).
 *
 * FORA da suíte padrão (`*.integration.test.ts` está no testPathIgnorePatterns): depende de rede
 * e de credencial em `src/backend/.env` (CONEXOS_BASE_URL DEVE ser o HML). Rodar explicitamente:
 *   npx jest recebimentos.e2e.hml --testPathIgnorePatterns "/node_modules/"
 *
 * Contexto/descobertas do ambiente: `docs/e2e/sondagem-conexos-hml.md`.
 */

jest.setTimeout(600_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const FIL_COD = 2;
const SKYJACK_PES_COD = 232;
const INGEST_DIAS = 365;

type AnyRecord = Record<string, unknown>;

// ─────────────────────────────── fakes in-memory de persistência (mesmo pattern do harness fake-ERP)

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_key: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('E2E HML: SQL indisponível (repositórios são fakes)');
    },
    selectFirst: async () => {
        throw new Error('E2E HML: SQL indisponível (repositórios são fakes)');
    },
    insert: async () => {
        throw new Error('E2E HML: SQL indisponível (repositórios são fakes)');
    },
    update: async () => {
        throw new Error('E2E HML: SQL indisponível (repositórios são fakes)');
    },
    withTransaction: async () => {
        throw new Error('E2E HML: SQL indisponível (repositórios são fakes)');
    },
});

interface FakeTransacao {
    id: string;
    naturalKey: string;
    filCod: number;
    tipo: string;
    status: string;
    valor: number;
    dataMovimento: Date;
    categoria?: string;
    gerNum?: number;
    [k: string]: unknown;
}

const buildFakeTransacaoRepo = (): { repo: AnyRecord; store: Map<string, FakeTransacao> } => {
    const store = new Map<string, FakeTransacao>();
    const byNaturalKey = new Map<string, string>();
    const aplicaFiltro = (t: FakeTransacao, input: AnyRecord): boolean => {
        const filCods = (input.filCods ?? []) as number[];
        const tipos = (input.tipos ?? []) as string[];
        const catEx = (input.categoriasExcluidas ?? []) as string[];
        if (!filCods.includes(t.filCod)) return false;
        if (tipos.length > 0 && !tipos.includes(t.tipo)) return false;
        if (catEx.length > 0 && t.categoria !== undefined && catEx.includes(t.categoria)) {
            return false;
        }
        return true;
    };
    const repo: AnyRecord = {
        upsertMany: async (
            transacoes: FakeTransacao[],
            _runId: string,
        ): Promise<{ inseridas: number; deduplicadas: number }> => {
            let inseridas = 0;
            let deduplicadas = 0;
            for (const t of transacoes) {
                const existenteId = byNaturalKey.get(t.naturalKey);
                if (existenteId) {
                    deduplicadas += 1;
                } else {
                    inseridas += 1;
                    store.set(t.id, { ...t });
                    byNaturalKey.set(t.naturalKey, t.id);
                }
            }
            return { inseridas, deduplicadas };
        },
        findById: async (id: string): Promise<FakeTransacao | null> => store.get(id) ?? null,
        listParaPainel: async (input: AnyRecord): Promise<FakeTransacao[]> =>
            [...store.values()]
                .filter((t) => aplicaFiltro(t, input))
                .sort((a, b) => b.dataMovimento.getTime() - a.dataMovimento.getTime())
                .slice(0, Number(input.limit ?? 500)),
        contarKpis: async (input: AnyRecord): Promise<Record<string, number>> => {
            const out: Record<string, number> = {};
            for (const t of store.values()) {
                if (aplicaFiltro(t, input)) out[t.status] = (out[t.status] ?? 0) + 1;
            }
            return out;
        },
        somarValorPorStatus: async (input: AnyRecord): Promise<Record<string, number>> => {
            const out: Record<string, number> = {};
            for (const t of store.values()) {
                if (aplicaFiltro(t, input)) out[t.status] = (out[t.status] ?? 0) + t.valor;
            }
            return out;
        },
    };
    return { repo, store };
};

const buildFakeRunRepo = (): AnyRecord => {
    const runs = new Map<string, AnyRecord>();
    const idem = new Map<string, string>();
    return {
        createRun: async (input: AnyRecord): Promise<string> => {
            const id = randomUUID();
            runs.set(id, { id, status: 'running', startedAt: new Date(), ...input });
            return id;
        },
        finishRun: async (input: AnyRecord): Promise<void> => {
            const run = runs.get(String(input.runId));
            if (run) Object.assign(run, input, { finishedAt: new Date() });
        },
        listRecentRuns: async (limit: number): Promise<AnyRecord[]> =>
            [...runs.values()].slice(-limit).reverse(),
        findLatestSuccessFinishedAt: async (): Promise<string | undefined> => {
            const ok = [...runs.values()].filter((r) => r.status === 'success' && r.finishedAt);
            const last = ok[ok.length - 1];
            return last ? (last.finishedAt as Date).toISOString() : undefined;
        },
        findRunIdByIdempotencyKey: async (key: string): Promise<string | null> =>
            idem.get(key) ?? null,
        recordIdempotencyKey: async (key: string, runId: string): Promise<void> => {
            idem.set(key, runId);
        },
    };
};

const buildFakeSnLedger = (): { ledger: AnyRecord; rows: Map<string, AnyRecord> } => {
    const rows = new Map<string, AnyRecord>();
    const touch = (key: string, patch: AnyRecord): void => {
        const row = rows.get(key);
        if (row) Object.assign(row, patch, { atualizadoEm: new Date() });
    };
    const ledger: AnyRecord = {
        findByIdempotencyKey: async (key: string): Promise<AnyRecord | null> =>
            rows.get(key) ?? null,
        beginExecution: async (
            input: AnyRecord,
        ): Promise<{ status: string; alreadySettled: boolean }> => {
            const existente = rows.get(String(input.idempotencyKey));
            if (existente?.status === 'settled') return { status: 'settled', alreadySettled: true };
            if (!existente) {
                rows.set(String(input.idempotencyKey), {
                    ...input,
                    status: 'reconciling',
                    criadoEm: new Date(),
                    atualizadoEm: new Date(),
                });
            }
            return { status: 'reconciling', alreadySettled: false };
        },
        setDocCod: async (key: string, docCod: number) => touch(key, { docCod }),
        setRequestPayload: async (key: string, payload: unknown) =>
            touch(key, { requestPayload: payload }),
        setFin014BorCod: async (key: string, borCod: number) =>
            touch(key, { fin014BorCod: borCod, etapa: 'fin014-done' }),
        setNdDocCod: async (key: string, docCod: number) =>
            touch(key, { ndDocCod: docCod, etapa: 'nota-debito' }),
        setEtapa: async (key: string, etapa: string) => touch(key, { etapa }),
        setRevisaoHumana: async (key: string, revisao: boolean) =>
            touch(key, { revisaoHumana: revisao }),
        setNdeAutorizado: async (key: string, autorizado: boolean) =>
            touch(key, { ndeAutorizado: autorizado }),
        markSettled: async (key: string, data: AnyRecord) =>
            touch(key, { ...data, status: 'settled', etapa: data.etapa ?? 'concluido' }),
        markError: async (key: string, data: AnyRecord) => touch(key, { ...data, status: 'error' }),
    };
    return { ledger, rows };
};

// ─────────────────────────────────────────────────────────────────────────── harness

interface TestServer {
    url: string;
    close: () => Promise<void>;
}

const listen = (app: express.Express): Promise<TestServer> =>
    new Promise((resolve) => {
        const server: Server = app.listen(0, '127.0.0.1', () => {
            const { port } = server.address() as AddressInfo;
            resolve({
                url: `http://127.0.0.1:${port}`,
                close: () => new Promise((r) => server.close(() => r())),
            });
        });
    });

const postJson = (url: string, body: unknown) =>
    fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

/** Lê o .env do backend (o ConexosService lê process.env NO IMPORT — setar antes). */
const carregarDotEnv = (): Record<string, string> => {
    const envPath = path.resolve(__dirname, '..', '.env');
    const out: Record<string, string> = {};
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return out;
};

describe('E2E HML (Fase A — SEM escrita): ingestão real → painel → alocar → dry-run', () => {
    let appServer: TestServer;
    let snLedgerRows: Map<string, AnyRecord>;
    let txnId = '';
    let processo: AnyRecord = {};
    const envSnapshot = new Map<string, string | undefined>();
    const setEnv = (key: string, value: string | undefined): void => {
        if (!envSnapshot.has(key)) envSnapshot.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };

    beforeAll(async () => {
        const dotenv = carregarDotEnv();
        const base = dotenv.CONEXOS_BASE_URL ?? '';
        // Trava de segurança: este teste SÓ roda contra o HML — nunca produção.
        if (!/-hml\./.test(base)) {
            throw new Error(
                `CONEXOS_BASE_URL do .env não é homologação (${base}) — abortando por segurança.`,
            );
        }
        setEnv('CONEXOS_BASE_URL', base);
        setEnv('CONEXOS_USERNAME', dotenv.CONEXOS_USERNAME);
        setEnv('CONEXOS_PASSWORD', dotenv.CONEXOS_PASSWORD);
        setEnv('CONEXOS_FIL_COD', String(FIL_COD));
        // Gate de escrita: AUSENTES ⇒ dry-run default do serviço (nenhum POST de documento).
        setEnv('CONEXOS_WRITE_ENABLED', undefined);
        setEnv('CONEXOS_DRY_RUN', undefined);
        setEnv('SN_GCD_COD', '150');
        setEnv('RECEBIMENTO_INGEST_FIL_CODS', String(FIL_COD));
        setEnv('environment', 'local');
        setEnv('client_name', undefined);
        setEnv('databaseConnectionString', undefined);

        const { container } = await import('tsyringe');
        const { default: PostgreeDatabaseClient } = await import(
            '../domain/client/database/PostgreeDatabaseClient.js'
        );
        const { default: TransacaoRepository } = await import(
            '../domain/repository/recebimentos/TransacaoRepository.js'
        );
        const { default: RecebimentoIngestaoRunRepository } = await import(
            '../domain/repository/recebimentos/RecebimentoIngestaoRunRepository.js'
        );
        const { SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN } = await import(
            '../domain/interface/recebimentos/ports.js'
        );

        container.registerInstance(PostgreeDatabaseClient, buildFakeDb() as never);
        const { repo: fakeTransacaoRepo } = buildFakeTransacaoRepo();
        container.registerInstance(TransacaoRepository, fakeTransacaoRepo as never);
        container.registerInstance(RecebimentoIngestaoRunRepository, buildFakeRunRepo() as never);

        const { buildLegacyConexosAdapter } = await import(
            '../domain/client/legacyConexosAdapter.js'
        );
        const { default: ConexosBaseClient, LEGACY_CONEXOS_TOKEN } = await import(
            '../domain/client/ConexosBaseClient.js'
        );
        const { default: ConexosSessionResolver } = await import(
            '../domain/client/ConexosSessionResolver.js'
        );
        const resolver = container.resolve(ConexosSessionResolver);
        container.register(LEGACY_CONEXOS_TOKEN, {
            useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
        });
        container.resolve(ConexosBaseClient);
        const { registerRecebimentosPorts } = await import('../domain/recebimentosContainer.js');
        registerRecebimentosPorts();
        const fakeLedger = buildFakeSnLedger();
        snLedgerRows = fakeLedger.rows;
        container.register(SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN, {
            useValue: fakeLedger.ledger,
        });

        const { default: recebimentosRouter } = await import('./recebimentos.js');
        const { errorMiddleware } = await import('../http/errorMiddleware.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { sub: 'e2e-hml-fase-a', role: 'admin', email: 'e2e@columbia.test' };
            next();
        });
        app.use('/recebimentos', recebimentosRouter);
        app.use(errorMiddleware);
        appServer = await listen(app);
    });

    afterAll(async () => {
        await appServer?.close();
        for (const [key, value] of envSnapshot) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it(`1. ingere o extrato REAL do HML (filial ${FIL_COD}, ${INGEST_DIAS} dias) com créditos > 0`, async () => {
        const res = await postJson(`${appServer.url}/recebimentos/ingestao`, {
            filCods: [FIL_COD],
            dias: INGEST_DIAS,
        });
        const body = (await res.json()) as AnyRecord;
        expect(res.status).toBe(200);
        expect(typeof body.runId).toBe('string');
        // O HML tem extrato até nov-dez/2025 — a janela de 365d precisa capturar créditos reais.
        expect(Number(body.total)).toBeGreaterThan(0);
        console.log(
            `[E2E-HML] ingestão: ${body.total} lidas, ${body.deduplicadas} deduplicadas (run ${body.runId})`,
        );
    });

    it('2. o painel lista os créditos reais e ao menos um carrega gerNum', async () => {
        const res = await fetch(`${appServer.url}/recebimentos/painel?filCod=${FIL_COD}`);
        const body = (await res.json()) as AnyRecord;
        expect(res.status).toBe(200);
        const transacoes = body.transacoes as AnyRecord[];
        expect(transacoes.length).toBeGreaterThan(0);
        const comGerNum = transacoes.find((t) => t.gerNum !== undefined && Number(t.valor) > 0);
        expect(comGerNum).toBeDefined();
        txnId = String(comGerNum?.id);
        console.log(
            `[E2E-HML] painel: ${transacoes.length} créditos; txn escolhida ${txnId} ` +
                `(valor ${comGerNum?.valor}, gerNum ${comGerNum?.gerNum}, categoria ${comGerNum?.categoriaDesc ?? comGerNum?.categoria ?? '-'})`,
        );
    });

    it('3. o modal Alocar acha a SKYJACK e seus processos ENCOMENDA no imp021 real', async () => {
        const clientes = (await (
            await fetch(`${appServer.url}/recebimentos/clientes?filCod=${FIL_COD}`)
        ).json()) as AnyRecord;
        const lista = clientes.clientes as AnyRecord[];
        expect(lista.length).toBeGreaterThan(0);
        const skyjack = lista.find((c) => Number(c.pesCod) === SKYJACK_PES_COD);
        expect(skyjack).toBeDefined();

        const res = await fetch(
            `${appServer.url}/recebimentos/transacoes/${txnId}/processos?pesCod=${SKYJACK_PES_COD}&filCod=${FIL_COD}`,
        );
        const body = (await res.json()) as AnyRecord;
        const processos = body.processos as AnyRecord[];
        expect(processos.length).toBeGreaterThan(0);
        processo = processos.find((p) => Number(p.priCod) === 186) ?? processos[0];
        console.log(
            `[E2E-HML] alocar: ${lista.length} clientes; SKYJACK com ${processos.length} processos; alvo pri ${processo.priCod}`,
        );
    });

    it('4. dry-run da alocação REAL: pré-flight READY, nenhum documento criado no ERP', async () => {
        const res = await postJson(
            `${appServer.url}/recebimentos/transacoes/${txnId}/solicitacao-numerario`,
            {
                priCod: processo.priCod,
                valor: 123.45,
                filCod: FIL_COD,
                ...(processo.priEspRefcliente !== undefined && processo.priEspRefcliente !== ''
                    ? { priEspRefcliente: processo.priEspRefcliente }
                    : {}),
                pesCod: processo.pesCod,
                dpeNomPessoa: processo.dpeNomPessoa,
                moeCod: 790,
                dryRun: true,
            },
        );
        const body = (await res.json()) as AnyRecord;
        expect(res.status).toBe(200);
        expect(body.status).toBe('dry-run');
        expect(body.dryRun).toBe(true);
        // Pré-flight REAL contra o HML: cadastro completo + config SN resolvida ⇒ READY.
        expect(body.classificacao).toBe('READY');
        // Nada abriu execução no ledger (dry-run não escreve nem no write-ahead).
        expect(snLedgerRows.size).toBe(0);
        console.log(
            `[E2E-HML] dry-run: classificacao=${body.classificacao} motivo=${body.motivo ?? '-'}`,
        );
    });
});

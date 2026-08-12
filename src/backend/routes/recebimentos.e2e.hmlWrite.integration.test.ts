import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';

/**
 * FASE B — E2E com ESCRITA REAL no Conexos de HOMOLOGAÇÃO (columbiatrading-hml).
 *
 * Executa o fluxo verdadeiro ponta a ponta contra o ERP de homologação:
 *   SN (com299) → fin014 (borderô/baixa) → NDe (com297) → fiscal (com300) → obs (com131) →
 *   homologar → poll SEFAZ-homologação.
 *
 * Cria DOCUMENTOS REAIS no HML (nenhum efeito em produção). Guard-rails:
 *  - aborta se `CONEXOS_BASE_URL` não contiver `-hml` (nunca aponta para produção);
 *  - valor pequeno e fixo (R$ 123,45) num processo de teste (SKYJACK, pri 186, filial 2);
 *  - persistência in-memory (nenhum Postgres); o ledger fake registra as etapas.
 *
 * Fora da suíte padrão (`*.integration.test.ts`). Rodar explicitamente:
 *   npx jest recebimentos.e2e.hmlWrite --testPathIgnorePatterns "/node_modules/"
 *
 * Contexto do ambiente: `docs/e2e/hml-setup-executado.md`.
 */

jest.setTimeout(900_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const FIL_COD = 2;
const SKYJACK_PES_COD = 232;
const PRI_COD = 186;
const VALOR = 123.45;

type AnyRecord = Record<string, unknown>;

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_k: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('E2E HML-write: SQL indisponível');
    },
    selectFirst: async () => {
        throw new Error('E2E HML-write: SQL indisponível');
    },
    insert: async () => {
        throw new Error('E2E HML-write: SQL indisponível');
    },
    update: async () => {
        throw new Error('E2E HML-write: SQL indisponível');
    },
    withTransaction: async () => {
        throw new Error('E2E HML-write: SQL indisponível');
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
    gerNum?: number;
    [k: string]: unknown;
}

const buildFakeTransacaoRepo = (
    seed: FakeTransacao,
): { repo: AnyRecord; store: Map<string, FakeTransacao> } => {
    const store = new Map<string, FakeTransacao>([[seed.id, seed]]);
    const repo: AnyRecord = {
        upsertMany: async () => ({ inseridas: 0, deduplicadas: 0 }),
        findById: async (id: string): Promise<FakeTransacao | null> => store.get(id) ?? null,
        listParaPainel: async (): Promise<FakeTransacao[]> => [...store.values()],
        contarKpis: async (): Promise<Record<string, number>> => ({}),
        somarValorPorStatus: async (): Promise<Record<string, number>> => ({}),
    };
    return { repo, store };
};

const buildFakeRunRepo = (): AnyRecord => ({
    createRun: async (): Promise<string> => randomUUID(),
    finishRun: async (): Promise<void> => undefined,
    listRecentRuns: async (): Promise<AnyRecord[]> => [],
    findLatestSuccessFinishedAt: async (): Promise<string | undefined> => undefined,
    findRunIdByIdempotencyKey: async (): Promise<string | null> => null,
    recordIdempotencyKey: async (): Promise<void> => undefined,
});

const buildFakeSnLedger = (): { ledger: AnyRecord; rows: Map<string, AnyRecord> } => {
    const rows = new Map<string, AnyRecord>();
    const touch = (key: string, patch: AnyRecord): void => {
        const row = rows.get(key);
        if (row) Object.assign(row, patch, { atualizadoEm: new Date() });
        // eslint-disable-next-line no-console
        console.log(`[LEDGER] ${key} <- ${JSON.stringify(patch)}`);
    };
    const ledger: AnyRecord = {
        findByIdempotencyKey: async (key: string): Promise<AnyRecord | null> =>
            rows.get(key) ?? null,
        /**
         * Espelha o repositório real (ADR-0033): modalidade por transação, da alocação mais recente.
         * Só linhas com `priVldTipo` gravado entram — igual ao `pri_vld_tipo IS NOT NULL` do SQL.
         */
        listModalidadePorTxnIds: async (
            txnIds: string[],
        ): Promise<Map<string, { priVldTipo?: number; ndeDispensada?: boolean }>> => {
            const alvo = new Set(txnIds);
            const out = new Map<string, { priVldTipo?: number; ndeDispensada?: boolean }>();
            for (const row of rows.values()) {
                const txnId = row.txnId as string | undefined;
                if (txnId === undefined || !alvo.has(txnId)) continue;
                if (row.priVldTipo === undefined || row.priVldTipo === null) continue;
                out.set(txnId, {
                    priVldTipo: Number(row.priVldTipo),
                    ndeDispensada: Boolean(row.ndeDispensada),
                });
            }
            return out;
        },
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
            touch(key, { requestPayloadKeys: Object.keys((payload ?? {}) as AnyRecord) }),
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

/**
 * Repositório in-memory da NDe emitida. O `registerRecebimentosPorts` registra o `NdeRepository`
 * de Postgres, mas aqui não há banco (o fake `insert` lança) — e a homologação passou a gravar um
 * `nota_debito_eletronica` (merge 2026-08-03). Sem este fake a etapa `homologado` quebraria por
 * falta de banco, não por comportamento do ERP.
 */
const buildFakeNdeRepo = (): { repo: AnyRecord; rows: AnyRecord[] } => {
    const rows: AnyRecord[] = [];
    const repo: AnyRecord = {
        save: async (nde: AnyRecord): Promise<AnyRecord> => {
            rows.push(nde);
            // eslint-disable-next-line no-console
            console.log(
                `[NDE] salva numero=${String(nde.numeroNde)} valor=${String(nde.valor)} status=${String(nde.statusEmissao)}`,
            );
            return nde;
        },
        findByRecebimentoId: async (recebimentoId: string): Promise<AnyRecord | null> =>
            rows.find((r) => r.recebimentoId === recebimentoId) ?? null,
    };
    return { repo, rows };
};

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

const carregarDotEnv = (): Record<string, string> => {
    const envPath = path.resolve(__dirname, '..', '.env');
    const out: Record<string, string> = {};
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
        if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return out;
};

describe('FASE B — E2E ESCRITA REAL no Conexos HML (SN → fin014 → NDe → homologação)', () => {
    let appServer: TestServer;
    let snLedgerRows: Map<string, AnyRecord>;
    const txnId = `hml-write-${Date.now()}`;
    const envSnapshot = new Map<string, string | undefined>();
    const setEnv = (key: string, value: string | undefined): void => {
        if (!envSnapshot.has(key)) envSnapshot.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };

    beforeAll(async () => {
        const dotenv = carregarDotEnv();
        const base = dotenv.CONEXOS_BASE_URL ?? '';
        if (!/-hml\./.test(base)) {
            throw new Error(`ABORTADO: CONEXOS_BASE_URL não é homologação (${base}).`);
        }
        setEnv('CONEXOS_BASE_URL', base);
        setEnv('CONEXOS_USERNAME', dotenv.CONEXOS_USERNAME);
        setEnv('CONEXOS_PASSWORD', dotenv.CONEXOS_PASSWORD);
        setEnv('CONEXOS_FIL_COD', String(FIL_COD));
        // ESCRITA LIGADA — este é o teste da Fase B.
        setEnv('CONEXOS_WRITE_ENABLED', 'true');
        setEnv('CONEXOS_DRY_RUN', 'false');
        setEnv('SN_GCD_COD', dotenv.SN_GCD_COD ?? '150');
        setEnv('COM297_GCD_NOTA_DEBITO', dotenv.COM297_GCD_NOTA_DEBITO ?? '186');
        setEnv('NDE_POLL_TIMEOUT_MS', '120000');
        setEnv('NDE_POLL_INTERVAL_MS', '5000');
        setEnv('NDE_ACL_PREFLIGHT', 'true');
        // Braços do experimento da descrição do item (ADR-0036 §Verificação pendente). Vêm do SHELL
        // para permitir o A/B sem editar arquivo: `=false` é o braço de CONTROLE (reproduz o bug),
        // ausente/`true` é o braço de TRATAMENTO (a automação grava a descrição no item).
        setEnv(
            'NDE_DESCRICAO_ITEM_ENABLED',
            process.env.NDE_DESCRICAO_ITEM_ENABLED ?? dotenv.NDE_DESCRICAO_ITEM_ENABLED ?? 'true',
        );
        setEnv(
            'NDE_DESCRICAO_ITEM_FALLBACK',
            process.env.NDE_DESCRICAO_ITEM_FALLBACK ?? dotenv.NDE_DESCRICAO_ITEM_FALLBACK,
        );
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
        const { SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN, NDE_REPOSITORY_TOKEN } =
            await import('../domain/interface/recebimentos/ports.js');

        container.registerInstance(PostgreeDatabaseClient, buildFakeDb() as never);
        // Transação semeada: o crédito que o analista alocaria. gerNum 38 = conta Itaú do HML.
        const { repo } = buildFakeTransacaoRepo({
            id: txnId,
            naturalKey: `hml-write:${txnId}`,
            filCod: FIL_COD,
            tipo: 'CREDITO',
            status: 'importada',
            valor: VALOR,
            dataMovimento: new Date(),
            gerNum: 38,
            moeda: 'BRL',
            correlationId: randomUUID(),
            rawPayload: null,
            normalized: null,
            importadoEm: new Date(),
        });
        container.registerInstance(TransacaoRepository, repo as never);
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
        container.register(NDE_REPOSITORY_TOKEN, { useValue: buildFakeNdeRepo().repo });

        const { default: recebimentosRouter } = await import('./recebimentos.js');
        const { errorMiddleware } = await import('../http/errorMiddleware.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { sub: 'e2e-hml-fase-b', role: 'admin', email: 'e2e@columbia.test' };
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

    it(`executa a alocação REAL de R$ ${VALOR} no processo ${PRI_COD} (SKYJACK) — HML`, async () => {
        const res = await postJson(
            `${appServer.url}/recebimentos/transacoes/${txnId}/solicitacao-numerario`,
            {
                priCod: PRI_COD,
                valor: VALOR,
                filCod: FIL_COD,
                pesCod: SKYJACK_PES_COD,
                dpeNomPessoa: 'SKYJACK BRASIL IMPORTACAO E COMERCIO',
                moeCod: 790,
            },
        );
        const body = (await res.json()) as AnyRecord;
        // eslint-disable-next-line no-console
        console.log('[FASE-B] resposta da rota:', JSON.stringify(body, null, 2));
        // eslint-disable-next-line no-console
        console.log('[FASE-B] ledger final:', JSON.stringify([...snLedgerRows.values()], null, 2));

        expect(res.status).toBe(200);
        // O desfecho é registrado; o teste NÃO exige sucesso — a Fase B é exploratória e o valor
        // está em ver ONDE o fluxo real chega no HML (etapa alcançada + mensagem do ERP).
        expect(['settled', 'error', 'blocked', 'skipped']).toContain(String(body.status));
    });
});

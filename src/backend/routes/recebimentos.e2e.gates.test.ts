import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import type { DependencyContainer } from 'tsyringe';

/**
 * E2E dos GATES de segurança + edge-cases fiscais NÃO-bloqueantes da Frente IV (Solicitação de
 * Numerário → NDe) — SEM Docker e SEM Conexos real. Deriva do harness verde de
 * `recebimentos.e2e.test.ts` (ERP fake HTTP local + fakes in-memory de persistência + rotas
 * Express reais).
 *
 * Três cenários independentes (um describe cada):
 *   1. GATE FECHADO É O DEFAULT — `CONEXOS_WRITE_ENABLED`/`CONEXOS_DRY_RUN` AUSENTES (default real
 *      de produção do EnvironmentProvider) → a rota devolve `status:'dry-run'` e NENHUMA escrita
 *      de documento chega ao ERP (só login + leituras de pré-flight/validadores).
 *   2. RT-007 (GAP auditado) — NDe homologada com `docMnyValor=0` NÃO bloqueia: o fluxo autoriza a
 *      NDe de valor ZERO (warn, não gate). Comportamento ATUAL pinado; ver
 *      `docs/reforma-tributaria/02_auditoria_gap_report.md`.
 *   3. SEFAZ NUNCA AUTORIZA — a leitura ÚNICA do poll NÃO é erro: `status:'settled'` (o numerário
 *      terminou na homologação) com `etapa:'homologado'`, `ndeAutorizado:false` e ledger SEM
 *      `markError` — a autorização assíncrona é reconciliada depois.
 *
 * CUIDADO de harness: o `EnvironmentProvider` é `@singleton` com cache interno (`environmentVars`).
 * O env MUDA entre describes, então cada describe reseta o cache do singleton (campo privado zerado
 * via cast) — `container.clearInstances()` não serve porque removeria os fakes `registerInstance`.
 * O ERP fake e o app Express são ÚNICOS para o arquivo (a base URL não muda); só o estado do ERP e
 * as flags de env variam por describe.
 */

jest.setTimeout(120_000);

// O bootstrap REAL importa `migrations/runMigrations.ts` (usa `import.meta`, incompatível com o
// transform CJS do ts-jest). Mockamos SÓ o bootstrap e refazemos o wiring REAL dele no beforeAll
// (adapter Conexos legado + ports Frente IV) — sem migrations, substituídas pelos fakes in-memory.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────── ERP fake (HTTP local)

interface ErpRequest {
    method: string;
    path: string;
    body: Record<string, unknown>;
}

interface ErpState {
    requests: ErpRequest[];
    /** docCods emitidos por tela (com299 → SN; com297 → NDe). */
    docs: Map<string, Record<string, unknown>>;
    snDocCod: number;
    ndDocCod: number;
    homologado: boolean;
    obsGerada: boolean;
    /** nº de leituras do status com297 APÓS a homologação (SEFAZ autoriza na 2ª). */
    pollsPosHomolog: number;
    /** Cenário 2 (RT-007): leituras de status PÓS-homologação devolvem docMnyValor=0. */
    valorZeroPosHomolog: boolean;
    /** Cenário 3: a SEFAZ NUNCA autoriza (vldAutorizado sempre 0). */
    sefazNuncaAutoriza: boolean;
}

const VALOR_EXTRATO = 182347.65;
const GER_NUM = 38;
const FIL_COD = 1;
const PES_COD = 696;
const PRI_COD = 1153;

/** Template do `comDocProdutos/initialValues` — espelha o HAR real (CST IBS/CBS "-1"). */
const TEMPLATE_ITEM_SN = {
    prdCod: 2,
    tpcCod: 33,
    cfoEspCod: '9999A2',
    undCod: 3,
    dprVldCstIbsCbs: '-1',
    dprVldCstPis: '70',
    dprVldCstCofins: '70',
};

/** finDocFiscal do com300 (subset) — CST IBS/CBS herdado "-1". */
const buildFinDocFiscal = (docCod: number): Record<string, unknown> => ({
    filCod: FIL_COD,
    docTip: 1,
    docCod,
    fisCod: 1,
    fisVldTipoNfDebito: 0,
    fisVldTipoNfCredito: 0,
    fisEspSerie: 'U',
    cfoEspCod: '5.949',
    fisVldCstIbsCbs: '-1',
});

const buildErp = (): { app: express.Express; state: ErpState } => {
    const state: ErpState = {
        requests: [],
        docs: new Map(),
        snDocCod: 18342,
        ndDocCod: 18400,
        homologado: false,
        obsGerada: false,
        pollsPosHomolog: 0,
        valorZeroPosHomolog: false,
        sefazNuncaAutoriza: false,
    };
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use((req, _res, next) => {
        state.requests.push({
            method: req.method,
            path: req.path,
            body: (req.body ?? {}) as Record<string, unknown>,
        });
        next();
    });

    const ok = { messages: [{ valid: 'SUCESSO', message: 'OK' }] };

    // ── auth ──
    app.post('/api/login', (_req, res) => {
        res.setHeader('Set-Cookie', 'sid=E2EFAKESID; Path=/; HttpOnly');
        res.json({
            usnCod: 97,
            filCodDefault: FIL_COD,
            filiais: [
                {
                    filCod: FIL_COD,
                    filDesNome: 'COLUMBIA E2E',
                    filDocFederalFmt: '00.000.000/0001-00',
                },
            ],
        });
    });

    // ── ACL da conta de serviço ──
    app.get('/api/permissoes/new/com297', (_req, res) => {
        res.json({
            acoes: [
                'com300 UPDATE',
                'com131 GERAR OBS',
                'com297 HOMOLOGAR DOCUMENTO',
                'com297 HOMOLOGAR DOCUMENTO CONTINGENCIA',
                'com194 SELECT',
            ],
        });
    });

    // ── imp021: modalidade do processo (gate 0.5 do pré-flight, ADR-0031) ──
    // `priVldTipo: 3` (POR ENCOMENDA) = trilha COMPLETA com NDe, que é o que estes gates pinam.
    app.post('/api/imp021/list', (_req, res) => {
        res.json({
            count: 1,
            rows: [
                {
                    priCod: PRI_COD,
                    pesCod: PES_COD,
                    dpeNomPessoa: 'CLIENTE E2E LTDA',
                    priVldTipo: 3,
                    filCod: FIL_COD,
                },
            ],
        });
    });

    // ── LOVs ──
    app.post('/api/lov/ConfigDocProcesso', (_req, res) => {
        res.json({
            rows: [{ gcdCod: 150, gcdDesNome: 'SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA' }],
        });
    });
    app.post('/api/lov/CondPgtoPessoa', (req, res) => {
        // O LOV real traz `count` e pagina do SEU jeito (ignora o `pageSize` pedido) — o fake espelha
        // isso: página 1 com as linhas, página 2 vazia. Ver docs/e2e/fase-b-resultado-hml.md.
        const body = (req.body ?? {}) as Record<string, unknown>;
        const pageNumber = Number(body.pageNumber ?? 1);
        const rows = [
            { pgtCod: 1, pgtDesNome: 'A VISTA' },
            { pgtCod: 109, pgtDesNome: 'BELLIZ - DUPLICATA' },
        ];
        res.json({ count: rows.length, rows: pageNumber > 1 ? [] : rows });
    });
    app.post('/api/lov/ContasProjetoCtb', (_req, res) => {
        res.json({
            rows: [
                {
                    ctpCod: 690,
                    ctpDesNome: 'ADIANTAMENTO DE CLIENTE ENCOMENDA',
                    ctpEspConta: '304001',
                },
            ],
        });
    });
    app.post('/api/lov/TituloBorderoReceber', (req, res) => {
        const filtro = (req.body?.filterList ?? {}) as Record<string, unknown>;
        const docCod = Number(filtro['docCod#EQ'] ?? state.snDocCod);
        res.json({
            rows: [{ docCod, titCod: 1, titEspNumero: '02082026', titMnyAberto: VALOR_EXTRATO }],
        });
    });

    // ── fin014 (borderô + baixa do título da SN) ──
    app.post('/api/fin014/baixas/validacao/tituloBaixa', (_req, res) => {
        res.json({
            messages: [],
            responseData: {
                bxaMnyValor: VALOR_EXTRATO,
                bxaMnyLiquido: VALOR_EXTRATO,
                bxaVldCcorrente: 1,
            },
        });
    });
    app.post('/api/fin014/baixas', (_req, res) => {
        res.json({ bxaCodSeq: 501 });
    });
    app.post('/api/fin014/finalizar/:borCod', (_req, res) => {
        res.json({});
    });
    app.post('/api/fin014', (_req, res) => {
        res.json({ borCod: 9001, gerDes: 'BANCO ITAU - AG 0641 CONTA 55795-4' });
    });

    // ── com297: resolver do gcd da NDe pelo nome ──
    app.post('/api/com297/list', (_req, res) => {
        res.json({ count: 1, rows: [{ gcdCod: 222, gcdDesNome: 'NOTA DE DÉBITO ELETRÔNICA' }] });
    });

    // ── com194 (validações) ──
    app.post('/api/com194/documento/list', (_req, res) => {
        res.json({ rows: [] });
    });

    // ── com131 (observações SINIEF) ──
    app.get('/api/com131/:docTip/:docCod', (_req, res) => {
        res.json({
            fisEspObs: state.obsGerada
                ? 'NOTA DE DEBITO EMITIDA NOS TERMOS DO AJUSTE SINIEF 49/2025 /'
                : null,
        });
    });
    app.post('/api/com131/geraObs', (_req, res) => {
        state.obsGerada = true;
        res.json({ fisEspObs: 'NOTA DE DEBITO EMITIDA NOS TERMOS DO AJUSTE SINIEF 49/2025 /' });
    });

    // ── com300 (fiscal, RMW) ──
    app.get('/api/com300/:docTip/:docCod/:fisCod', (req, res) => {
        res.json(buildFinDocFiscal(Number(req.params.docCod)));
    });
    app.put('/api/com300', (req, res) => {
        res.json(req.body); // eco — o client valida fisVldTipoNfDebito===6 no retorno
    });

    // ── homologação ──
    app.post('/api/com297/homologaNfe/:docCod', (_req, res) => {
        state.homologado = true;
        state.pollsPosHomolog = 0;
        res.json({ docVldComvalidacoes: 1, docEspNumero: '000000123' });
    });
    app.post('/api/com297/homologaNfeContingencia/:docCod', (_req, res) => {
        state.homologado = true;
        res.json({ docVldComvalidacoes: 1 });
    });

    // ── gerDoc (com299 SN + com297 NDe) ──
    app.post('/api/:tela/gerDoc/validaProcessoPessoa', (_req, res) => {
        res.json({
            responseData: { pesCod: PES_COD, endCodFis: 2, pdcDocFederal: '37032037000101' },
        });
    });
    app.post('/api/:tela/gerDoc/validaConfigDocPessoa', (_req, res) => {
        res.json({ responseData: { gcdCod: null, gcdDesNome: null } });
    });
    app.post('/api/:tela/gerDoc/validaConfigDoc', (_req, res) => {
        res.json({
            responseData: {
                tpcCod: 700,
                cfoEspCod: '5.949',
                gcdVldFormaRateio: 1,
                gcdVldTela: 7,
                gcdVldPropria: 0,
                fisEspSerie: 'U',
            },
        });
    });
    app.post('/api/:tela/gerDocProcesso/valida', (_req, res) => {
        res.json(ok);
    });
    app.post('/api/:tela/gerDocProcesso', (req, res) => {
        const tela = String(req.params.tela);
        const body = (req.body ?? {}) as Record<string, unknown>;
        const docCod = tela === 'com297' ? state.ndDocCod : state.snDocCod;
        // A NDe (com297) nasce JÁ com o produto (`prdCod` 41978) e o valor no HEADER do
        // gerDocProcesso — não há mais POST em `com297/comDocProdutos`. Sem isso o cenário RT-007
        // (docMnyValor=0 pós-homologação) seria vácuo: TODA NDe nasceria com valor zero.
        const valorHeader = tela === 'com297' ? Number(body.valor ?? 0) : 0;
        state.docs.set(`${tela}:${docCod}`, {
            ...body,
            docCod,
            docMnyValor: valorHeader > 0 ? valorHeader : 0,
            docVldFinalizado: 0,
        });
        res.json({
            messages: [{ valid: 'SUCESSO', message: 'DOC_GERADO', vars: { docCod } }],
        });
    });
    app.post('/api/:tela/validate/finalizacaoDocumento/:docCod', (_req, res) => {
        res.json(ok);
    });
    app.post('/api/:tela/finalizaDocumento/:docCod', (req, res) => {
        const doc = state.docs.get(`${req.params.tela}:${req.params.docCod}`);
        if (doc) doc.docVldFinalizado = 1;
        res.json(ok);
    });
    app.post('/api/:tela/comDocProdutos/initialValues', (_req, res) => {
        res.json({ COM299: { ComDocProdutos: { ...TEMPLATE_ITEM_SN } } });
    });
    app.post('/api/:tela/comDocProdutos', (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const docCod = Number(body.docCod ?? 0);
        const doc = state.docs.get(`${req.params.tela}:${docCod}`);
        const valor = Number(body.dprPreValorun ?? body.valor ?? 0);
        if (doc && Number.isFinite(valor) && valor > 0) doc.docMnyValor = valor;
        res.json(ok);
    });
    app.put('/api/:tela', (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const key = `${req.params.tela}:${Number(body.docCod ?? 0)}`;
        if (state.docs.has(key)) state.docs.set(key, body);
        res.json(body);
    });

    // SEFAZ do fake: default → autoriza na 2ª leitura pós-homolog; `sefazNuncaAutoriza` → sempre 0.
    const resolveVldAutorizado = (): number => {
        if (!state.homologado) return 0;
        state.pollsPosHomolog += 1;
        if (state.sefazNuncaAutoriza) return 0;
        return state.pollsPosHomolog >= 2 ? 1 : 0;
    };

    // `valorZeroPosHomolog` (RT-007) → docMnyValor=0 em TODA leitura pós-homolog.
    const resolveDocMnyValor = (doc: Record<string, unknown>): number => {
        if (state.homologado && state.valorZeroPosHomolog) return 0;
        return (doc.docMnyValor as number) ?? 0;
    };

    // com297: status p/ pré-condição de homologação + poll SEFAZ (modos por cenário acima).
    const statusCom297 = (doc: Record<string, unknown>): Record<string, unknown> => {
        const vldAutorizado = resolveVldAutorizado();
        const docMnyValor = resolveDocMnyValor(doc);
        return {
            ...doc,
            vldTpNf: '10',
            vldAutorizado,
            docVldNfehom: state.homologado ? 1 : 0,
            vldStatus: state.homologado ? 2 : 1,
            docVldConferencia: 0,
            vldEnviarConferencia: 0,
            docMnyValor,
            ...(state.homologado ? { docEspNumero: '000000123' } : {}),
        };
    };

    // ── leitura de documento (getDocumento com299 + poll de status com297) ──
    app.get('/api/:tela/:docCod', (req, res) => {
        const tela = String(req.params.tela);
        const docCod = Number(req.params.docCod);
        const doc = state.docs.get(`${tela}:${docCod}`) ?? { docCod, docMnyValor: 0 };
        res.json(tela === 'com297' ? statusCom297(doc) : doc);
    });

    return { app, state };
};

// ───────────────────────────────────────────── fakes in-memory de persistência (sem Postgres)

type AnyRecord = Record<string, unknown>;

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_key: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('E2E in-memory: SQL indisponível (repositórios são fakes)');
    },
    selectFirst: async () => {
        throw new Error('E2E in-memory: SQL indisponível (repositórios são fakes)');
    },
    insert: async () => {
        throw new Error('E2E in-memory: SQL indisponível (repositórios são fakes)');
    },
    update: async () => {
        throw new Error('E2E in-memory: SQL indisponível (repositórios são fakes)');
    },
    withTransaction: async () => {
        throw new Error('E2E in-memory: SQL indisponível (repositórios são fakes)');
    },
});

/** Repo de transações mínimo — este arquivo só precisa do `findById` (as txns são SEEDADAS). */
const buildFakeTransacaoRepo = (): { repo: AnyRecord; store: Map<string, AnyRecord> } => {
    const store = new Map<string, AnyRecord>();
    const repo: AnyRecord = {
        upsertMany: async () => ({ inseridas: 0, deduplicadas: 0 }),
        findById: async (id: string): Promise<AnyRecord | null> => store.get(id) ?? null,
        listParaPainel: async (): Promise<AnyRecord[]> => [...store.values()],
        contarKpis: async (): Promise<Record<string, number>> => ({}),
        somarValorPorStatus: async (): Promise<Record<string, number>> => ({}),
    };
    return { repo, store };
};

const buildFakeRunRepo = (): AnyRecord => {
    const runs = new Map<string, AnyRecord>();
    const idem = new Map<string, string>();
    return {
        createRun: async (input: AnyRecord): Promise<string> => {
            const id = `run-${runs.size + 1}`;
            runs.set(id, { id, status: 'running', startedAt: new Date(), ...input });
            return id;
        },
        finishRun: async (input: AnyRecord): Promise<void> => {
            const run = runs.get(String(input.runId));
            if (run) Object.assign(run, input, { finishedAt: new Date() });
        },
        listRecentRuns: async (limit: number): Promise<AnyRecord[]> =>
            [...runs.values()].slice(-limit).reverse(),
        findLatestSuccessFinishedAt: async (): Promise<string | undefined> => undefined,
        findRunIdByIdempotencyKey: async (key: string): Promise<string | null> =>
            idem.get(key) ?? null,
        recordIdempotencyKey: async (key: string, runId: string): Promise<void> => {
            idem.set(key, runId);
        },
    };
};

interface FakeSnLedger {
    ledger: AnyRecord;
    rows: Map<string, AnyRecord>;
    /** Toda chamada a `markError` fica registrada — o cenário 3 exige ZERO. */
    markErrorCalls: Array<{ key: string; data: AnyRecord }>;
}

const buildFakeSnLedger = (): FakeSnLedger => {
    const rows = new Map<string, AnyRecord>();
    const markErrorCalls: Array<{ key: string; data: AnyRecord }> = [];
    const touch = (key: string, patch: AnyRecord): void => {
        const row = rows.get(key);
        if (row) Object.assign(row, patch, { atualizadoEm: new Date() });
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
            if (existente?.status === 'settled') {
                return { status: 'settled', alreadySettled: true };
            }
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
        markError: async (key: string, data: AnyRecord) => {
            markErrorCalls.push({ key, data });
            touch(key, { ...data, status: 'error' });
        },
    };
    return { ledger, rows, markErrorCalls };
};

/**
 * Repositório in-memory da NDe (`nota_debito_eletronica`): logo após homologar, o service registra a
 * NDe emitida como entidade de 1ª classe (auditoria + aba NDe do painel). Sem este fake o token
 * resolveria o repositório REAL (Postgres) e a etapa `homologado` estouraria.
 */
const buildFakeNdeRepo = (): { repo: AnyRecord; saves: AnyRecord[] } => {
    const saves: AnyRecord[] = [];
    const repo: AnyRecord = {
        save: async (nde: AnyRecord): Promise<AnyRecord> => {
            saves.push(nde);
            return nde;
        },
        findByRecebimentoId: async (recebimentoId: string): Promise<AnyRecord | null> =>
            [...saves].reverse().find((n) => n.recebimentoId === recebimentoId) ?? null,
    };
    return { repo, saves };
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

const postJson = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
    });

/** Endpoints de ESCRITA de documento no ERP — nenhum pode aparecer no cenário dry-run. */
const ESCRITA_ERP_RE =
    /gerDocProcesso|fin014|comDocProdutos|homologaNfe|geraObs|finalizaDocumento|com300/i;

// Estado compartilhado do arquivo (um ERP fake + um app Express para os 3 describes).
let erp: { app: express.Express; state: ErpState };
let erpServer: TestServer;
let appServer: TestServer;
let transacaoStore: Map<string, AnyRecord>;
let fakeLedger: FakeSnLedger;
let ndeSaves: AnyRecord[];
let containerRef: DependencyContainer;
let environmentProviderCtor: unknown;

// Snapshot do env: o worker do Jest reusa o processo entre arquivos — restaurar no afterAll
// impede que CONEXOS_WRITE_ENABLED=true / CONEXOS_DRY_RUN=false vazem para outra suíte.
const envSnapshot = new Map<string, string | undefined>();
const setEnv = (key: string, value: string | undefined): void => {
    if (!envSnapshot.has(key)) envSnapshot.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
};

/**
 * Zera o cache do `EnvironmentProvider` (@singleton): o campo privado `environmentVars` guarda a
 * PRIMEIRA leitura do env — sem este reset, o describe seguinte veria as flags do anterior.
 * `container.clearInstances()` não é opção: removeria os fakes registrados com `registerInstance`.
 */
const resetEnvironmentCache = (): void => {
    const provider = containerRef.resolve(environmentProviderCtor as never) as unknown as {
        environmentVars?: unknown;
    };
    provider.environmentVars = undefined;
};

/** Seeda uma transação (pagamento) direto no fake — dispensa a rota de ingestão nos cenários. */
const seedTransacao = (id: string): void => {
    transacaoStore.set(id, {
        id,
        naturalKey: `nk:${id}`,
        correlationId: id,
        filCod: FIL_COD,
        tipo: 'CREDITO',
        status: 'importada',
        valor: VALOR_EXTRATO,
        moeda: 'BRL',
        dataMovimento: new Date(),
        importadoEm: new Date(),
        gerNum: GER_NUM,
        contraparte: 'BELLIZ INDUSTRIA E COMERCIO LTDA',
    });
};

const postAlocacao = (txnId: string) =>
    postJson(`${appServer.url}/recebimentos/transacoes/${txnId}/solicitacao-numerario`, {
        priCod: PRI_COD,
        valor: VALOR_EXTRATO,
        filCod: FIL_COD,
        priEspRefcliente: 'REF-2026-001',
        pesCod: PES_COD,
        dpeNomPessoa: 'BELLIZ INDUSTRIA E COMERCIO LTDA',
        moeCod: 790,
    });

beforeAll(async () => {
    // 1) ERP fake no ar ANTES de qualquer import de módulo que leia env no import.
    erp = buildErp();
    erpServer = await listen(erp.app);

    // 2) Env BASE do arquivo. As flags de escrita ficam AUSENTES de propósito (cenário 1 = defaults
    // reais de produção do EnvironmentProvider); os describes 2/3 as ligam e resetam o cache.
    setEnv('CONEXOS_BASE_URL', `${erpServer.url}/api`);
    setEnv('CONEXOS_USERNAME', 'e2e-service-account');
    setEnv('CONEXOS_PASSWORD', 'e2e-secret');
    setEnv('CONEXOS_FIL_COD', String(FIL_COD));
    setEnv('CONEXOS_WRITE_ENABLED', undefined);
    setEnv('CONEXOS_DRY_RUN', undefined);
    setEnv('SN_GCD_COD', '150');
    setEnv('NDE_POLL_TIMEOUT_MS', '5000');
    setEnv('NDE_POLL_INTERVAL_MS', '25');
    setEnv('NDE_ACL_PREFLIGHT', 'true');
    setEnv('environment', 'local');
    setEnv('client_name', undefined);
    setEnv('databaseConnectionString', undefined); // session-store OFF + sem pool real

    // 3) Imports dinâmicos (depois do env) + fakes de persistência nos tokens DI.
    const { container } = await import('tsyringe');
    containerRef = container;
    const { default: EnvironmentProvider } = await import(
        '../domain/libs/environment/EnvironmentProvider.js'
    );
    environmentProviderCtor = EnvironmentProvider;
    const { default: PostgreeDatabaseClient } = await import(
        '../domain/client/database/PostgreeDatabaseClient.js'
    );
    const { default: TransacaoRepository } = await import(
        '../domain/repository/recebimentos/TransacaoRepository.js'
    );
    const { default: RecebimentoIngestaoRunRepository } = await import(
        '../domain/repository/recebimentos/RecebimentoIngestaoRunRepository.js'
    );
    const { NDE_REPOSITORY_TOKEN, SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN } = await import(
        '../domain/interface/recebimentos/ports.js'
    );

    container.registerInstance(PostgreeDatabaseClient, buildFakeDb() as never);
    const fakeTransacao = buildFakeTransacaoRepo();
    transacaoStore = fakeTransacao.store;
    container.registerInstance(TransacaoRepository, fakeTransacao.repo as never);
    container.registerInstance(RecebimentoIngestaoRunRepository, buildFakeRunRepo() as never);

    // 4) Wiring REAL do bootstrap (sem migrations): adapter Conexos legado (login/sid via HTTP
    // contra o ERP fake) + ports Frente IV; depois o override do ledger SN e do repo NDe in-memory.
    const { buildLegacyConexosAdapter } = await import('../domain/client/legacyConexosAdapter.js');
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
    fakeLedger = buildFakeSnLedger();
    container.register(SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN, {
        useValue: fakeLedger.ledger,
    });
    const fakeNde = buildFakeNdeRepo();
    ndeSaves = fakeNde.saves;
    container.register(NDE_REPOSITORY_TOKEN, { useValue: fakeNde.repo });

    // 5) App Express real (router de recebimentos + errorMiddleware), user admin injetado.
    const { default: recebimentosRouter } = await import('./recebimentos.js');
    const { errorMiddleware } = await import('../http/errorMiddleware.js');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.user = { sub: 'e2e-gates', role: 'admin', email: 'e2e@columbia.test' };
        next();
    });
    app.use('/recebimentos', recebimentosRouter);
    app.use(errorMiddleware);
    appServer = await listen(app);
});

afterAll(async () => {
    await appServer?.close();
    await erpServer?.close();
    for (const [key, value] of envSnapshot) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

// ────────────────────────────────────────────────────────────────────────── cenário 1

describe('GATE 1 — dry-run é o DEFAULT (escrita fechada sem env explícita)', () => {
    const TXN_ID = 'txn-gate-dryrun';
    let body: AnyRecord = {};

    beforeAll(() => {
        // Sem CONEXOS_WRITE_ENABLED e sem CONEXOS_DRY_RUN (defaults REAIS de produção:
        // conexosWriteEnabled=false, conexosDryRun=true). Cache limpo por higiene.
        resetEnvironmentCache();
        seedTransacao(TXN_ID);
    });

    it('a rota solicitacao-numerario devolve status dry-run (gate fechado por default)', async () => {
        const res = await postAlocacao(TXN_ID);
        body = (await res.json()) as AnyRecord;
        expect(res.status).toBe(200);
        expect(body.status).toBe('dry-run');
        expect(body.dryRun).toBe(true);
        // O pré-flight READ-ONLY roda mesmo no preview e classifica a alocação como gerável.
        expect(body.classificacao).toBe('READY');
    });

    it('NENHUMA escrita de documento chegou ao ERP (só login + validadores read-only)', () => {
        // Prova E2E do gate padrão: o ERP fake gravou requests (login + pré-flight aconteceram),
        // mas nenhum endpoint de escrita (gerDocProcesso/fin014/comDocProdutos/homologaNfe/
        // com300/geraObs) e nenhum PUT foram tocados.
        expect(erp.state.requests.length).toBeGreaterThan(0);
        const escritas = erp.state.requests.filter(
            (r) => ESCRITA_ERP_RE.test(r.path) || r.method === 'PUT',
        );
        expect(escritas).toHaveLength(0);
        expect(erp.state.docs.size).toBe(0);
    });

    it('o ledger SN não abriu execução nenhuma (dry-run não passa pelo write-ahead)', () => {
        expect(fakeLedger.rows.size).toBe(0);
        expect(fakeLedger.markErrorCalls).toHaveLength(0);
        // E nenhuma NDe foi registrada — o dry-run nem chega à homologação.
        expect(ndeSaves).toHaveLength(0);
    });
});

// ────────────────────────────────────────────────────────────────────────── cenário 2

describe('GATE 2 — RT-007: docMnyValor=0 pós-homologação NÃO bloqueia (GAP auditado, comportamento pinado)', () => {
    const TXN_ID = 'txn-gate-valor-zero';

    beforeAll(() => {
        // Escrita REAL ligada (POSTs vão para o ERP fake) + modo RT-007: TODA leitura de status
        // com297 APÓS o homologaNfe devolve docMnyValor=0 (a SEFAZ ainda autoriza na 2ª leitura).
        setEnv('CONEXOS_WRITE_ENABLED', 'true');
        setEnv('CONEXOS_DRY_RUN', 'false');
        resetEnvironmentCache();
        erp.state.valorZeroPosHomolog = true;
        erp.state.sefazNuncaAutoriza = false;
        erp.state.homologado = false;
        erp.state.pollsPosHomolog = 0;
        erp.state.obsGerada = false;
        seedTransacao(TXN_ID);
    });

    it('a NDe de valor ZERO é autorizada sem bloqueio e sem revisão humana (GAP RT-007)', async () => {
        // Comportamento ATUAL pinado — NÃO é o desejável fiscalmente: uma NDe homologada com
        // docMnyValor=0 deveria ao menos ir a revisão. Hoje o service só LOGA um warn e segue
        // (`RecebimentoNumerarioService.etapaHomologar`: "0 é aceitável (log, não bloqueia)").
        // Ver GAP RT-007 em `docs/reforma-tributaria/02_auditoria_gap_report.md`.
        const res = await postAlocacao(TXN_ID);
        const body = (await res.json()) as AnyRecord;
        expect(res.status).toBe(200);
        expect(body.status).toBe('settled');
        expect(body.etapa).toBe('concluido');
        expect(body.ndeAutorizado).toBe(true);
        expect(body.revisaoHumana).toBe(false);
        expect(body.dryRun).toBe(false);
        expect(body.snDocCod).toBe(18342);
        expect(body.ndDocCod).toBe(18400);
    });

    it('a homologação REALMENTE aconteceu e o ledger settleou (nada foi barrado pelo valor zero)', () => {
        const homolog = erp.state.requests.find(
            (r) =>
                r.method === 'POST' && r.path === `/api/com297/homologaNfe/${erp.state.ndDocCod}`,
        );
        expect(homolog).toBeDefined();
        const row = fakeLedger.rows.get(`sn-real:${TXN_ID}:${PRI_COD}:${VALOR_EXTRATO}`);
        expect(row?.status).toBe('settled');
        expect(row?.etapa).toBe('concluido');
        expect(row?.ndeAutorizado).toBe(true);
        expect(fakeLedger.markErrorCalls).toHaveLength(0);
        // A NDe de valor zero foi registrada como EMITIDA mesmo assim (o gap não barra nada).
        expect(ndeSaves).toHaveLength(1);
        expect(ndeSaves[0]?.statusEmissao).toBe('emitida');
    });
});

// ────────────────────────────────────────────────────────────────────────── cenário 3

describe('GATE 3 — SEFAZ nunca autoriza: leitura ÚNICA do poll NÃO é erro (autorização reconciliada depois)', () => {
    const TXN_ID = 'txn-gate-sefaz-muda';
    /** Contagem de leituras de status do com297 no describe (o log é compartilhado no arquivo). */
    let marcoRequests = 0;

    beforeAll(() => {
        // Escrita segue ligada (herdada do describe 2 via process.env); SEFAZ em silêncio absoluto
        // (vldAutorizado sempre 0). As envs de poll continuam setadas porque o EnvironmentProvider
        // ainda as expõe, mas NÃO afetam mais o fluxo: a `etapaPoll` faz UMA leitura best-effort —
        // não existe mais loop de até 5 min segurando o request do "Processar".
        setEnv('NDE_POLL_TIMEOUT_MS', '300');
        setEnv('NDE_POLL_INTERVAL_MS', '50');
        resetEnvironmentCache();
        erp.state.valorZeroPosHomolog = false;
        erp.state.sefazNuncaAutoriza = true;
        erp.state.homologado = false;
        erp.state.pollsPosHomolog = 0;
        erp.state.obsGerada = false;
        marcoRequests = erp.state.requests.length;
        seedTransacao(TXN_ID);
    });

    it('SEFAZ em silêncio devolve settled/homologado com ndeAutorizado=false (não é erro)', async () => {
        const res = await postAlocacao(TXN_ID);
        const body = (await res.json()) as AnyRecord;
        expect(res.status).toBe(200);
        // O trabalho do numerário (SN + baixa + NDe homologada) está FEITO → status geral settled...
        expect(body.status).toBe('settled');
        // ...mas a etapa para em 'homologado': quem promove a 'concluido' é a autorização SEFAZ.
        expect(body.etapa).toBe('homologado');
        expect(body.ndeAutorizado).toBe(false);
        expect(body.vldAutorizado).toBe(0);
        expect(body.dryRun).toBe(false);
    });

    it('o poll faz UMA leitura só, sem loop até timeout (2 GETs de status pós-homologação)', () => {
        const paths = erp.state.requests.slice(marcoRequests).map((r) => `${r.method} ${r.path}`);
        const idxHomolog = paths.indexOf(`POST /api/com297/homologaNfe/${erp.state.ndDocCod}`);
        expect(idxHomolog).toBeGreaterThan(-1);
        const leiturasPosHomolog = paths
            .slice(idxHomolog + 1)
            .filter((p) => p === `GET /api/com297/${erp.state.ndDocCod}`);
        // Exatamente 2: a leitura do docMnyValor (dentro da `etapaHomologar`) + a leitura ÚNICA da
        // `etapaPoll`. Antes o poll varria `vldAutorizado` em loop (intervalo × timeout) e o
        // "Processar" ficava girando; agora a autorização assíncrona é reconciliada depois.
        expect(leiturasPosHomolog).toHaveLength(2);
    });

    it('o ledger NÃO registrou erro: settled com nde_autorizado=false, retomável depois', () => {
        expect(fakeLedger.markErrorCalls).toHaveLength(0);
        const row = fakeLedger.rows.get(`sn-real:${TXN_ID}:${PRI_COD}:${VALOR_EXTRATO}`);
        expect(row).toBeDefined();
        // O `markSettled` acontece logo após homologar (o numerário terminou) — a falta de
        // autorização NÃO é erro nem segura o settle; ela vive no flag `nde_autorizado`, que um
        // refresh/re-alocação futuro reconcilia a partir de 'homologado'.
        expect(row?.status).toBe('settled');
        expect(row?.ndeAutorizado).not.toBe(true);
        // A NDe emitida ficou registrada mesmo sem autorização (é o que destrava a reconciliação).
        expect(ndeSaves).toHaveLength(2);
        expect(ndeSaves[1]?.recebimentoId).toBe(TXN_ID);
    });
});

import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';

/**
 * E2E de RETOMADA ANTI-DUPLICAÇÃO da Frente IV — falha parcial do ERP no meio do fluxo de
 * Solicitação de Numerário/NDe e retomada pela MESMA alocação (mesma idempotency key).
 *
 * Cenário: a SN (com299) é gerada e FINALIZADA com sucesso, mas o `POST /api/fin014` (criar
 * borderô) responde 500 (interruptor `falharFin014` do ERP fake). O orquestrador
 * (`RecebimentoNumerarioService`) deve registrar `status:'error'` com `etapa:'fin014'` e o
 * `docCod` da SN PRESERVADO no ledger. Curado o ERP, um re-POST idêntico deve RETOMAR do ponto
 * da falha: NÃO recriar a SN (`com299/gerDocProcesso` 1x no log inteiro), NÃO re-finalizar
 * (`com299/finalizaDocumento` 1x — `etapaSn` pula a finalização quando `existente.etapa` já
 * passou de 'sn'), e completar fin014 → NDe → fiscal → obs → homologação → SEFAZ.
 *
 * Asserts terminais anti-duplicação de DINHEIRO: exatamente 1 `POST /api/fin014/baixas` e
 * 1 `POST /api/com297/homologaNfe/...` no request log inteiro do ERP.
 *
 * Harness idêntico ao `recebimentos.e2e.test.ts` (ERP fake HTTP local + fakes in-memory de
 * persistência + rotas Express reais, escrita ligada) — ver os comentários de lá.
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
    /** Interruptor da falha parcial: `POST /api/fin014` (criar borderô) responde 500. */
    falharFin014: boolean;
}

const VALOR_EXTRATO = 182347.65;
const GER_NUM = 38;
const FIL_COD = 1;
const PES_COD = 696;
const PRI_COD = 1153;
const SN_DOC_COD = 18342;
const ND_DOC_COD = 18400;

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

/** finDocFiscal do com300 (subset dos ~73 campos). */
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
        snDocCod: SN_DOC_COD,
        ndDocCod: ND_DOC_COD,
        homologado: false,
        obsGerada: false,
        pollsPosHomolog: 0,
        falharFin014: false,
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

    // ── leitura: contas (fin133) + extrato (fin095) + processos (imp021) ──
    app.post('/api/fin133/list', (_req, res) => {
        res.json({
            count: 1,
            rows: [
                {
                    gerNum: GER_NUM,
                    gerDes: 'BANCO ITAU - AG 0641 CONTA 55795-4',
                    bncCod: '341',
                    qtdeBanco: 1,
                    qtdeSistema: 0,
                },
            ],
        });
    });
    app.post('/api/fin095/list', (_req, res) => {
        res.json({
            count: 1,
            rows: [
                {
                    extCod: 137,
                    exiCodSeq: 128,
                    exiDtaLcto: Date.now() - 24 * 60 * 60 * 1000,
                    exiVldTipo: 2,
                    exiMnyLcto: VALOR_EXTRATO,
                    exiEspNrdocto: '20260802128',
                    exiEspHistorico: 'PIX RECEBIDO  BELLIZ INDUSTRIA E COM',
                    exiEspCategoria: '299',
                    exiEspCategoriaDesc: 'CREDITO DESCONHECIDO',
                },
            ],
        });
    });
    app.post('/api/imp021/list', (_req, res) => {
        res.json({
            count: 1,
            rows: [
                {
                    priCod: PRI_COD,
                    pesCod: PES_COD,
                    dpeNomPessoa: 'BELLIZ INDUSTRIA E COMERCIO LTDA',
                    priEspRefcliente: 'REF-2026-001',
                    priVldTipo: 3,
                    priDtaAbertura: Date.now() - 30 * 24 * 60 * 60 * 1000,
                    filCod: FIL_COD,
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
    // O interruptor da falha parcial: criar borderô 500 enquanto `falharFin014` estiver ligado.
    app.post('/api/fin014', (_req, res) => {
        if (state.falharFin014) {
            res.status(500).json({
                messages: [{ valid: 'ERRO', message: 'ORA-00600 simulated ERP outage (fin014)' }],
            });
            return;
        }
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

    // ── homologação + poll ──
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
        // gerDocProcesso — não há mais POST em `com297/comDocProdutos`. A SN (com299) continua
        // ganhando valor pela linha de item (`comDocProdutos`), como no HAR real.
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

    // com297: status p/ pré-condição de homologação + poll SEFAZ (autoriza na 2ª leitura
    // pós-homologação). `docEspNumero` OMITIDO enquanto nulo — o Zod do client rejeita null.
    const statusCom297 = (doc: Record<string, unknown>): Record<string, unknown> => {
        let vldAutorizado = 0;
        if (state.homologado) {
            state.pollsPosHomolog += 1;
            vldAutorizado = state.pollsPosHomolog >= 2 ? 1 : 0;
        }
        return {
            ...doc,
            vldTpNf: '10',
            vldAutorizado,
            docVldNfehom: state.homologado ? 1 : 0,
            vldStatus: state.homologado ? 2 : 1,
            docVldConferencia: 0,
            vldEnviarConferencia: 0,
            docMnyValor: (doc.docMnyValor as number) ?? 0,
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

const buildFakeTransacaoRepo = (): {
    repo: AnyRecord;
    store: Map<string, FakeTransacao>;
} => {
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
                    const atual = store.get(existenteId);
                    if (atual?.status === 'importada') store.set(existenteId, { ...atual, ...t });
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
        markError: async (key: string, data: AnyRecord) => touch(key, { ...data, status: 'error' }),
    };
    return { ledger, rows };
};

/**
 * Repositório in-memory da NDe (`nota_debito_eletronica`): logo após homologar, o service registra a
 * NDe emitida como entidade de 1ª classe (auditoria + aba NDe do painel). Sem este fake o token
 * resolveria o repositório REAL (Postgres) e a etapa `homologado` estouraria. `saves` guarda cada
 * chamada — na retomada é mais uma prova de que a NDe não foi emitida/gravada duas vezes.
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

describe('E2E Recebimentos — RETOMADA anti-duplicação após falha parcial do ERP no fin014', () => {
    let erp: { app: express.Express; state: ErpState };
    let erpServer: TestServer;
    let appServer: TestServer;
    let snLedgerRows: Map<string, AnyRecord>;
    let ndeSaves: AnyRecord[];
    let txnId = '';
    let processo: AnyRecord = {};
    // Snapshot do env: o worker do Jest reusa o processo entre arquivos — restaurar no afterAll
    // impede que CONEXOS_WRITE_ENABLED=true / CONEXOS_DRY_RUN=false vazem para outra suíte.
    const envSnapshot = new Map<string, string | undefined>();
    const setEnv = (key: string, value: string | undefined): void => {
        if (!envSnapshot.has(key)) envSnapshot.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };

    /** Conta requests do ERP por método + predicado de path (log inteiro desde o beforeAll). */
    const countReq = (method: string, match: (path: string) => boolean): number =>
        erp.state.requests.filter((r) => r.method === method && match(r.path)).length;

    /** Corpo da alocação — IDÊNTICO nas duas tentativas (mesma idempotency key). */
    const alocacaoBody = (): AnyRecord => ({
        priCod: processo.priCod,
        valor: VALOR_EXTRATO,
        filCod: processo.filCod,
        priEspRefcliente: processo.priEspRefcliente,
        pesCod: processo.pesCod,
        dpeNomPessoa: processo.dpeNomPessoa,
        moeCod: 790,
    });

    beforeAll(async () => {
        // 1) ERP fake no ar ANTES de qualquer import de módulo que leia env no import.
        erp = buildErp();
        erpServer = await listen(erp.app);

        // 2) Env do cenário: escrita REAL ligada (os POSTs vão para o ERP FAKE), sem Postgres.
        setEnv('CONEXOS_BASE_URL', `${erpServer.url}/api`);
        setEnv('CONEXOS_USERNAME', 'e2e-service-account');
        setEnv('CONEXOS_PASSWORD', 'e2e-secret');
        setEnv('CONEXOS_FIL_COD', String(FIL_COD));
        setEnv('CONEXOS_WRITE_ENABLED', 'true');
        setEnv('CONEXOS_DRY_RUN', 'false');
        setEnv('SN_GCD_COD', '150');
        setEnv('RECEBIMENTO_INGEST_FIL_CODS', String(FIL_COD));
        setEnv('RECEBIMENTO_INGEST_DIAS', '30');
        setEnv('NDE_POLL_TIMEOUT_MS', '5000');
        setEnv('NDE_POLL_INTERVAL_MS', '25');
        setEnv('NDE_ACL_PREFLIGHT', 'true');
        setEnv('environment', 'local');
        setEnv('client_name', undefined);
        setEnv('databaseConnectionString', undefined); // session-store OFF + sem pool real

        // 3) Imports dinâmicos (depois do env) + fakes de persistência nos tokens DI.
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
        const { NDE_REPOSITORY_TOKEN, SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN } =
            await import('../domain/interface/recebimentos/ports.js');

        container.registerInstance(PostgreeDatabaseClient, buildFakeDb() as never);
        const { repo: fakeTransacaoRepo } = buildFakeTransacaoRepo();
        container.registerInstance(TransacaoRepository, fakeTransacaoRepo as never);
        container.registerInstance(RecebimentoIngestaoRunRepository, buildFakeRunRepo() as never);

        // 4) Wiring REAL do bootstrap (sem migrations): adapter Conexos legado (login/sid via
        // HTTP contra o ERP fake) + ports Frente IV; depois o override do ledger SN e do repo NDe.
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
        const fakeNde = buildFakeNdeRepo();
        ndeSaves = fakeNde.saves;
        container.register(NDE_REPOSITORY_TOKEN, { useValue: fakeNde.repo });

        // 5) App Express real (router de recebimentos + errorMiddleware), user admin injetado.
        const { default: recebimentosRouter } = await import('./recebimentos.js');
        const { errorMiddleware } = await import('../http/errorMiddleware.js');
        const app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.user = { sub: 'e2e-auditor', role: 'admin', email: 'e2e@columbia.test' };
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

    it('1. arrange: ingestão + painel + processo do modal Alocar (harness pronto)', async () => {
        const ing = await postJson(`${appServer.url}/recebimentos/ingestao`, {});
        const ingBody = (await ing.json()) as AnyRecord;
        expect(ing.status).toBe(200);
        expect(ingBody.total).toBe(1);

        const painel = (await (
            await fetch(`${appServer.url}/recebimentos/painel`)
        ).json()) as AnyRecord;
        const transacoes = painel.transacoes as AnyRecord[];
        expect(transacoes).toHaveLength(1);
        txnId = String(transacoes[0].id);
        expect(txnId.length).toBeGreaterThan(0);
        expect(transacoes[0].gerNum).toBe(GER_NUM);

        const res = await fetch(
            `${appServer.url}/recebimentos/transacoes/${txnId}/processos?pesCod=${PES_COD}`,
        );
        const body = (await res.json()) as AnyRecord;
        const processos = body.processos as AnyRecord[];
        expect(processos).toHaveLength(1);
        processo = processos[0];
        expect(processo.priCod).toBe(PRI_COD);
    });

    it('2. falha parcial: fin014 (criar borderô) 500 → HTTP 200 status=error, etapa=fin014, snDocCod presente (a SN FOI criada e finalizada)', async () => {
        erp.state.falharFin014 = true;
        const res = await postJson(
            `${appServer.url}/recebimentos/transacoes/${txnId}/solicitacao-numerario`,
            alocacaoBody(),
        );
        const body = (await res.json()) as AnyRecord;
        // A rota devolve HTTP 200 mesmo em erro de etapa — o `status` carrega o desfecho.
        expect(res.status).toBe(200);
        expect(body.status).toBe('error');
        // Etapa registrada pelo orquestrador: a falha estourou dentro de `etapaFin014` (criar
        // borderô), logo o `registrarFalha` grava 'fin014'.
        expect(body.etapa).toBe('fin014');
        // A SN foi criada E finalizada ANTES da falha — o handle sobrevive no resultado.
        expect(body.snDocCod).toBe(SN_DOC_COD);
        expect(body.borCod).toBeUndefined();
        expect(body.ndDocCod).toBeUndefined();
        expect(typeof body.erro).toBe('string');

        // Estado do request log após a 1ª tentativa: SN gerada (1x) + finalizada (1x); o criar
        // borderô foi tentado 1x (postGeneric NÃO faz retry em 500 — só re-login em 401) e NADA
        // além dele: zero baixas, zero NDe.
        expect(countReq('POST', (p) => p === '/api/com299/gerDocProcesso')).toBe(1);
        expect(countReq('POST', (p) => p.startsWith('/api/com299/finalizaDocumento/'))).toBe(1);
        expect(countReq('POST', (p) => p === '/api/fin014')).toBe(1);
        expect(countReq('POST', (p) => p === '/api/fin014/baixas')).toBe(0);
        expect(countReq('POST', (p) => p === '/api/com297/gerDocProcesso')).toBe(0);
    });

    it('3. ledger: row status=error com docCod da SN PRESERVADO (retomada possível, não órfã)', () => {
        expect(snLedgerRows.size).toBe(1);
        const [key, row] = [...snLedgerRows.entries()][0];
        // Idempotency key POR ALOCAÇÃO: sn-real:{txnId}:{priCod}:{valor}.
        expect(key).toBe(`sn-real:${txnId}:${PRI_COD}:${VALOR_EXTRATO}`);
        expect(row.status).toBe('error');
        // O CORAÇÃO da retomada: `setDocCod` rodou antes da falha, então o `checarBloqueio`
        // NÃO trata a row como "reconciling órfã sem docCod" (que bloquearia o retry
        // fail-closed) — com docCod gravado + status error, o re-POST RETOMA.
        expect(row.docCod).toBe(SN_DOC_COD);
        expect(row.etapa).toBe('fin014');
        expect(row.fin014BorCod).toBeUndefined();
        expect(row.ndDocCod).toBeUndefined();
    });

    it('4. retomada: ERP curado + re-POST idêntico → settled/concluido SEM recriar nem re-finalizar a SN', async () => {
        erp.state.falharFin014 = false;
        const res = await postJson(
            `${appServer.url}/recebimentos/transacoes/${txnId}/solicitacao-numerario`,
            alocacaoBody(),
        );
        const body = (await res.json()) as AnyRecord;
        expect(res.status).toBe(200);
        expect(body.status).toBe('settled');
        expect(body.etapa).toBe('concluido');
        expect(body.snDocCod).toBe(SN_DOC_COD);
        expect(body.borCod).toBe(9001);
        expect(body.ndDocCod).toBe(ND_DOC_COD);
        expect(body.ndeAutorizado).toBe(true);
        expect(body.revisaoHumana).toBe(false);
        expect(body.dryRun).toBe(false);

        // Ledger fechou o ciclo.
        const row = [...snLedgerRows.values()][0];
        expect(row.status).toBe('settled');
        expect(row.etapa).toBe('concluido');
        expect(row.ndeAutorizado).toBe(true);
        expect(row.fin014BorCod).toBe(9001);
        expect(row.ndDocCod).toBe(ND_DOC_COD);

        // O CORAÇÃO do teste — comportamento REAL observado da retomada no request log:
        //   • `com299/gerDocProcesso` = 1 no TOTAL: a SN NÃO foi recriada (a `etapaSn` viu o
        //     `docCod` gravado no ledger e pulou geração + completarSnAdiantamento);
        //   • `com299/finalizaDocumento` = 1 no TOTAL: a finalização NÃO repetiu (a `etapaSn`
        //     só re-finaliza quando `existente.etapa` é undefined ou 'sn'; aqui a row estava em
        //     'fin014', que já passou de 'sn-finalizar');
        //   • `comDocProdutos` da com299 (linha de item da SN) = 1 no TOTAL, pelo mesmo skip;
        //   • `POST /api/fin014` (criar borderô) = 2 no TOTAL: 1 tentativa falhada (500) + 1 da
        //     retomada. O borderô É recriado — o `borCod` nunca chegou a ser gravado no ledger
        //     (a criação falhou), e um borderô sem baixa é inócuo (doutrina do client fin010/014).
        //     NÃO é duplicação de dinheiro: a baixa (abaixo) aconteceu exatamente 1x.
        expect(countReq('POST', (p) => p === '/api/com299/gerDocProcesso')).toBe(1);
        expect(countReq('POST', (p) => p.startsWith('/api/com299/finalizaDocumento/'))).toBe(1);
        expect(countReq('POST', (p) => p === '/api/com299/comDocProdutos')).toBe(1);
        expect(countReq('POST', (p) => p === '/api/fin014')).toBe(2);
    });

    it('5. anti-duplicação de DINHEIRO no log inteiro: 1 baixa fin014 + 1 homologação NDe (e 1 NDe/fiscal/obs)', () => {
        // As escritas irreversíveis aconteceram EXATAMENTE 1 vez cada, somando as 2 tentativas.
        expect(countReq('POST', (p) => p === '/api/fin014/baixas')).toBe(1);
        expect(countReq('POST', (p) => p.startsWith('/api/com297/homologaNfe/'))).toBe(1);
        // Rota de contingência intocada (vldTpNf '10' → homologação normal).
        expect(countReq('POST', (p) => p.startsWith('/api/com297/homologaNfeContingencia'))).toBe(
            0,
        );
        // Cauda da NDe também sem repetição: geração, fiscal RMW e observações 1x cada.
        expect(countReq('POST', (p) => p === '/api/com297/gerDocProcesso')).toBe(1);
        // O produto da NDe (41978) viaja no HEADER dessa geração — o POST separado de item
        // (`com297/comDocProdutos`) não existe mais no produto (ao vivo: 400 `docVldTipo required`).
        // A anti-duplicação do item é, portanto, a própria geração única acima.
        expect(countReq('POST', (p) => p === '/api/com297/comDocProdutos')).toBe(0);
        const geracoesNde = erp.state.requests.filter(
            (r) => r.method === 'POST' && r.path === '/api/com297/gerDocProcesso',
        );
        expect(geracoesNde.map((r) => r.body.prdCod)).toEqual([41978]);
        expect(countReq('PUT', (p) => p === '/api/com300')).toBe(1);
        expect(countReq('POST', (p) => p === '/api/com131/geraObs')).toBe(1);
        // E a NDe foi registrada como entidade exatamente 1x nas duas tentativas (sem duplicar).
        expect(ndeSaves).toHaveLength(1);
        expect(ndeSaves[0]?.idempotencyKey).toBe(`sn-real:${txnId}:${PRI_COD}:${VALOR_EXTRATO}`);
        // E o borderô finalizado só na retomada (a 1ª tentativa nem chegou a criar um).
        expect(countReq('POST', (p) => p.startsWith('/api/fin014/finalizar/'))).toBe(1);
    });
});

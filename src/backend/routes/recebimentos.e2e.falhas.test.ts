import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';

/**
 * E2E de FALHAS FISCAIS da Frente IV — cenários onde a cauda fiscal da Solicitação de Numerário/NDe
 * NÃO conclui limpa. Mesmo harness do `recebimentos.e2e.test.ts` (rotas Express reais + services +
 * clients Conexos reais via HTTP contra um ERP fake local + fakes in-memory de persistência), mas o
 * ERP fake é PARAMETRIZÁVEL por cenário (extrato/vldTpNf/resultado da homologação/ACL mutáveis):
 *
 *   1. homologação devolve `docVldComvalidacoes:2` → settled COM `revisaoHumana` + consulta com194;
 *   2. homologação devolve `docVldComvalidacoes:99` → `error`, NADA acontece depois da rejeição;
 *   3. `vldTpNf` desconhecido (`'99'`) no GET com297 → `error` SEM nunca chamar `homologaNfe`
 *      (fail-closed do `ContingenciaDecider`);
 *   4. ACL da conta de serviço sem `com194` → HTTP 403 `NDE_ACL_INSUFICIENTE`, nenhuma escrita no ERP.
 *
 * Cada cenário ingere um extrato PRÓPRIO (extCod/exiCodSeq/valor únicos → natural key e idempotency
 * key `sn-real:{txnId}:{priCod}:{valor}` não colidem entre cenários).
 */

jest.setTimeout(120_000);

// O bootstrap REAL importa `migrations/runMigrations.ts` (usa `import.meta`, incompatível com o
// transform CJS do ts-jest). Mockamos SÓ o bootstrap e refazemos o wiring REAL dele no beforeAll
// (adapter Conexos legado + ports Frente IV) — sem migrations, que aqui são substituídas pelos
// fakes in-memory de persistência.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────── ERP fake (HTTP local)

interface ErpRequest {
    method: string;
    path: string;
    body: Record<string, unknown>;
}

/** Sub-estado MUTÁVEL por cenário — cada describe o re-arma via `armarCenario`. */
interface CenarioErp {
    /** Linha única do fin095 do cenário (natural key = extCod/exiCodSeq — varia por cenário). */
    extrato: { extCod: number; exiCodSeq: number; valor: number };
    /** `vldTpNf` que o GET com297/{docCod} devolve ('10' normal; '99' desconhecido = cenário 3). */
    vldTpNf: string;
    /** `docVldComvalidacoes` da resposta do POST homologaNfe (1 limpo / 2 aviso / 99 rejeitada). */
    homologDocVldComvalidacoes: number;
    /** Linhas de erro que o com194/documento/list devolve (cenário 1). */
    com194Rows: Array<Record<string, unknown>>;
    /** Ações da ACL da conta de serviço (cenário 4 remove o com194). */
    aclAcoes: string[];
    /**
     * `imp021.priVldTipo` do processo — modalidade. `3` (POR ENCOMENDA) = trilha completa com NDe;
     * `2` (POR CONTA E ORDEM DE TERCEIROS) dispensa a nota (cenário 5, ADR-0031).
     */
    priVldTipo: number;
}

interface ErpState {
    requests: ErpRequest[];
    /** docCods emitidos por tela (com299 → SN; com297 → NDe). */
    docs: Map<string, Record<string, unknown>>;
    proximoSnDocCod: number;
    proximoNdDocCod: number;
    homologado: boolean;
    obsGerada: boolean;
    /** nº de leituras do status com297 APÓS a homologação (SEFAZ autoriza na 2ª). */
    pollsPosHomolog: number;
    cenario: CenarioErp;
}

const GER_NUM = 38;
const FIL_COD = 1;
const PES_COD = 696;
const PRI_COD = 1153;

const ACL_COMPLETA: readonly string[] = [
    'com300 UPDATE',
    'com131 GERAR OBS',
    'com297 HOMOLOGAR DOCUMENTO',
    'com297 HOMOLOGAR DOCUMENTO CONTINGENCIA',
    'com194 SELECT',
];

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

const cenarioDefault = (): CenarioErp => ({
    extrato: { extCod: 900, exiCodSeq: 1, valor: 100 },
    vldTpNf: '10',
    homologDocVldComvalidacoes: 1,
    com194Rows: [],
    aclAcoes: [...ACL_COMPLETA],
    priVldTipo: 3,
});

const buildErp = (): { app: express.Express; state: ErpState } => {
    const state: ErpState = {
        requests: [],
        docs: new Map(),
        proximoSnDocCod: 18342,
        proximoNdDocCod: 18400,
        homologado: false,
        obsGerada: false,
        pollsPosHomolog: 0,
        cenario: cenarioDefault(),
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
        const { extCod, exiCodSeq, valor } = state.cenario.extrato;
        res.json({
            count: 1,
            rows: [
                {
                    extCod,
                    exiCodSeq,
                    exiDtaLcto: Date.now() - 24 * 60 * 60 * 1000,
                    exiVldTipo: 2,
                    exiMnyLcto: valor,
                    exiEspNrdocto: `2026${extCod}${exiCodSeq}`,
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
                    priVldTipo: state.cenario.priVldTipo,
                    priDtaAbertura: Date.now() - 30 * 24 * 60 * 60 * 1000,
                    filCod: FIL_COD,
                },
            ],
        });
    });

    // ── ACL da conta de serviço (mutável por cenário — o 4 remove o com194) ──
    app.get('/api/permissoes/new/com297', (_req, res) => {
        res.json({ acoes: state.cenario.aclAcoes });
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
        const docCod = Number(filtro['docCod#EQ'] ?? state.proximoSnDocCod);
        res.json({
            rows: [
                {
                    docCod,
                    titCod: 1,
                    titEspNumero: '02082026',
                    titMnyAberto: state.cenario.extrato.valor,
                },
            ],
        });
    });

    // ── fin014 (borderô + baixa do título da SN) ──
    app.post('/api/fin014/baixas/validacao/tituloBaixa', (_req, res) => {
        res.json({
            messages: [],
            responseData: {
                bxaMnyValor: state.cenario.extrato.valor,
                bxaMnyLiquido: state.cenario.extrato.valor,
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

    // ── com194 (validações — o cenário 1 devolve 1 linha de erro) ──
    app.post('/api/com194/documento/list', (_req, res) => {
        res.json({ rows: state.cenario.com194Rows });
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

    // ── homologação (resultado parametrizado por cenário) + poll ──
    const responderHomologacao = (res: express.Response): void => {
        state.homologado = true;
        state.pollsPosHomolog = 0;
        const docVldComvalidacoes = state.cenario.homologDocVldComvalidacoes;
        res.json({
            docVldComvalidacoes,
            // docEspNumero OMITIDO na rejeição (Zod rejeita null — só manda quando emitiu).
            ...(docVldComvalidacoes === 1 || docVldComvalidacoes === 2
                ? { docEspNumero: '000000123' }
                : {}),
        });
    };
    app.post('/api/com297/homologaNfe/:docCod', (_req, res) => {
        responderHomologacao(res);
    });
    app.post('/api/com297/homologaNfeContingencia/:docCod', (_req, res) => {
        responderHomologacao(res);
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
        let docCod: number;
        if (tela === 'com297') {
            state.proximoNdDocCod += 1;
            docCod = state.proximoNdDocCod;
        } else {
            state.proximoSnDocCod += 1;
            docCod = state.proximoSnDocCod;
        }
        // A NDe (com297) nasce JÁ com o produto (`prdCod` 41978) e o valor no HEADER do
        // gerDocProcesso — não há mais POST em `com297/comDocProdutos`. A SN (com299) continua
        // ganhando valor pela linha de item (`comDocProdutos`), como no HAR real.
        const body = (req.body ?? {}) as Record<string, unknown>;
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

    // com297: status p/ pré-condição de homologação + poll SEFAZ. `vldTpNf` vem do CENÁRIO (o 3 usa
    // '99' desconhecido). A SEFAZ é assíncrona: a 1ª leitura pós-homologação vê vldAutorizado=0.
    const statusCom297 = (doc: Record<string, unknown>): Record<string, unknown> => {
        let vldAutorizado = 0;
        if (state.homologado) {
            state.pollsPosHomolog += 1;
            vldAutorizado = state.pollsPosHomolog >= 2 ? 1 : 0;
        }
        return {
            ...doc,
            vldTpNf: state.cenario.vldTpNf,
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
    /** Ausente = conta corporativa (fin095, ADR-0032). */
    filCod?: number;
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
        // Espelha o `buildFiltro` real: `filCod` ausente = conta CORPORATIVA (fin095, ADR-0032)
        // e passa em qualquer conjunto de filiais permitidas.
        if (t.filCod !== undefined && !filCods.includes(t.filCod)) return false;
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
            const okRuns = [...runs.values()].filter((r) => r.status === 'success' && r.finishedAt);
            const last = okRuns[okRuns.length - 1];
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
        markError: async (key: string, data: AnyRecord) => touch(key, { ...data, status: 'error' }),
    };
    return { ledger, rows };
};

/**
 * Repositório in-memory da NDe (`nota_debito_eletronica`): logo após homologar, o service registra a
 * NDe emitida como entidade de 1ª classe (auditoria + aba NDe do painel). Sem este fake o token
 * resolveria o repositório REAL (Postgres) e a etapa `homologado` estouraria. `saves` guarda cada
 * chamada — só o cenário que chega a homologar deve gravar alguma coisa.
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

describe('E2E Recebimentos — FALHAS fiscais da SN/NDe (ERP fake parametrizável, escrita ligada)', () => {
    let erp: { app: express.Express; state: ErpState };
    let erpServer: TestServer;
    let appServer: TestServer;
    let snLedgerRows: Map<string, AnyRecord>;
    let ndeSaves: AnyRecord[];
    // Snapshot do env: o worker do Jest reusa o processo entre arquivos — restaurar no afterAll
    // impede que CONEXOS_WRITE_ENABLED=true / CONEXOS_DRY_RUN=false vazem para outra suíte.
    const envSnapshot = new Map<string, string | undefined>();
    const setEnv = (key: string, value: string | undefined): void => {
        if (!envSnapshot.has(key)) envSnapshot.set(key, process.env[key]);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    };

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
            req.user = {
                sub: 'e2e-auditor',
                role: 'admin',
                email: 'e2e@columbia.test',
                username: 'e2e@columbia.test',
            };
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

    /** Re-arma o ERP fake para um cenário: extrato próprio + comportamento fiscal + ACL. */
    const armarCenario = (cfg: Partial<CenarioErp> & { extrato: CenarioErp['extrato'] }): void => {
        erp.state.cenario = { ...cenarioDefault(), ...cfg };
        erp.state.homologado = false;
        erp.state.obsGerada = false;
        erp.state.pollsPosHomolog = 0;
    };

    /** Ingere o extrato do cenário corrente e devolve o txnId do crédito (achado pelo valor). */
    const ingerirEEncontrarTxn = async (valor: number): Promise<string> => {
        const ing = await postJson(`${appServer.url}/recebimentos/ingestao`, {});
        const ingBody = (await ing.json()) as AnyRecord;
        expect(ing.status).toBe(200);
        expect(ingBody.total).toBe(1);
        expect(ingBody.deduplicadas).toBe(0);

        const painel = await fetch(`${appServer.url}/recebimentos/painel`);
        const painelBody = (await painel.json()) as AnyRecord;
        expect(painel.status).toBe(200);
        const txn = (painelBody.transacoes as AnyRecord[]).find((t) => t.valor === valor);
        expect(txn).toBeDefined();
        return String((txn as AnyRecord).id);
    };

    /** POST "Processar" (SN real) da alocação txn × processo — corpo mínimo do contrato da rota. */
    const alocar = (txnId: string, valor: number): Promise<Response> =>
        postJson(`${appServer.url}/recebimentos/transacoes/${txnId}/solicitacao-numerario`, {
            priCod: PRI_COD,
            valor,
            filCod: FIL_COD,
            priEspRefcliente: 'REF-2026-001',
            pesCod: PES_COD,
            dpeNomPessoa: 'BELLIZ INDUSTRIA E COMERCIO LTDA',
            moeCod: 790,
        });

    const pathsDesde = (mark: number): string[] =>
        erp.state.requests.slice(mark).map((r) => `${r.method} ${r.path}`);

    // ────────────────────────────── Cenário 1 — homologada COM validações pendentes (aviso 2)

    describe('Cenário 1 — homologação devolve docVldComvalidacoes=2 (validações pendentes)', () => {
        const VALOR = 1111.11;

        it('settla COM revisaoHumana=true, propaga docVldComvalidacoes=2 e consulta o com194', async () => {
            armarCenario({
                extrato: { extCod: 201, exiCodSeq: 11, valor: VALOR },
                homologDocVldComvalidacoes: 2,
                com194Rows: [
                    {
                        fdvCodSeq: 1,
                        fdvEspErr: 'CFOP INCOMPATIVEL COM O TIPO DO DOCUMENTO',
                        fdvEspObs: 'REVISAR CLASSIFICACAO FISCAL',
                        fdvVldErr: 1,
                    },
                ],
            });
            const txnId = await ingerirEEncontrarTxn(VALOR);
            const mark = erp.state.requests.length;

            const res = await alocar(txnId, VALOR);
            const body = (await res.json()) as AnyRecord;
            expect(res.status).toBe(200);
            expect(body.status).toBe('settled');
            expect(body.etapa).toBe('concluido');
            expect(body.revisaoHumana).toBe(true);
            expect(body.docVldComvalidacoes).toBe(2);
            expect(body.ndeAutorizado).toBe(true);

            // DUAS consultas ao com194, uma em cada etapa — e o teste exige as duas, não "alguma".
            // (a) na etapa da SN, ANTES de homologar: decide se o ERP exige a condição do cadastro;
            // (b) depois da homologação com `docVldComvalidacoes=2`: lê as validações pendentes.
            // Asseverar só a segunda deixaria um refactor remover a primeira em silêncio — e é ela que
            // impede o PUT que destrói o título (doc 735 do HML).
            const paths = pathsDesde(mark);
            const idxHomolog = paths.findIndex((p) => p.includes('POST /api/com297/homologaNfe/'));
            const com194 = paths.reduce<number[]>(
                (idxs, p, i) => (p === 'POST /api/com194/documento/list' ? [...idxs, i] : idxs),
                [],
            );
            expect(idxHomolog).toBeGreaterThan(-1);
            expect(com194.filter((i) => i < idxHomolog)).toHaveLength(1);
            expect(com194.filter((i) => i > idxHomolog)).toHaveLength(1);

            // Ledger write-ahead: settla, mas com a revisão humana gravada.
            const row = snLedgerRows.get(`sn-real:${txnId}:${PRI_COD}:${VALOR}`);
            expect(row?.status).toBe('settled');
            expect(row?.revisaoHumana).toBe(true);

            // A NDe foi registrada como EMITIDA mesmo com validações pendentes (a revisão humana é
            // um flag da execução, não um bloqueio da emissão).
            const nde = ndeSaves.find((n) => n.recebimentoId === txnId);
            expect(nde).toBeDefined();
            expect(nde?.statusEmissao).toBe('emitida');
            expect(nde?.valor).toBe(VALOR);
        });
    });

    // ────────────────────────────── Cenário 2 — homologação REJEITADA (docVldComvalidacoes=99)

    describe('Cenário 2 — homologação devolve docVldComvalidacoes=99 (rejeitada)', () => {
        const VALOR = 2222.22;

        it('vira status=error e NADA acontece depois da rejeição (sem poll, sem escrita nova)', async () => {
            armarCenario({
                extrato: { extCod: 202, exiCodSeq: 22, valor: VALOR },
                homologDocVldComvalidacoes: 99,
            });
            const txnId = await ingerirEEncontrarTxn(VALOR);
            const mark = erp.state.requests.length;

            const res = await alocar(txnId, VALOR);
            const body = (await res.json()) as AnyRecord;
            expect(res.status).toBe(200); // HTTP 200 mesmo em erro de etapa — o status carrega o resultado
            expect(body.status).toBe('error');
            expect(String(body.erro ?? '')).not.toBe('');

            // O POST de homologação aconteceu — e foi o ÚLTIMO request do fluxo: nenhum poll
            // (GET com297/{docCod}) e nenhuma escrita depois da rejeição.
            const paths = pathsDesde(mark);
            const idxHomolog = paths.findIndex((p) => p.includes('POST /api/com297/homologaNfe/'));
            expect(idxHomolog).toBeGreaterThan(-1);
            expect(paths.slice(idxHomolog + 1)).toHaveLength(0);

            // O ledger NÃO marcou autorizado — a falha ficou registrada (fail-closed).
            const row = snLedgerRows.get(`sn-real:${txnId}:${PRI_COD}:${VALOR}`);
            expect(row?.status).toBe('error');
            expect(row?.ndeAutorizado).not.toBe(true);
            // E NENHUMA NDe foi registrada para esta transação — a rejeição aborta antes do save.
            expect(ndeSaves.some((n) => n.recebimentoId === txnId)).toBe(false);
        });
    });

    // ────────────────────────────── Cenário 3 — vldTpNf DESCONHECIDO (fail-closed do decider)

    describe("Cenário 3 — GET com297 devolve vldTpNf='99' (desconhecido)", () => {
        const VALOR = 3333.33;

        it('vira status=error SEM nunca chamar homologaNfe (fail-closed do ContingenciaDecider)', async () => {
            armarCenario({
                extrato: { extCod: 203, exiCodSeq: 33, valor: VALOR },
                vldTpNf: '99',
            });
            const txnId = await ingerirEEncontrarTxn(VALOR);
            const mark = erp.state.requests.length;

            const res = await alocar(txnId, VALOR);
            const body = (await res.json()) as AnyRecord;
            expect(res.status).toBe(200);
            expect(body.status).toBe('error');

            // NENHUMA homologação disparada — nem normal nem contingência (substring cobre ambas).
            const paths = pathsDesde(mark);
            const homologs = paths.filter((p) => p.includes('homologaNfe'));
            expect(homologs).toHaveLength(0);

            const row = snLedgerRows.get(`sn-real:${txnId}:${PRI_COD}:${VALOR}`);
            expect(row?.status).toBe('error');
        });
    });

    // ────────────────────────────── Cenário 4 — ACL da conta de serviço SEM o com194

    describe('Cenário 4 — ACL sem o grant com194 (pré-flight fail-closed)', () => {
        const VALOR = 4444.44;

        it('responde 403 NDE_ACL_INSUFICIENTE e NÃO escreve nada no ERP', async () => {
            armarCenario({
                extrato: { extCod: 204, exiCodSeq: 44, valor: VALOR },
                aclAcoes: ACL_COMPLETA.filter((a) => !a.includes('com194')),
            });
            const txnId = await ingerirEEncontrarTxn(VALOR);
            const mark = erp.state.requests.length;

            const res = await alocar(txnId, VALOR);
            const body = (await res.json()) as AnyRecord;
            expect(res.status).toBe(403);
            expect(body.code).toBe('NDE_ACL_INSUFICIENTE');
            expect(String(body.motivo ?? '')).toContain('com194');

            // Nenhuma escrita no ERP — o request log só tem leituras (GET) e login.
            const escritas = erp.state.requests
                .slice(mark)
                .filter((r) => r.method !== 'GET' && !r.path.endsWith('/login'));
            expect(escritas).toHaveLength(0);

            // Nada chegou ao ledger (o 403 acontece ANTES do service).
            expect(snLedgerRows.get(`sn-real:${txnId}:${PRI_COD}:${VALOR}`)).toBeUndefined();
        });
    });

    // ─────────────── Cenário 5 — processo POR CONTA E ORDEM DE TERCEIROS (ADR-0031)

    describe('Cenário 5 — imp021 priVldTipo=2 (POR CONTA E ORDEM DE TERCEIROS)', () => {
        const VALOR = 5555.55;

        it('quita com SN + baixa e NENHUM byte chega ao com297/com300/com131', async () => {
            armarCenario({
                extrato: { extCod: 205, exiCodSeq: 55, valor: VALOR },
                priVldTipo: 2,
            });
            const txnId = await ingerirEEncontrarTxn(VALOR);
            const mark = erp.state.requests.length;

            const res = await alocar(txnId, VALOR);
            const body = (await res.json()) as AnyRecord;
            expect(res.status).toBe(200);
            expect(body.status).toBe('settled');
            expect(body.etapa).toBe('quitado-sem-nde');
            expect(body.ndeDispensada).toBe(true);
            expect(body.ndDocCod).toBeUndefined();

            // A leg FINANCEIRA aconteceu de verdade, via HTTP: SN gerada + borderô/baixa fin014.
            const paths = pathsDesde(mark);
            expect(paths.some((p) => p.includes('POST /api/com299/gerDocProcesso'))).toBe(true);
            expect(paths.some((p) => p.includes('POST /api/fin014'))).toBe(true);

            // A leg FISCAL não existiu — nenhuma operação de DOCUMENTO nas telas da NDe, em nenhum
            // verbo. O `GET /api/permissoes/new/com297` fica de fora de propósito: é o pré-flight de
            // ACL da rota (leitura de permissões), roda antes do serviço e não toca documento algum.
            const fiscais = paths.filter(
                (p) =>
                    !p.includes('/permissoes/') &&
                    (p.includes('/com297') || p.includes('/com300') || p.includes('/com131')),
            );
            expect(fiscais).toEqual([]);

            // Ledger: terminal próprio, sem nº de nota.
            const row = snLedgerRows.get(`sn-real:${txnId}:${PRI_COD}:${VALOR}`);
            expect(row).toBeDefined();
            expect(row?.status).toBe('settled');
            expect(row?.etapa).toBe('quitado-sem-nde');
            expect(row?.ndDocCod).toBeUndefined();
        });
    });
});

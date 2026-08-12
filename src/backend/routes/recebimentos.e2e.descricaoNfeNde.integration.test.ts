import 'reflect-metadata';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';

/**
 * SONDA DE DIAGNÓSTICO — "1ª Descrição dos Produtos" do cliente × descrição do item da NDe.
 *
 * Responde, sem escrever NADA, por que a homologação da NDe falha quando o cadastro do cliente
 * (`cmn025` → `CmnDadosPessoas.dpeVld1DescrNfe`) está em **4 - Descrição DI** (rótulo do tenant:
 * "Descrição da DI + DUIMP") e passa quando está em **1 - Descrição Produto**.
 *
 * Cadeia investigada (tudo LEITURA):
 *   1. `GET com297/{docCod}`                                              → status/pesCod/vldTpNf do doc
 *   2. `POST com297/comDocProdutos/list/{docCod}/{fisCod}`                → itens (prdCod/dprCodSeq)
 *   3. `GET com297/comDocProdutos/{docCod}/{fisCod}/{prdCod}/{dprCodSeq}` → item inteiro (dprLngDescrNf)
 *   4. `GET com297/comDocProdutos/preDescrProdutoNf/{...}`                → o que o ERP CALCULA hoje
 *   5. `POST com194/documento/list`                                       → validações fiscais do doc
 *   6. `POST cmn025/list` (pesCod, vldValido:1)                           → dpeVld1DescrNfe/dpeVld2DescrNfe
 *
 * O veredito imprime, lado a lado, a configuração do cliente e a `dprLngDescrNf` gravada no item —
 * é essa string que vira o `xProd` da NF-e. Rode com um docCod que FALHOU e (se possível) outro que
 * PASSOU (cliente com a 1ª descrição = Descrição Produto) para fechar o diagnóstico.
 *
 *   CONEXOS_PROBE_BASE_URL=... CONEXOS_PROBE_USERNAME=... CONEXOS_PROBE_PASSWORD=... \
 *   PROBE_FIL_COD=2 PROBE_ND_DOC_COD=18347 \
 *   npx jest recebimentos.e2e.descricaoNfeNde --testPathIgnorePatterns "/node_modules/"
 *
 * Opcionais: `PROBE_PES_COD` (cliente, quando não se quer/pode partir de um docCod — nesse caso só a
 * etapa 6 roda) e `PROBE_OUT` (destino do dump; default `<tmp>/nde-descricao-diagnostico.json`).
 */

jest.setTimeout(300_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Rotas de LEITURA (regex, porque as do item carregam ids no path). Qualquer chamada fora daqui morre
 * na máquina, antes de sair para o ERP — inclusive as escritas do fluxo real (`gerDocProcesso`,
 * `homologaNfe`, `com300`, `com131/geraObs`, `fin014*`).
 */
const ROTAS_DE_LEITURA: readonly RegExp[] = [
    /^com297\/\d+$/,
    /^com297\/comDocProdutos\/list\/\d+\/\d+$/,
    /^com297\/comDocProdutos\/\d+\/\d+\/\d+\/\d+$/,
    /^com297\/comDocProdutos\/preDescrProdutoNf\/\d+\/\d+\/\d+\/\d+$/,
    /^com194\/documento\/list$/,
    /^cmn025\/list$/,
];

/** `fisCod` do documento fiscal — 1 em todo o histórico do tenant (mesma constante do serviço). */
const FIS_COD = 1;
/** `docTip` do com297 — 1 = SAÍDA RECEBER. */
const DOC_TIP = 1;

/** Rótulos do enum `dpeVld1DescrNfe`/`dpeVld2DescrNfe` (swagger `CmnDadosPessoas`). */
const DESCR_NFE_LABEL: Record<number, string> = {
    0: 'Padrão',
    1: 'Descrição Produto',
    2: 'Complemento',
    3: 'Descrição Detalhada',
    4: 'Descrição DI',
    5: 'Série',
    6: 'Descrição Invoice',
};

type AnyRecord = Record<string, unknown>;

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_k: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('sonda: SQL indisponível (e desnecessário)');
    },
    selectFirst: async () => {
        throw new Error('sonda: SQL indisponível (e desnecessário)');
    },
    insert: async () => {
        throw new Error('sonda: SQL indisponível (e desnecessário)');
    },
    update: async () => {
        throw new Error('sonda: SQL indisponível (e desnecessário)');
    },
    withTransaction: async () => {
        throw new Error('sonda: SQL indisponível (e desnecessário)');
    },
});

const exigirEnv = (nome: string): string => {
    const valor = process.env[nome];
    if (valor === undefined || valor.trim() === '') {
        throw new Error(
            `ABORTADO: ${nome} não está no ambiente. Esta sonda lê o alvo e as credenciais do SHELL, ` +
                'nunca de arquivo — ver o cabeçalho do teste.',
        );
    }
    return valor.trim();
};

const opcionalNumero = (nome: string): number | undefined => {
    const valor = process.env[nome];
    if (valor === undefined || valor.trim() === '') return undefined;
    const n = Number(valor.trim());
    return Number.isFinite(n) ? n : undefined;
};

describe('DIAGNÓSTICO — descrição do produto na NF-e da NDe (cadastro do cliente × item do doc)', () => {
    const relatorio: AnyRecord = { ambiente: null, leituras: {} as AnyRecord, veredito: [] };
    let base: AnyRecord;
    let filCod: number;
    let ndDocCod: number | undefined;
    let pesCod: number | undefined;
    const destino =
        (process.env.PROBE_OUT ?? '').trim() || join(tmpdir(), 'nde-descricao-diagnostico.json');

    const registrar = (nome: string, valor: unknown): void => {
        (relatorio.leituras as AnyRecord)[nome] = valor;
    };
    const anotar = (linha: string): void => {
        (relatorio.veredito as string[]).push(linha);
        // eslint-disable-next-line no-console
        console.log(`[DESCR-NDE] ${linha}`);
    };

    const get = <T>(path: string): Promise<T> =>
        (base.getGeneric as (p: string, o?: AnyRecord) => Promise<T>)(path, { filCod });
    const post = <T>(path: string, body: AnyRecord): Promise<T> =>
        (base.postGeneric as (p: string, b: AnyRecord, o?: AnyRecord) => Promise<T>)(path, body, {
            filCod,
        });

    beforeAll(async () => {
        const url = exigirEnv('CONEXOS_PROBE_BASE_URL');
        filCod = Number(exigirEnv('PROBE_FIL_COD'));
        ndDocCod = opcionalNumero('PROBE_ND_DOC_COD');
        pesCod = opcionalNumero('PROBE_PES_COD');
        if (ndDocCod === undefined && pesCod === undefined) {
            throw new Error(
                'ABORTADO: informe PROBE_ND_DOC_COD (NDe com297 a inspecionar) e/ou PROBE_PES_COD (cliente).',
            );
        }

        process.env.CONEXOS_BASE_URL = url;
        process.env.CONEXOS_USERNAME = exigirEnv('CONEXOS_PROBE_USERNAME');
        process.env.CONEXOS_PASSWORD = exigirEnv('CONEXOS_PROBE_PASSWORD');
        process.env.CONEXOS_FIL_COD = String(filCod);
        // Cinto e suspensório sobre a allowlist: o gate de escrita do produto fica off de qualquer jeito.
        process.env.CONEXOS_WRITE_ENABLED = 'false';
        process.env.CONEXOS_DRY_RUN = 'true';
        process.env.environment = 'local';
        delete process.env.client_name;
        delete process.env.databaseConnectionString;

        const { container } = await import('tsyringe');
        const { default: PostgreeDatabaseClient } = await import(
            '../domain/client/database/PostgreeDatabaseClient.js'
        );
        container.registerInstance(PostgreeDatabaseClient, buildFakeDb() as never);
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

        base = container.resolve(ConexosBaseClient) as unknown as AnyRecord;
        const somenteLeitura = (verbo: string, original: unknown): unknown => {
            const fn = original as (path: string, ...resto: unknown[]) => Promise<unknown>;
            return (path: string, ...resto: unknown[]): Promise<unknown> => {
                const limpo = String(path).split('?')[0] ?? '';
                if (!ROTAS_DE_LEITURA.some((r) => r.test(limpo))) {
                    throw new Error(
                        `SONDA BLOQUEOU ${verbo.toUpperCase()} ${limpo}: rota fora da allowlist de leitura. ` +
                            'Esta sonda não escreve no ERP — se a rota é mesmo de leitura, inclua-a em ' +
                            'ROTAS_DE_LEITURA conscientemente.',
                    );
                }
                return fn.call(base, path, ...resto);
            };
        };
        for (const verbo of [
            'getGeneric',
            'postGeneric',
            'postGenericOnce',
            'putGenericOnce',
            'deleteGeneric',
            'postMultipartOnce',
        ]) {
            base[verbo] = somenteLeitura(verbo, base[verbo]);
        }

        await (base.ensureSid as () => Promise<void>)();
        relatorio.ambiente = { baseUrl: url, filCod, ndDocCod, pesCod };
        anotar(
            `alvo: ${url} · filial ${filCod} · NDe ${String(ndDocCod)} · cliente ${String(pesCod)}`,
        );
    });

    afterAll(() => {
        try {
            writeFileSync(destino, JSON.stringify(relatorio, null, 2), 'utf8');
            // eslint-disable-next-line no-console
            console.log(`[DESCR-NDE] dump: ${destino}`);
        } catch {
            // dump é conveniência; o veredito já saiu no console.
        }
    });

    it('lê o documento com297 e resolve o cliente (pesCod)', async () => {
        if (ndDocCod === undefined) {
            anotar('sem PROBE_ND_DOC_COD — pulando a inspeção do documento');
            return;
        }
        const doc = await get<AnyRecord>(`com297/${ndDocCod}`);
        registrar('com297.doc', doc);
        const pes = Number(doc.pesCod);
        if (pesCod === undefined && Number.isFinite(pes)) pesCod = pes;
        anotar(
            `doc ${ndDocCod}: pesCod=${String(doc.pesCod)} · ${String(doc.dpeNomPessoa ?? '')} · ` +
                `vldStatus=${String(doc.vldStatus)} · vldTpNf=${String(doc.vldTpNf)} · ` +
                `docVldNfehom=${String(doc.docVldNfehom)} · vldAutorizado=${String(doc.vldAutorizado)} · ` +
                `docEspNumero=${String(doc.docEspNumero)} · prdCod(header)=${String(doc.prdCod)}`,
        );
    });

    it('lê os ITENS da NDe e a descrição de impressão gravada (dprLngDescrNf)', async () => {
        if (ndDocCod === undefined) return;
        const page = await post<{ rows?: AnyRecord[]; count?: number }>(
            `com297/comDocProdutos/list/${ndDocCod}/${FIS_COD}`,
            {
                fieldList: [],
                filterList: {},
                pageNumber: 1,
                pageSize: 50,
                orderList: { orderList: [{ propertyName: 'dprCodSeq', order: 'asc' }] },
            },
        );
        const rows = page.rows ?? [];
        registrar('com297.itens', rows);
        anotar(`itens do doc: ${rows.length} (count=${String(page.count)})`);
        if (rows.length === 0) {
            anotar(
                '⚠ NENHUM item — a NF-e sai sem produto; o problema não é a descrição, e sim a ausência ' +
                    'da linha (o produto do header não materializou item).',
            );
            return;
        }

        for (const row of rows) {
            const prdCod = Number(row.prdCod);
            const dprCodSeq = Number(row.dprCodSeq);
            const descr = row.dprLngDescrNf;
            const texto = typeof descr === 'string' ? descr : '';
            anotar(
                `  item prdCod=${prdCod} seq=${dprCodSeq} prdDesNome="${String(row.prdDesNome ?? '')}" ` +
                    `dprLngDescrNf(len=${texto.length})="${texto.slice(0, 120)}"`,
            );
            if (texto.trim() === '') {
                anotar(
                    '  ⚠ dprLngDescrNf VAZIA — é este campo que vira o `xProd` da NF-e; vazio ⇒ rejeição.',
                );
            }

            // Item inteiro (o mesmo shape que um PUT read-modify-write reenviaria).
            const item = await get<AnyRecord>(
                `com297/comDocProdutos/${ndDocCod}/${FIS_COD}/${prdCod}/${dprCodSeq}`,
            );
            registrar(`com297.item.${prdCod}.${dprCodSeq}`, item);

            // O que o ERP CALCULA hoje para este item (aplica a regra do cadastro do cliente).
            try {
                const pre = await get<unknown>(
                    `com297/comDocProdutos/preDescrProdutoNf/${ndDocCod}/${FIS_COD}/${prdCod}/${dprCodSeq}`,
                );
                registrar(`com297.preDescrProdutoNf.${prdCod}.${dprCodSeq}`, pre);
                anotar(`  preDescrProdutoNf ⇒ ${JSON.stringify(pre).slice(0, 300)}`);
            } catch (erro) {
                registrar(`com297.preDescrProdutoNf.${prdCod}.${dprCodSeq}.erro`, String(erro));
                anotar(`  preDescrProdutoNf FALHOU: ${String(erro).slice(0, 200)}`);
            }
        }
    });

    it('lê as validações fiscais do documento (com194)', async () => {
        if (ndDocCod === undefined) return;
        const raw = await post<{ rows?: AnyRecord[] } | AnyRecord[]>('com194/documento/list', {
            fieldList: [],
            filterList: { docTip: DOC_TIP, docCod: ndDocCod },
            pageNumber: 1,
            pageSize: 50,
            orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
        });
        const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
        registrar('com194.validacoes', rows);
        anotar(`com194: ${rows.length} validação(ões)`);
        for (const r of rows) {
            anotar(
                `  [${String(r.fdvVldErr)}] seq=${String(r.fdvCodSeq)} ${String(r.fdvEspErr ?? '')} ` +
                    `${String(r.fdvEspObs ?? '')}`.trim(),
            );
        }
    });

    it('lê a configuração de descrição de produtos do CLIENTE (cmn025)', async () => {
        if (pesCod === undefined) {
            anotar('sem pesCod (nem por env, nem pelo doc) — pulando o cadastro do cliente');
            return;
        }
        const raw = await post<{ rows?: AnyRecord[] } | AnyRecord[]>('cmn025/list', {
            fieldList: [
                'pesCod',
                'dpeCodSeq',
                'dpeNomPessoa',
                'dpeVld1DescrNfe',
                'dpeVld2DescrNfe',
                'dpeVldIdentPrdNf',
                'vldValido',
            ],
            filterList: { 'pesCod#EQ': pesCod, 'vldValido#EQ': 1 },
            pageNumber: 1,
            pageSize: 10,
            orderList: { orderList: [{ propertyName: 'dpeCodSeq', order: 'desc' }] },
        });
        const rows = Array.isArray(raw) ? raw : (raw.rows ?? []);
        registrar('cmn025.cliente', rows);
        if (rows.length === 0) {
            anotar(`⚠ cmn025 não devolveu o cadastro vigente do pesCod ${pesCod}`);
            return;
        }
        for (const r of rows) {
            const d1 = Number(r.dpeVld1DescrNfe);
            const d2 = Number(r.dpeVld2DescrNfe);
            anotar(
                `cliente ${String(r.pesCod)} (dpeCodSeq ${String(r.dpeCodSeq)}) "${String(r.dpeNomPessoa ?? '')}": ` +
                    `1ª=${d1} (${DESCR_NFE_LABEL[d1] ?? '?'}) · 2ª=${d2} (${DESCR_NFE_LABEL[d2] ?? '?'}) · ` +
                    `identPrdNf=${String(r.dpeVldIdentPrdNf)}`,
            );
            if (d1 === 4 || d2 === 4) {
                anotar(
                    '  ⇒ cadastro em "Descrição DI": a descrição do item é derivada da DI/DUIMP. O produto ' +
                        'da NDe (PAGAMENTO ANTECIPADO) não tem adição de DI ⇒ descrição vazia/inválida.',
                );
            }
        }
    });
});

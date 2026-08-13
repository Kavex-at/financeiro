import 'reflect-metadata';
import { writeFileSync } from 'node:fs';

/**
 * SONDA DE DIAGNÓSTICO (read-only, PRODUÇÃO) — por que a NDe 18771 (DYNAMIS, processo 3639) NÃO ficou
 * homologada, mesmo com `POST com297/homologaNfe/18771 → 200`?
 *
 * A homologação devolveu `docVldComvalidacoes: 0` e o nosso client trata `0` como "homologada com
 * validações NÃO bloqueantes". O controller Angular do Conexos (engenharia reversa, registrada em
 * `ontology/integrations/conexos-com297-homologacao.md`) diz o contrário: só `1` e `2` são homologação;
 * qualquer outro valor abre o com194 e mostra ERRO. Esta sonda decide quem está certo LENDO o estado
 * real do documento — não a resposta do POST, mas o que ficou gravado.
 *
 * Perguntas:
 *   A. Como está o doc 18771 AGORA (vldStatus/vldAutorizado/docVldNfehom/docEspNumero)?
 *   B. Quais validações o com194 tem hoje — e qual `fdvVldErr` é ERRO (❌) e qual é AVISO (⚠️)?
 *      (o filtro `fdvVldTperr:1` do nosso client esconde alguma linha?)
 *   C. O doc 18779 (GOPER, mesmo dia, mesmo fluxo, pessoa de UM estabelecimento) homologou?
 *      — é o controle que separa "defeito do fluxo" de "defeito da DYNAMIS".
 *   D. Como é um doc da MESMA configuração (gcd 248) que o ERP realmente homologou/autorizou?
 *   E. O com300 do 18771 — `fisTimEmissao`/`fisVldNfemitida` (a história do "excedeu a tolerância").
 *
 * Estruturalmente incapaz de escrever: todo verbo do client base passa por `somenteLeitura`, que só
 * libera rotas de leitura casadas por igualdade ou por PADRÃO (`com297/{docCod}` — nunca
 * `com297/homologaNfe/{docCod}`). No Conexos consulta também é POST; o que separa leitura de escrita é
 * a ROTA, e é a rota que está travada.
 *
 *   PROBE_ENV_FILE=.env PROBE_FIL_COD=2 PROBE_DOC_COD=18771 PROBE_DOC_COD_CONTROLE=18779 \
 *   npx jest recebimentos.probe.homologacao --testPathIgnorePatterns "/node_modules/"
 */

jest.setTimeout(300_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

/** Rotas de LEITURA (igualdade exata). */
const ROTAS_DE_LEITURA: readonly string[] = ['com194/documento/list', 'com297/list', 'com299/list'];

/**
 * Rotas de LEITURA com id no path. Casadas por PADRÃO ANCORADO, não por prefixo: `^com297/\d+$` libera
 * `com297/18771` e recusa `com297/homologaNfe/18771`. É a diferença entre ler e homologar.
 */
const PADROES_DE_LEITURA: readonly RegExp[] = [
    /^com297\/\d+$/,
    /^com300\/\d+\/\d+\/\d+$/,
    /^com131\/\d+\/\d+$/,
    /^com194\/documento\/initialValues\/\d+\/\d+$/,
];

const DOC_TIP = 1;
const NDE_GCD_COD = 248;
const RELATORIO = process.env.PROBE_OUT ?? '/tmp/probe-homologacao.json';

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

/** Credenciais do `.env` apontado por `PROBE_ENV_FILE` — o segredo não transita pela linha de comando. */
const carregarEnvFile = (): void => {
    const caminho = process.env.PROBE_ENV_FILE;
    if (caminho === undefined || caminho.trim() === '') return;
    const dotenv = require('dotenv') as { config: (o: AnyRecord) => unknown };
    dotenv.config({ path: caminho.trim(), override: false });
};

const exigirEnv = (nome: string, ...alternativos: string[]): string => {
    for (const chave of [nome, ...alternativos]) {
        const valor = process.env[chave];
        if (valor !== undefined && valor.trim() !== '') return valor.trim();
    }
    throw new Error(`ABORTADO: ${nome} não está no ambiente (nem em ${alternativos.join(', ')}).`);
};

/** Campos do com297 que dizem se o documento virou NF-e de verdade. */
const CAMPOS_STATUS = [
    'docCod',
    'vldStatus',
    'vldAutorizado',
    'docVldNfehom',
    'docEspNumero',
    'vldTpNf',
    'docVldConferencia',
    'vldEnviarConferencia',
    'docVldComvalidacoes',
    'docMnyValor',
    'docEspIdnfe',
    'gcdCod',
    'gcdDesNome',
    'pesCod',
    'priCod',
    'endCodFis',
    'pdcDocFederal',
];

const resumir = (o: AnyRecord | undefined, campos: readonly string[]): AnyRecord => {
    const out: AnyRecord = {};
    for (const c of campos) if (o !== undefined && c in o) out[c] = o[c];
    return out;
};

describe('SONDA homologação — NDe 18771 (read-only, produção)', () => {
    const relatorio: AnyRecord = { ambiente: null, checagens: {} as AnyRecord, notas: [] };
    let base: {
        postGeneric: <T>(path: string, body: unknown, opts?: AnyRecord) => Promise<T>;
        getGeneric: <T>(path: string, opts?: AnyRecord) => Promise<T>;
    };
    let filCod: number;
    let docCod: number;
    let docCodControle: number;

    const registrar = (nome: string, valor: unknown): void => {
        (relatorio.checagens as AnyRecord)[nome] = valor;
    };
    const anotar = (linha: string): void => {
        (relatorio.notas as string[]).push(linha);
        console.log(`[SONDA] ${linha}`);
    };
    const tentar = async (nome: string, fn: () => Promise<unknown>): Promise<unknown> => {
        try {
            const r = await fn();
            registrar(nome, r);
            return r;
        } catch (err) {
            const e = err as { response?: { status?: number; data?: unknown }; message?: string };
            const detalhe = {
                erro: true,
                status: e?.response?.status,
                data: e?.response?.data,
                message: e?.message,
            };
            registrar(nome, detalhe);
            anotar(`${nome} FALHOU: ${JSON.stringify(detalhe).slice(0, 400)}`);
            return detalhe;
        }
    };

    /** O com297 às vezes embrulha o registro em `.data`/`.responseData`. */
    const desembrulhar = (r: unknown): AnyRecord => {
        const o = (r ?? {}) as AnyRecord;
        return ((o.responseData ?? o.data ?? o) as AnyRecord) ?? {};
    };

    const linhas = (r: unknown): AnyRecord[] => {
        const o = (r ?? {}) as AnyRecord;
        if (Array.isArray(o)) return o as AnyRecord[];
        if (Array.isArray(o.rows)) return o.rows as AnyRecord[];
        if (Array.isArray(o.content)) return o.content as AnyRecord[];
        return [];
    };

    beforeAll(async () => {
        carregarEnvFile();
        const url = exigirEnv('CONEXOS_PROD_BASE_URL', 'CONEXOS_BASE_URL');
        filCod = Number(exigirEnv('PROBE_FIL_COD'));
        docCod = Number(exigirEnv('PROBE_DOC_COD'));
        docCodControle = Number(process.env.PROBE_DOC_COD_CONTROLE ?? '0');

        const usuario = exigirEnv('CONEXOS_PROD_USERNAME', 'CONEXOS_USERNAME');
        const senha = exigirEnv('CONEXOS_PROD_PASSWORD', 'CONEXOS_PASSWORD');
        process.env.CONEXOS_BASE_URL = url;
        process.env.CONEXOS_USERNAME = usuario;
        process.env.CONEXOS_PASSWORD = senha;
        process.env.CONEXOS_FIL_COD = String(filCod);
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

        const cliente = container.resolve(ConexosBaseClient) as unknown as AnyRecord;
        const somenteLeitura = (verbo: string, original: unknown): unknown => {
            const fn = original as (path: string, ...resto: unknown[]) => Promise<unknown>;
            return (path: string, ...resto: unknown[]): Promise<unknown> => {
                const limpo = String(path).split('?')[0] ?? '';
                const liberado =
                    ROTAS_DE_LEITURA.includes(limpo) ||
                    PADROES_DE_LEITURA.some((p) => p.test(limpo));
                if (!liberado) {
                    throw new Error(
                        `SONDA BLOQUEOU ${verbo.toUpperCase()} ${limpo}: fora da allowlist de leitura.`,
                    );
                }
                return fn.call(cliente, path, ...resto);
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
            cliente[verbo] = somenteLeitura(verbo, cliente[verbo]);
        }
        base = cliente as never;

        relatorio.ambiente = { baseUrl: url, filCod, docCod, docCodControle };
        anotar(`alvo ${url} · filial ${filCod} · doc ${docCod} · controle ${docCodControle}`);
    });

    afterAll(() => {
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        console.log(`[SONDA] relatório completo em ${RELATORIO}`);
    });

    it('A. GET com297/{docCod} — o 18771 ficou homologado?', async () => {
        const r = await tentar('A_com297_doc', () =>
            base.getGeneric<AnyRecord>(`com297/${docCod}`, { filCod }),
        );
        const d = desembrulhar(r);
        anotar(`A status do doc ${docCod}: ${JSON.stringify(resumir(d, CAMPOS_STATUS))}`);
        anotar(`A chaves do com297: ${Object.keys(d).join(', ')}`);
        expect(r).toBeDefined();
    });

    it('B. com194 do 18771 — COM e SEM o filtro fdvVldTperr:1', async () => {
        const comFiltro = await tentar('B1_com194_com_filtro', () =>
            base.postGeneric<unknown>(
                'com194/documento/list',
                {
                    fieldList: [],
                    filterList: { docTip: DOC_TIP, docCod, fdvVldTperr: 1 },
                    pageNumber: 1,
                    pageSize: 50,
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                },
                { filCod },
            ),
        );
        const semFiltro = await tentar('B2_com194_sem_filtro', () =>
            base.postGeneric<unknown>(
                'com194/documento/list',
                {
                    fieldList: [],
                    filterList: { docTip: DOC_TIP, docCod },
                    pageNumber: 1,
                    pageSize: 50,
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                },
                { filCod },
            ),
        );
        const resumo = (r: unknown): unknown =>
            linhas(r).map((v) => ({
                seq: v.fdvCodSeq,
                fdvVldErr: v.fdvVldErr,
                fdvVldTperr: v.fdvVldTperr,
                cad: v.fdvTimCad,
                err: String(v.fdvEspErr ?? '').slice(0, 70),
            }));
        anotar(`B1 com filtro (${linhas(comFiltro).length}): ${JSON.stringify(resumo(comFiltro))}`);
        anotar(`B2 sem filtro (${linhas(semFiltro).length}): ${JSON.stringify(resumo(semFiltro))}`);
        expect(comFiltro).toBeDefined();
    });

    it('C. controle GOPER — o doc do mesmo dia/mesmo fluxo homologou?', async () => {
        if (!Number.isFinite(docCodControle) || docCodControle <= 0) {
            anotar('C pulado (PROBE_DOC_COD_CONTROLE ausente)');
            return;
        }
        const r = await tentar('C_com297_controle', () =>
            base.getGeneric<AnyRecord>(`com297/${docCodControle}`, { filCod }),
        );
        const d = desembrulhar(r);
        anotar(
            `C status do controle ${docCodControle}: ${JSON.stringify(resumir(d, CAMPOS_STATUS))}`,
        );
        const v = await tentar('C2_com194_controle', () =>
            base.postGeneric<unknown>(
                'com194/documento/list',
                {
                    fieldList: [],
                    filterList: { docTip: DOC_TIP, docCod: docCodControle, fdvVldTperr: 1 },
                    pageNumber: 1,
                    pageSize: 50,
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                },
                { filCod },
            ),
        );
        anotar(
            `C2 com194 do controle (${linhas(v).length}): ${JSON.stringify(
                linhas(v).map((x) => ({
                    seq: x.fdvCodSeq,
                    fdvVldErr: x.fdvVldErr,
                    cad: x.fdvTimCad,
                    err: String(x.fdvEspErr ?? '').slice(0, 60),
                })),
            )}`,
        );
        expect(r).toBeDefined();
    });

    it('D. população da gcd 248 — quantas NDes ficaram autorizadas, e como elas se parecem?', async () => {
        const r = await tentar('D_com297_list_gcd248', () =>
            base.postGeneric<unknown>(
                'com297/list',
                {
                    fieldList: [],
                    filterList: { gcdCod: NDE_GCD_COD },
                    pageNumber: 1,
                    pageSize: 50,
                    serviceName: 'com297',
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'desc' }] },
                },
                { filCod },
            ),
        );
        const rows = linhas(r);
        anotar(`D com297/list gcd ${NDE_GCD_COD}: ${rows.length} linhas`);
        if (rows.length > 0) {
            anotar(`D chaves da linha: ${Object.keys(rows[0] as AnyRecord).join(', ')}`);
            anotar(
                `D amostra: ${JSON.stringify(
                    rows.slice(0, 15).map((v) => resumir(v, CAMPOS_STATUS)),
                )}`,
            );
            const autorizadas = rows.filter((v) => Number(v.vldAutorizado ?? 0) !== 0).length;
            const comNumero = rows.filter((v) => Number(v.docEspNumero ?? 0) !== 0).length;
            anotar(
                `D autorizadas=${autorizadas}/${rows.length} · comNumero=${comNumero}/${rows.length}`,
            );
        }
        expect(r).toBeDefined();
    });

    it('E. com300 do 18771 — fisTimEmissao / fisVldNfemitida (a história da tolerância)', async () => {
        const r = await tentar('E_com300', () =>
            base.getGeneric<AnyRecord>(`com300/${DOC_TIP}/${docCod}/1`, { filCod }),
        );
        const d = desembrulhar(r);
        anotar(
            `E fiscal: ${JSON.stringify(
                resumir(d, [
                    'fisVldNfemitida',
                    'fisVldTipoNfDebito',
                    'fisTimEmissao',
                    'fisTimSaida',
                    'fisDtaCompet',
                    'vldNfeGerado',
                    'docEspIdnfe',
                    'fisVldImpressao',
                    'fisVldCancFis',
                ]),
            )}`,
        );
        expect(r).toBeDefined();
    });
});

import 'reflect-metadata';
import { writeFileSync } from 'node:fs';

/**
 * SONDA DE DIAGNÓSTICO (read-only, PRODUÇÃO) — de onde vem o `endCod` que o `com297/gerDocProcesso`
 * recusou com `Generic.NOT_VALID vars.atributo:"1"` (DYNAMIS, processo 3639, filial 2, pesCod 699).
 *
 * Pergunta central: o `endCodFis: 1` que mandamos é DADO DO ERP (veio do `validaProcessoPessoa`) ou o
 * nosso default `END_COD_FIS_DEFAULT`? E qual `endCod` os documentos que o ERP JÁ aceitou usam?
 *
 * Estruturalmente incapaz de escrever: todo verbo do client base passa por `somenteLeitura`, que recusa
 * qualquer rota fora da allowlist. No Conexos consulta também é POST — o que separa leitura de escrita
 * é a ROTA, e é a rota que está travada.
 *
 *   CONEXOS_PROD_BASE_URL=... CONEXOS_PROD_USERNAME=... CONEXOS_PROD_PASSWORD=... \
 *   PROBE_FIL_COD=2 PROBE_PRI_COD=3639 PROBE_PES_COD=699 \
 *   npx jest recebimentos.probe.endCod --testPathIgnorePatterns "/node_modules/"
 */

jest.setTimeout(300_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

/** Rotas de LEITURA. Nada fora daqui sai da máquina. */
const ROTAS_DE_LEITURA: readonly string[] = [
    'com299/gerDoc/validaProcessoPessoa',
    'com297/gerDoc/validaProcessoPessoa',
    'com299/gerDoc/validaConfigDocPessoa',
    'com297/gerDoc/validaConfigDocPessoa',
    'com299/gerDoc/validaConfigDoc',
    'com297/gerDoc/validaConfigDoc',
    'com299/list',
    'com297/list',
    'lov/ConfigDocProcesso',
];

/** Prefixos de LEITURA com parâmetro no path (`.../{pesCod}`) — mesma trava, casada por prefixo. */
const PREFIXOS_DE_LEITURA: readonly string[] = [
    'cmn153/endereco/',
    'com191/endereco/list/',
    'com043/validacao/pessoaEndereco/',
];

const DOC_TIP = 1;
const SN_GLOBAL_DOC_VLD_TIPO = 9;
const NDE_GLOBAL_DOC_VLD_TIPO = 0;
const RELATORIO = process.env.PROBE_OUT ?? '/tmp/probe-endcod.json';

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

/**
 * Credenciais: do SHELL quando presentes; senão do `.env` do backend (`PROBE_ENV_FILE` aponta o
 * arquivo). Ler do arquivo evita que o segredo transite pela linha de comando.
 */
const carregarEnvFile = (): void => {
    const caminho = process.env.PROBE_ENV_FILE;
    if (caminho === undefined || caminho.trim() === '') return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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

describe('SONDA endCod — DYNAMIS/3639 (read-only, produção)', () => {
    const relatorio: AnyRecord = { ambiente: null, checagens: {} as AnyRecord, notas: [] };
    let base: {
        postGeneric: <T>(path: string, body: unknown, opts?: AnyRecord) => Promise<T>;
        getGeneric: <T>(path: string, opts?: AnyRecord) => Promise<T>;
    };
    let filCod: number;
    let priCod: number;
    let pesCod: number;

    const registrar = (nome: string, valor: unknown): void => {
        (relatorio.checagens as AnyRecord)[nome] = valor;
    };
    const anotar = (linha: string): void => {
        (relatorio.notas as string[]).push(linha);
        // eslint-disable-next-line no-console
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

    beforeAll(async () => {
        carregarEnvFile();
        const url = exigirEnv('CONEXOS_PROD_BASE_URL', 'CONEXOS_BASE_URL');
        filCod = Number(exigirEnv('PROBE_FIL_COD'));
        priCod = Number(exigirEnv('PROBE_PRI_COD'));
        pesCod = Number(exigirEnv('PROBE_PES_COD'));

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
                    PREFIXOS_DE_LEITURA.some((p) => limpo.startsWith(p));
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

        relatorio.ambiente = { baseUrl: url, filCod, priCod, pesCod };
        anotar(`alvo ${url} · filial ${filCod} · processo ${priCod} · pessoa ${pesCod}`);
    });

    afterAll(() => {
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[SONDA] relatório completo em ${RELATORIO}`);
    });

    it('A. validaProcessoPessoa no com299 (SN, globalDocVldTipo 9) — RESPOSTA CRUA', async () => {
        const r = (await tentar('A_com299_validaProcessoPessoa', () =>
            base.postGeneric<AnyRecord>(
                'com299/gerDoc/validaProcessoPessoa',
                {
                    docTip: DOC_TIP,
                    frontModelName: 'gerDocProcesso',
                    globalDocVldTipo: SN_GLOBAL_DOC_VLD_TIPO,
                    priCod,
                },
                { filCod },
            ),
        )) as AnyRecord;
        const rd = (r?.responseData ?? {}) as AnyRecord;
        anotar(
            `com299 → endCodFis=${JSON.stringify(rd.endCodFis)} endCod=${JSON.stringify(rd.endCod)} ` +
                `pdcDocFederal=${JSON.stringify(rd.pdcDocFederal)} pesCod=${JSON.stringify(rd.pesCod)}`,
        );
        anotar(`com299 responseData keys: ${Object.keys(rd).join(', ')}`);
        expect(r).toBeDefined();
    });

    it('B. validaProcessoPessoa no com297 (NDe, globalDocVldTipo 0) — o endCod muda?', async () => {
        const r = (await tentar('B_com297_validaProcessoPessoa', () =>
            base.postGeneric<AnyRecord>(
                'com297/gerDoc/validaProcessoPessoa',
                {
                    docTip: DOC_TIP,
                    frontModelName: 'gerDocProcesso',
                    globalDocVldTipo: NDE_GLOBAL_DOC_VLD_TIPO,
                    priCod,
                },
                { filCod },
            ),
        )) as AnyRecord;
        const rd = (r?.responseData ?? {}) as AnyRecord;
        anotar(
            `com297 → endCodFis=${JSON.stringify(rd.endCodFis)} endCod=${JSON.stringify(rd.endCod)} ` +
                `pdcDocFederal=${JSON.stringify(rd.pdcDocFederal)}`,
        );
        expect(r).toBeDefined();
    });

    it('C. SNs JÁ EXISTENTES do processo (com299/list) — qual endCod elas carregam?', async () => {
        const r = (await tentar('C_com299_list_sn', () =>
            base.postGeneric<AnyRecord>(
                'com299/list',
                {
                    fieldList: [
                        'docCod',
                        'priCod',
                        'pesCod',
                        'endCod',
                        'pdcDocFederal',
                        'docEspNumero',
                        'gcdCod',
                        'gcdDesNome',
                        'vldStatus',
                        'docVldTipo',
                        'filCod',
                    ],
                    filterList: { 'priCod#EQ': priCod },
                    pageNumber: 1,
                    pageSize: 50,
                    serviceName: 'com299',
                },
                { filCod },
            ),
        )) as AnyRecord;
        const rows = (r?.rows ?? r?.content ?? []) as AnyRecord[];
        anotar(
            `com299/list SNs do processo: ${Array.isArray(rows) ? rows.length : '?'} — ` +
                `endCods=${JSON.stringify((rows ?? []).map((l) => l.endCod))}`,
        );
        expect(r).toBeDefined();
    });

    it('D. NDes JÁ EMITIDAS para esta PESSOA (com297/list) — endCod que o ERP aceitou', async () => {
        const r = (await tentar('D_com297_list_nd_pessoa', () =>
            base.postGeneric<AnyRecord>(
                'com297/list',
                {
                    fieldList: [
                        'docCod',
                        'priCod',
                        'pesCod',
                        'endCod',
                        'pdcDocFederal',
                        'docEspNumero',
                        'gcdCod',
                        'gcdDesNome',
                        'vldStatus',
                        'filCod',
                        'docDtaEmissao',
                    ],
                    filterList: { 'pesCod#EQ': pesCod },
                    pageNumber: 1,
                    pageSize: 50,
                    serviceName: 'com297',
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'desc' }] },
                },
                { filCod },
            ),
        )) as AnyRecord;
        const rows = (r?.rows ?? r?.content ?? []) as AnyRecord[];
        anotar(
            `com297/list NDes da pessoa: ${Array.isArray(rows) ? rows.length : '?'} — ` +
                `endCods=${JSON.stringify((rows ?? []).slice(0, 10).map((l) => l.endCod))}`,
        );
        expect(r).toBeDefined();
    });

    it('F. ENDEREÇOS da pessoa (cmn153) — qual endCod casa com o CNPJ do documento?', async () => {
        const r = (await tentar('F_cmn153_enderecos', () =>
            base.getGeneric<AnyRecord>(`cmn153/endereco/${pesCod}`, { filCod }),
        )) as AnyRecord;
        const linhas = (r?.rows ?? r?.content ?? r?.responseData ?? r) as unknown;
        anotar(`cmn153/endereco → ${JSON.stringify(linhas).slice(0, 1200)}`);
        expect(r).toBeDefined();
    });

    it('G. ENDEREÇOS da pessoa (com191/endereco/list) — segunda fonte', async () => {
        const r = (await tentar('G_com191_enderecos', () =>
            base.postGeneric<AnyRecord>(
                `com191/endereco/list/${pesCod}`,
                { pageNumber: 1, pageSize: 50 },
                { filCod },
            ),
        )) as AnyRecord;
        const linhas = (r?.rows ?? r?.content ?? r?.responseData ?? r) as unknown;
        anotar(`com191/endereco/list → ${JSON.stringify(linhas).slice(0, 1200)}`);
        expect(r).toBeDefined();
    });

    it('E. NDes JÁ EMITIDAS neste PROCESSO (com297/list por priCod)', async () => {
        const r = (await tentar('E_com297_list_nd_processo', () =>
            base.postGeneric<AnyRecord>(
                'com297/list',
                {
                    fieldList: [
                        'docCod',
                        'priCod',
                        'pesCod',
                        'endCod',
                        'docEspNumero',
                        'gcdCod',
                        'gcdDesNome',
                        'vldStatus',
                        'filCod',
                    ],
                    filterList: { 'priCod#EQ': priCod },
                    pageNumber: 1,
                    pageSize: 50,
                    serviceName: 'com297',
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'desc' }] },
                },
                { filCod },
            ),
        )) as AnyRecord;
        const rows = (r?.rows ?? r?.content ?? []) as AnyRecord[];
        anotar(
            `com297/list NDes do processo: ${Array.isArray(rows) ? rows.length : '?'} — ` +
                `endCods=${JSON.stringify((rows ?? []).map((l) => l.endCod))}`,
        );
        expect(r).toBeDefined();
    });
});

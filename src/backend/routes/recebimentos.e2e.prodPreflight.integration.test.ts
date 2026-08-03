import 'reflect-metadata';
import { writeFileSync } from 'node:fs';

/**
 * PRÉ-FLIGHT DE PRODUÇÃO — go/no-go de UM caso, **antes** de qualquer escrita.
 *
 * Roteiro completo: `docs/e2e/producao-runbook-primeira-execucao.md`.
 *
 * Esta é a única sonda do repositório que aponta para PRODUÇÃO, e por isso ela é **estruturalmente
 * incapaz de escrever**: toda chamada passa por `somenteLeitura`, que recusa qualquer rota fora da
 * allowlist de leitura. Um `POST` aqui não é escrita — no Conexos as consultas e validadores também são
 * POST; o que separa leitura de escrita é a ROTA, e é a rota que está travada.
 *
 * O que ela responde, na ordem em que a decisão precisa:
 *
 *   1. O processo é ELEGÍVEL para a SN-Encomenda (`SN_GCD_COD`) nesta filial? — mesmo gate 3 que o
 *      pré-flight do produto aplica. Lembrando que **gcd 150 vale nas filiais 2–7**; na filial 1 ele dá
 *      `CFOP_INCOMPATIVEL` para todo processo e o gcd próprio dela ainda não foi capturado.
 *   2. O cliente tem CONDIÇÃO DE PAGAMENTO SUGERIDA no cadastro? — esta é a pergunta que mais importa.
 *      Se tiver, o ramo `applyPaymentConditionIfRequired` pode disparar, e ele **nunca rodou em nenhum
 *      ambiente**. `count: 0` = o caminho que produção já demonstrou funcionar.
 *   3. A configuração da NDe existe nesta filial pelo NOME? — o `com297` resolve por nome quando
 *      `COM297_GCD_NOTA_DEBITO` não está setado, e é assim que ele deve rodar (o código é por-ambiente).
 *
 * Credenciais e alvo vêm do AMBIENTE DO SHELL, nunca de arquivo — nada de produção toca o disco:
 *
 *   CONEXOS_PROD_BASE_URL=... CONEXOS_PROD_USERNAME=... CONEXOS_PROD_PASSWORD=... \
 *   PROD_FIL_COD=2 PROD_PRI_COD=3254 \
 *   npx jest recebimentos.e2e.prodPreflight --testPathIgnorePatterns "/node_modules/"
 *
 * Saída: veredito no console (`[PRE-FLIGHT]`) + dump em `C:/tmp/preflight-producao.json`.
 */

jest.setTimeout(300_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Rotas de LEITURA. Qualquer coisa fora daqui é recusada antes de sair da máquina — inclusive as escritas
 * do próprio fluxo (`gerarDocProcesso`, `finalizarDocumento`, `fin014*`, `homologaNfe`, `com300`, `com131`).
 */
const ROTAS_DE_LEITURA: readonly string[] = [
    'com299/gerDoc/validaProcessoPessoa',
    'com299/gerDoc/validaConfigDoc',
    'com299/gerDoc/validaConfigDocPessoa',
    'com299/list',
    'com297/list',
    'lov/CondPgtoPessoa',
    'lov/TituloBorderoReceber',
    'com194/documento/list',
];

const DOC_TIP = 1;
/** `globalDocVldTipo` da SN no com299 — 9. A NDe usa 0; aqui só olhamos a SN. */
const SN_GLOBAL_DOC_VLD_TIPO = 9;
const RELATORIO = 'C:/tmp/preflight-producao.json';

type AnyRecord = Record<string, unknown>;

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_k: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('pré-flight: SQL indisponível (e desnecessário)');
    },
    selectFirst: async () => {
        throw new Error('pré-flight: SQL indisponível (e desnecessário)');
    },
    insert: async () => {
        throw new Error('pré-flight: SQL indisponível (e desnecessário)');
    },
    update: async () => {
        throw new Error('pré-flight: SQL indisponível (e desnecessário)');
    },
    withTransaction: async () => {
        throw new Error('pré-flight: SQL indisponível (e desnecessário)');
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

describe('PRÉ-FLIGHT de produção — go/no-go de um caso, sem escrever nada', () => {
    const relatorio: AnyRecord = { ambiente: null, checagens: {} as AnyRecord, veredito: [] };
    let gerDoc: {
        validaProcessoPessoa: (p: AnyRecord) => Promise<AnyRecord>;
        verificarConfigElegivel: (p: AnyRecord) => Promise<AnyRecord>;
        listCondPgtoPessoa: (p: AnyRecord) => Promise<Array<AnyRecord>>;
        resolveGcdCodByName: (p: AnyRecord) => Promise<number | undefined>;
    };
    let filCod: number;
    let priCod: number;
    let snGcdCod: number;
    let ndeNome: string;
    let pessoa: AnyRecord | undefined;

    const registrar = (nome: string, valor: unknown): void => {
        (relatorio.checagens as AnyRecord)[nome] = valor;
    };
    const anotar = (linha: string): void => {
        (relatorio.veredito as string[]).push(linha);
        // eslint-disable-next-line no-console
        console.log(`[PRE-FLIGHT] ${linha}`);
    };

    beforeAll(async () => {
        const url = exigirEnv('CONEXOS_PROD_BASE_URL');
        // Guarda INVERTIDA: as demais sondas exigem `-hml`; esta exige que NÃO seja. Rodar o pré-flight
        // contra homologação por engano devolveria um go/no-go sobre o ambiente errado.
        if (/-hml\./.test(url)) {
            throw new Error(`ABORTADO: ${url} é homologação. Este pré-flight é de PRODUÇÃO.`);
        }
        filCod = Number(exigirEnv('PROD_FIL_COD'));
        priCod = Number(exigirEnv('PROD_PRI_COD'));

        process.env.CONEXOS_BASE_URL = url;
        process.env.CONEXOS_USERNAME = exigirEnv('CONEXOS_PROD_USERNAME');
        process.env.CONEXOS_PASSWORD = exigirEnv('CONEXOS_PROD_PASSWORD');
        process.env.CONEXOS_FIL_COD = String(filCod);
        // Cinto e suspensório sobre a allowlist: mesmo que algo tente escrever, o gate do produto está off.
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

        const base = container.resolve(ConexosBaseClient) as unknown as AnyRecord;
        // A TRAVA: envelopa os verbos do client base recusando toda rota fora da allowlist. Vale para o
        // `getGeneric`/`postGeneric`/`postGenericOnce`/`putGenericOnce`/`deleteGeneric` — se um caminho
        // novo escapar, ele morre aqui e não no ERP de produção.
        const somenteLeitura = (verbo: string, original: unknown): unknown => {
            const fn = original as (path: string, ...resto: unknown[]) => Promise<unknown>;
            return (path: string, ...resto: unknown[]): Promise<unknown> => {
                const limpo = String(path).split('?')[0];
                if (!ROTAS_DE_LEITURA.includes(limpo)) {
                    throw new Error(
                        `PRÉ-FLIGHT BLOQUEOU ${verbo.toUpperCase()} ${limpo}: rota fora da allowlist de ` +
                            'leitura. Esta sonda não escreve em produção — se a rota é mesmo de leitura, ' +
                            'inclua-a em ROTAS_DE_LEITURA conscientemente.',
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

        const { default: ConexosGerDocProcessoClient } = await import(
            '../domain/client/ConexosGerDocProcessoClient.js'
        );
        gerDoc = container.resolve(ConexosGerDocProcessoClient) as never;

        const { default: EnvironmentProvider } = await import(
            '../domain/libs/environment/EnvironmentProvider.js'
        );
        const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
        snGcdCod = env.solicitacaoNumerarioGcdCod;
        ndeNome = env.com297GcdNotaDebitoNome;

        relatorio.ambiente = { baseUrl: url, filCod, priCod, snGcdCod, ndeNome };
        anotar(`alvo: ${url} · filial ${filCod} · processo ${priCod} · SN_GCD_COD ${snGcdCod}`);
        if (filCod === 1) {
            anotar(
                'ATENÇÃO: filial 1. O gcd 150 dá CFOP_INCOMPATIVEL para TODA a filial 1 e o gcd próprio ' +
                    'dela nunca foi capturado — espere BLOCKED_ELEGIBILIDADE abaixo.',
            );
        }
    });

    afterAll(() => {
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[PRE-FLIGHT] relatório completo em ${RELATORIO}`);
    });

    it('1. o processo resolve pessoa, endereço fiscal e CNPJ?', async () => {
        pessoa = await gerDoc.validaProcessoPessoa({
            filCod,
            docTip: DOC_TIP,
            globalDocVldTipo: SN_GLOBAL_DOC_VLD_TIPO,
            priCod,
        });
        registrar('validaProcessoPessoa', pessoa);
        anotar(
            `pessoa ${String(pessoa?.pesCod)} (${String(pessoa?.dpeNomPessoa ?? '-')}) · ` +
                `endCodFis ${String(pessoa?.endCodFis)} · CNPJ ${String(pessoa?.pdcDocFederal ?? '-')}`,
        );
        expect(pessoa).toBeDefined();
    });

    it('2. o processo é ELEGÍVEL para a SN-Encomenda nesta filial?', async () => {
        if (pessoa?.pesCod === undefined) {
            anotar('INCONCLUSIVO: sem pesCod não dá para checar elegibilidade.');
            return;
        }
        const r = await gerDoc.verificarConfigElegivel({
            filCod,
            docTip: DOC_TIP,
            globalDocVldTipo: SN_GLOBAL_DOC_VLD_TIPO,
            priCod,
            pesCod: pessoa.pesCod,
            ...(pessoa.pdcDocFederal !== undefined ? { pdcDocFederal: pessoa.pdcDocFederal } : {}),
            endCodFis: pessoa.endCodFis,
            gcdCod: snGcdCod,
        });
        registrar('verificarConfigElegivel', r);
        anotar(
            r.elegivel === true
                ? `ELEGÍVEL para o gcd ${snGcdCod}${r.aviso ? ` (aviso: ${String(r.aviso)})` : ''}`
                : `NÃO ELEGÍVEL para o gcd ${snGcdCod}: ${String(r.motivo ?? 'sem motivo declarado')} — ` +
                      'escolha outro processo ou capture o gcd correto desta filial.',
        );
        expect(r).toBeDefined();
    });

    it('3. O CLIENTE TEM CONDIÇÃO DE PAGAMENTO SUGERIDA? (a pergunta que decide o risco)', async () => {
        if (pessoa?.pesCod === undefined) {
            anotar('INCONCLUSIVO: sem pesCod não dá para checar a condição de pagamento.');
            return;
        }
        const opcoes = await gerDoc.listCondPgtoPessoa({ filCod, pesCod: pessoa.pesCod });
        registrar('listCondPgtoPessoa', opcoes);
        anotar(
            opcoes.length === 0
                ? 'SEM condição de pagamento no cadastro — o ramo condicional NÃO dispara. É o caminho ' +
                      'que produção já demonstrou funcionar. VERDE para seguir.'
                : `TEM ${opcoes.length} condição(ões) no cadastro: ` +
                      `${opcoes.map((o) => `${String(o.pgtCod)}=${String(o.pgtDesNome)}`).join(', ')}. ` +
                      'A com194 PODE exigir a condição e acionar `applyPaymentConditionIfRequired`, que ' +
                      'nunca rodou em nenhum ambiente. Prefira um cliente sem condição para esta primeira.',
        );
        expect(Array.isArray(opcoes)).toBe(true);
    });

    it('4. a configuração da NDe existe nesta filial, resolvida pelo NOME?', async () => {
        // O `COM297_GCD_NOTA_DEBITO` NÃO deve ser setado: o código é por-ambiente (186 é do HML). Sem a
        // env, o com297 resolve pelo nome — e é isso que precisa funcionar em produção.
        const gcd = await gerDoc.resolveGcdCodByName({
            tela: 'com297',
            filCod,
            gcdDesNome: ndeNome,
        });
        registrar('resolveGcdCodByName(com297)', gcd ?? null);
        anotar(
            gcd !== undefined
                ? `NDe: config "${ndeNome}" resolvida como gcd ${gcd} na filial ${filCod}`
                : `NDe: config "${ndeNome}" NÃO encontrada na filial ${filCod} — a etapa nota-debito ` +
                      'falharia com NumerarioGapError. Não rode o fluxo até resolver.',
        );
        expect(true).toBe(true);
    });

    it('5. a trava de escrita está de pé (a sonda recusa uma rota de escrita)', async () => {
        // Prova viva do invariante: se alguém afrouxar a allowlist, este teste cai.
        const { container } = await import('tsyringe');
        const { default: ConexosBaseClient } = await import(
            '../domain/client/ConexosBaseClient.js'
        );
        const base = container.resolve(ConexosBaseClient) as unknown as {
            postGeneric: (p: string, b: unknown) => Promise<unknown>;
        };
        expect(() => base.postGeneric('com299/gerDoc/gerarDocProcesso', {})).toThrow(
            /PRÉ-FLIGHT BLOQUEOU/,
        );
    });
});

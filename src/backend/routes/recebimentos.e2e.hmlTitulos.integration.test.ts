import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * SONDA DIAGNÓSTICA — por que a SN do HML não materializa TÍTULO? (achado nº 4, `fase-b-rodada2-e-gap-titulos.md`)
 *
 * 100% SOMENTE LEITURA (GETs + LOVs de consulta). NÃO cria, altera nem finaliza documento algum.
 *
 * A pergunta que ela responde: a ausência de título é um PASSO QUE FALTA na automação (o botão
 * "Financeiro"/com032 da tela) ou uma DIFERENÇA DE DADOS do HML? O que motiva a dúvida: em PRODUÇÃO
 * a MESMA cadeia de código (condição de pagamento → item → finalizar) materializou o título
 * sozinha — SN 18345, `titCod 4`, baixa fin014 gravada (log do colega em
 * `ontology/_inbox/com299-sn-generation-har.md`, milestone 2026-08-03). No HML, o doc 733 tem item
 * e valor (R$ 123,45) mas `mnyTitValor: 0`, e a finalização é recusada.
 *
 * Estratégia: achar no HML QUALQUER título a receber aberto; se existir, comparar o documento dele
 * com o 733 campo a campo — a diferença aponta o campo/config que falta. Se o HML não tiver NENHUM
 * título a receber, isso por si só é o diagnóstico (o ambiente nunca exercitou a leg financeira).
 *
 * Fora da suíte padrão (`*.integration.test.ts`). Rodar explicitamente:
 *   npx jest recebimentos.e2e.hmlTitulos --testPathIgnorePatterns "/node_modules/"
 *
 * Saída: resumo no console + dump completo em `C:/tmp/probe-titulos-hml.json`.
 */

jest.setTimeout(600_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const FIL_COD = 2;
const SKYJACK_PES_COD = 232;
const DOC_TIP = 1;
/** Resíduos da Fase B no HML: 733 é o "bom" (condição correta + item + valor, sem título). */
const DOCS_INVESTIGADOS = [733, 732, 731];
const RELATORIO = 'C:/tmp/probe-titulos-hml.json';

type AnyRecord = Record<string, unknown>;

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_k: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('sonda: SQL indisponível');
    },
    selectFirst: async () => {
        throw new Error('sonda: SQL indisponível');
    },
    insert: async () => {
        throw new Error('sonda: SQL indisponível');
    },
    update: async () => {
        throw new Error('sonda: SQL indisponível');
    },
    withTransaction: async () => {
        throw new Error('sonda: SQL indisponível');
    },
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

/** Campos que decidem a materialização do título — o que olhamos primeiro no diff. */
const CAMPOS_CHAVE = [
    'docCod',
    'docTip',
    'docMnyValor',
    'mnyBruto',
    'mnyTitValor',
    'qtdItens',
    'docVldFinalizado',
    'docVldTipo',
    'docVldTipoAdto',
    'pgtCod',
    'pgtDesNome',
    'vldRwCondpgt',
    'tpdCod',
    'tpdDesNome',
    'gerNum',
    'gerDes',
    'gcdCod',
    'gcdDesNome',
    'pesCod',
    'dpeNomPessoa',
    'priCod',
    'docDtaEmissao',
    'docDtaMovimento',
];

const resumir = (doc: AnyRecord): AnyRecord => {
    const out: AnyRecord = {};
    for (const campo of CAMPOS_CHAVE) if (campo in doc) out[campo] = doc[campo];
    return out;
};

/** Diferença campo a campo entre dois documentos (chaves da união; só o que difere). */
const diferencas = (a: AnyRecord, b: AnyRecord): AnyRecord => {
    const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out: AnyRecord = {};
    for (const chave of chaves) {
        const va = JSON.stringify(a[chave] ?? null);
        const vb = JSON.stringify(b[chave] ?? null);
        if (va !== vb) out[chave] = { comTitulo: a[chave] ?? null, doc733: b[chave] ?? null };
    }
    return out;
};

describe('SONDA read-only — por que a SN do HML não gera título (com299 → com032/fin014)', () => {
    const relatorio: AnyRecord = { ambiente: null, probes: {} as AnyRecord };
    let base: {
        ensureSid: () => Promise<void>;
        getGeneric: <T>(p: string, o?: { filCod?: number }) => Promise<T>;
        postGeneric: <T>(p: string, b: unknown, o?: { filCod?: number }) => Promise<T>;
    };

    /** Executa uma leitura tolerando falha — a sonda deve seguir e REGISTRAR o erro, nunca abortar. */
    const probe = async (nome: string, fn: () => Promise<unknown>): Promise<unknown> => {
        try {
            const resultado = await fn();
            (relatorio.probes as AnyRecord)[nome] = resultado;
            // eslint-disable-next-line no-console
            console.log(`[SONDA] ${nome}: OK`);
            return resultado;
        } catch (cause) {
            const erro = { erro: cause instanceof Error ? cause.message : String(cause) };
            (relatorio.probes as AnyRecord)[nome] = erro;
            // eslint-disable-next-line no-console
            console.log(`[SONDA] ${nome}: ERRO ${erro.erro}`);
            return null;
        }
    };

    beforeAll(async () => {
        const dotenv = carregarDotEnv();
        const url = dotenv.CONEXOS_BASE_URL ?? '';
        if (!/-hml\./.test(url)) {
            throw new Error(`ABORTADO: CONEXOS_BASE_URL não é homologação (${url}).`);
        }
        process.env.CONEXOS_BASE_URL = url;
        process.env.CONEXOS_USERNAME = dotenv.CONEXOS_USERNAME;
        process.env.CONEXOS_PASSWORD = dotenv.CONEXOS_PASSWORD;
        process.env.CONEXOS_FIL_COD = String(FIL_COD);
        // Cinto e suspensório: a sonda só lê, e o gate de escrita fica explicitamente DESLIGADO.
        process.env.CONEXOS_WRITE_ENABLED = 'false';
        process.env.CONEXOS_DRY_RUN = 'true';
        process.env.environment = 'local';
        delete process.env.client_name;
        delete process.env.databaseConnectionString;
        relatorio.ambiente = { baseUrl: url, filCod: FIL_COD };

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
        base = container.resolve(ConexosBaseClient) as never;
        await base.ensureSid();
    });

    afterAll(() => {
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[SONDA] relatório completo em ${RELATORIO}`);
    });

    it('1. estado dos documentos da Fase B (731/732/733) + validações que o ERP aponta', async () => {
        for (const docCod of DOCS_INVESTIGADOS) {
            const doc = (await probe(`com299/${docCod}`, () =>
                base.getGeneric<AnyRecord>(`com299/${docCod}`, { filCod: FIL_COD }),
            )) as AnyRecord | null;
            if (doc) {
                // eslint-disable-next-line no-console
                console.log(`[SONDA] doc ${docCod}: ${JSON.stringify(resumir(doc))}`);
            }
            // As validações do com194 são a EXPLICAÇÃO do próprio ERP para a recusa da finalização.
            await probe(`com194/${docCod}`, () =>
                base.postGeneric<unknown>(
                    'com194/documento/list',
                    {
                        fieldList: [],
                        filterList: { docTip: DOC_TIP, docCod },
                        pageNumber: 1,
                        pageSize: 50,
                        orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                    },
                    { filCod: FIL_COD },
                ),
            );
        }
        expect((relatorio.probes as AnyRecord)['com299/733']).toBeDefined();
    });

    it('2. o HML tem ALGUM título a receber aberto? (se não, o gap é do ambiente, não do código)', async () => {
        // LOV dos títulos a receber abertos SEM filtro de documento — a população inteira da filial.
        const lov = (await probe('lov/TituloBorderoReceber(todos)', () =>
            base.postGeneric<AnyRecord>(
                'lov/TituloBorderoReceber',
                {
                    fieldList: [
                        'docTip',
                        'docCod',
                        'titCod',
                        'titEspNumero',
                        'priCod',
                        'pesCod',
                        'dpeNomPessoa',
                        'titMnyValor',
                        'titMnyAberto',
                        'titDtaVencimento',
                    ],
                    filterList: { borVldFinalizado: 0, exibirTitulos: 1 },
                    pageNumber: 1,
                    orderBy: 'desc',
                    sortBy: 'docCod',
                },
                { filCod: FIL_COD },
            ),
        )) as AnyRecord | null;
        const rows = (lov?.rows ?? []) as AnyRecord[];
        // eslint-disable-next-line no-console
        console.log(
            `[SONDA] títulos a receber abertos no HML: count=${String(lov?.count)} rows=${rows.length}`,
        );

        // Se existe título, o documento dele é o CONTRAEXEMPLO: comparar com o 733 revela o que falta.
        const docComTitulo = rows[0]?.docCod;
        if (typeof docComTitulo === 'number') {
            const doc = (await probe(`com299/${docComTitulo}(com titulo)`, () =>
                base.getGeneric<AnyRecord>(`com299/${docComTitulo}`, { filCod: FIL_COD }),
            )) as AnyRecord | null;
            const doc733 = (relatorio.probes as AnyRecord)['com299/733'] as AnyRecord | undefined;
            if (doc && doc733 && !('erro' in doc733)) {
                const diff = diferencas(doc, doc733);
                (relatorio.probes as AnyRecord).diffDocComTituloVs733 = diff;
                // eslint-disable-next-line no-console
                console.log(
                    `[SONDA] DIFF (doc com título × 733): ${JSON.stringify(diff, null, 2)}`,
                );
            }
        }
        expect((relatorio.probes as AnyRecord)['lov/TituloBorderoReceber(todos)']).toBeDefined();
    });

    it('3. condições de pagamento do SKYJACK no HML e o que a tela "Financeiro" (com032) enxerga', async () => {
        await probe('lov/CondPgtoPessoa(skyjack)', () =>
            base.postGeneric<unknown>(
                'lov/CondPgtoPessoa',
                {
                    fieldList: ['pgtCod', 'pgtDesNome'],
                    filterList: { pesCod: SKYJACK_PES_COD, fdocTipPgto: 1 },
                    pageNumber: 1,
                    orderBy: 'asc',
                    sortBy: 'pgtDesNome',
                },
                { filCod: FIL_COD },
            ),
        );
        // Configs de SN que o processo 186 enxerga no HML — se a config usada (SN_GCD_COD) não for a
        // "ENCOMENDA" com `gcdVldTela:7` (FINANCEIRO_A_RECEBER), o doc nasce sem leg financeira e o
        // título nunca materializa. É a hipótese "dado do HML" contra a hipótese "passo faltante".
        await probe('lov/ConfigDocProcesso(pri 186)', () =>
            base.postGeneric<unknown>(
                'lov/ConfigDocProcesso',
                {
                    fieldList: ['gcdDesNome', 'gcdVldTela', 'gcdCod'],
                    filterList: {
                        priCod: 186,
                        docTip: DOC_TIP,
                        globalDocVldTipo: 9,
                        fPesCod: SKYJACK_PES_COD,
                        fEndCod: 1,
                    },
                    pageNumber: 1,
                    pageSize: 200,
                    orderBy: 'asc',
                    sortBy: 'gcdDesNome',
                },
                { filCod: FIL_COD },
            ),
        );
        // Rotas candidatas da tela de títulos (com032). Todas LEITURA; 404/405 é resposta válida
        // (registra qual existe) e alimenta a decisão sobre implementar `etapaTitulos`.
        await probe('com032/list(733)', () =>
            base.postGeneric<unknown>(
                'com032/list',
                {
                    fieldList: [],
                    filterList: { docTip: DOC_TIP, docCod: 733 },
                    pageNumber: 1,
                    pageSize: 50,
                },
                { filCod: FIL_COD },
            ),
        );
        await probe('com032/initialValues(733)', () =>
            base.getGeneric<unknown>(`com032/initialValues?docTip=${DOC_TIP}&docCod=733`, {
                filCod: FIL_COD,
            }),
        );
        expect((relatorio.probes as AnyRecord)['lov/CondPgtoPessoa(skyjack)']).toBeDefined();
    });
});

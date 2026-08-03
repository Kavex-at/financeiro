import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * EXPERIMENTO MÍNIMO (HML) — o que ZERA o título da SN, e o que o traz de volta?
 *
 * Evidência que motivou (sonda read-only 2026-08-03, `probe-titulos-hml.json`):
 *   - doc **732** — parou ANTES do item, condição ainda `1 A VISTA` → `mnyTitValor: 123,45` (TEM título)
 *   - doc **733** — PUT da condição (`101 SKYJACK - DUPLICATA`) + item → `mnyTitValor: 0` (SEM título)
 *   - doc **731** — PUT da condição (`103 BONDUELLE`) + item → `mnyTitValor: 0` (SEM título)
 * Logo o ERP GERA o título na geração do documento; um dos nossos dois passos o zera. Em produção a
 * MESMA cadeia terminou COM título (SN 18345, `titCod 4`) — então não é "passo faltante" genérico.
 *
 * O experimento reaplica a condição de pagamento no doc 733 AGORA (com o item já criado e
 * `docMnyValor` = 123,45) e mede `mnyTitValor` na releitura:
 *   - voltou 123,45 ⇒ a correção é reaplicar a condição DEPOIS do item (nova ordem em
 *     `completarSnAdiantamento`), e o fluxo destrava sem tela nova;
 *   - continuou 0 ⇒ repete com `1 A VISTA` (a condição que comprovadamente gerou título no 732).
 *     Se com A VISTA gerar e com a 101 não, o problema é a CONDIÇÃO 101 do HML (dado do ambiente).
 *     Se nenhuma gerar, a geração do título é mesmo um passo à parte (tela com032) e aí sim é gap.
 *
 * ESCRITA, mas RESTRITA: só faz `PUT com299` no documento 733 — um resíduo morto da Fase B, sem
 * baixa e sem NDe. NÃO cria documento, NÃO finaliza, NÃO toca em nenhum outro doc. Aborta se
 * `CONEXOS_BASE_URL` não for homologação.
 *
 * Rodar explicitamente:
 *   npx jest recebimentos.e2e.hmlTitulosExp --testPathIgnorePatterns "/node_modules/"
 *
 * Saída: console + `C:/tmp/exp-titulos-hml.json`.
 */

jest.setTimeout(600_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const FIL_COD = 2;
const DOC_TIP = 1;
/** Resíduo da Fase B usado como cobaia: tem item e valor, não tem título nem baixa. */
const DOC_COD = 733;
/** Condição do PRÓPRIO cliente (a correta, gravada pelo fix). */
const PGT_SKYJACK = 101;
/** Condição default do ERP na geração — a que o 732 tinha quando o título existia. */
const PGT_A_VISTA = 1;
const RELATORIO = 'C:/tmp/exp-titulos-hml.json';

type AnyRecord = Record<string, unknown>;

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_k: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('experimento: SQL indisponível');
    },
    selectFirst: async () => {
        throw new Error('experimento: SQL indisponível');
    },
    insert: async () => {
        throw new Error('experimento: SQL indisponível');
    },
    update: async () => {
        throw new Error('experimento: SQL indisponível');
    },
    withTransaction: async () => {
        throw new Error('experimento: SQL indisponível');
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

const ESTADO = ['docMnyValor', 'mnyBruto', 'mnyTitValor', 'qtdItens', 'docVldFinalizado', 'pgtCod'];

const estadoDo = (doc: AnyRecord): AnyRecord => {
    const out: AnyRecord = {};
    for (const campo of ESTADO) out[campo] = doc[campo] ?? null;
    return out;
};

describe('EXPERIMENTO HML — reaplicar a condição de pagamento regenera o título da SN?', () => {
    const relatorio: AnyRecord = { docCod: DOC_COD, passos: [] as AnyRecord[] };
    let base: {
        ensureSid: () => Promise<void>;
        getGeneric: <T>(p: string, o?: { filCod?: number }) => Promise<T>;
        postGeneric: <T>(p: string, b: unknown, o?: { filCod?: number }) => Promise<T>;
        putGenericOnce: <T>(p: string, b: unknown, o?: { filCod?: number }) => Promise<T>;
    };

    const registrar = (passo: string, dados: AnyRecord): void => {
        (relatorio.passos as AnyRecord[]).push({ passo, ...dados });
        // eslint-disable-next-line no-console
        console.log(`[EXP] ${passo}: ${JSON.stringify(dados)}`);
    };

    const lerDoc = (): Promise<AnyRecord> =>
        base.getGeneric<AnyRecord>(`com299/${DOC_COD}`, { filCod: FIL_COD });

    /** Reenvia o documento INTEIRO trocando só a condição (mesmo RMW do `atualizarDocumento`). */
    const aplicarCondicao = async (pgtCod: number, pgtDesNome: string): Promise<AnyRecord> => {
        const doc = await lerDoc();
        await base.putGenericOnce<unknown>(
            'com299',
            { ...doc, pgtCod, pgtDesNome, vldRwCondpgt: 1 },
            { filCod: FIL_COD },
        );
        return lerDoc();
    };

    /** Títulos do documento pela tela financeira (com032) — 0 linhas = nenhum título materializado. */
    const listarTitulos = async (): Promise<AnyRecord> =>
        base.postGeneric<AnyRecord>(
            'com032/list',
            {
                fieldList: [],
                filterList: { docTip: DOC_TIP, docCod: DOC_COD },
                pageNumber: 1,
                pageSize: 50,
            },
            { filCod: FIL_COD },
        );

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
        process.env.CONEXOS_WRITE_ENABLED = 'true';
        process.env.CONEXOS_DRY_RUN = 'false';
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
        base = container.resolve(ConexosBaseClient) as never;
        await base.ensureSid();
    });

    afterAll(() => {
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[EXP] relatório em ${RELATORIO}`);
    });

    it('reaplica a condição no doc 733 (item já existe) e mede se o título volta', async () => {
        const antes = await lerDoc();
        registrar('estado inicial', estadoDo(antes));
        // Pré-condição do experimento: é o doc SEM título. Se já tiver, alguém mexeu — pare e releia.
        expect(antes.mnyTitValor).toBe(0);

        // (1) Reaplica a condição CORRETA agora que `docMnyValor` = 123,45 (antes o PUT rodava com o
        // documento ainda sem item). Se o ERP regenera as parcelas no `vldRwCondpgt:1`, o título volta.
        const depoisSkyjack = await aplicarCondicao(PGT_SKYJACK, 'SKYJACK BRASIL - DUPLICATA');
        registrar('após reaplicar 101 SKYJACK - DUPLICATA', estadoDo(depoisSkyjack));
        const titulosSkyjack = await listarTitulos();
        registrar('com032 após 101', { count: titulosSkyjack.count, rows: titulosSkyjack.rows });

        if (Number(depoisSkyjack.mnyTitValor ?? 0) > 0) {
            // DIAGNÓSTICO: ordem dos passos. A correção é reaplicar a condição DEPOIS do item.
            registrar('VEREDITO', {
                causa: 'ordem-dos-passos',
                acao: 'reaplicar condição após criar o item em completarSnAdiantamento',
            });
            relatorio.veredito = 'ordem-dos-passos';
            return;
        }

        // (2) A condição correta não regenerou. Tenta a A VISTA — a que o doc 732 tinha quando o
        // título EXISTIA. Discrimina "condição 101 do HML não gera parcela" de "PUT nunca regenera".
        const depoisAVista = await aplicarCondicao(PGT_A_VISTA, 'A VISTA');
        registrar('após aplicar 1 A VISTA', estadoDo(depoisAVista));
        const titulosAVista = await listarTitulos();
        registrar('com032 após A VISTA', { count: titulosAVista.count, rows: titulosAVista.rows });

        const veredito =
            Number(depoisAVista.mnyTitValor ?? 0) > 0
                ? 'condicao-101-do-hml-nao-gera-titulo'
                : 'geracao-de-titulo-e-passo-separado(com032)';
        registrar('VEREDITO', { causa: veredito });
        relatorio.veredito = veredito;
        expect(typeof relatorio.veredito).toBe('string');
    });
});

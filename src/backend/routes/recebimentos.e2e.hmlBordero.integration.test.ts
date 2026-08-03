import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * SONDA DIAGNÓSTICA — o 400 `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` do `fin014/finalizar`.
 *
 * 100% SOMENTE LEITURA (GETs + LOVs de consulta). NÃO cria, altera, baixa nem finaliza nada.
 *
 * ESTADO (2026-08-03, tarde): o diagnóstico já FECHOU — ver `docs/e2e/fin014-finalizacao-hml-diagnostico.md`.
 * A causa NÃO é nossa: no HML de hoje **todo** borderô a-receber com baixa falha na validação e na
 * finalização, inclusive um montado à mão pela UI do Conexos com título de terceiro anterior ao projeto
 * (borderô 137, ENGEPECAS). É defeito de ambiente do lado da Conexos.
 *
 * As hipóteses que esta sonda mediu foram TODAS refutadas — em especial a H-numero (o `docEspNumero`
 * sair como a data e produzir `titEspNumero` homônimos): o borderô 133, que usa um `titEspNumero` ÚNICO
 * no ambiente, falha igual. Manter a sonda mesmo assim vale por dois motivos: ela é o instrumento pronto
 * para repetir a medição na **filial 1** (§9.2 do diagnóstico) e para reconferir o ambiente depois que a
 * Conexos mexer nele.
 *
 * As rotas abaixo foram CORRIGIDAS conforme a §6 do diagnóstico (capturadas da própria UI): a leitura do
 * borderô exige o `filCod` no path, e a lista de baixas é um `list` com `filterList`, não `list/{borCod}`.
 *
 * Fora da suíte padrão (`*.integration.test.ts`). Rodar explicitamente:
 *   npx jest recebimentos.e2e.hmlBordero --testPathIgnorePatterns "/node_modules/"
 *
 * Saída: resumo no console + dump completo em `C:/tmp/probe-bordero-hml.json`.
 */

jest.setTimeout(600_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const FIL_COD = 2;
const DOC_TIP = 1;
/** O borderô que a Fase B criou e não conseguiu finalizar. */
const BOR_COD = 135;
/** A SN da Fase B (738) e as duas SNs finalizadas da investigação do título (736/737). */
const DOCS = [738, 737, 736];
/** O número que os três títulos de hoje compartilham — o suspeito da colisão. */
const TIT_ESP_NUMERO_SUSPEITO = '030820261';
const RELATORIO = 'C:/tmp/probe-bordero-hml.json';

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

describe('SONDA read-only — o 400 CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE do fin014/finalizar', () => {
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
        relatorio.ambiente = { baseUrl: url, filCod: FIL_COD, borCod: BOR_COD };

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

    it('1. estado do borderô 135: finalizado? quantas baixas? que identificador carrega?', async () => {
        // H-ja-finalizado: se `borVldFinalizado` já é 1, a Fase B pediu uma SEGUNDA finalização.
        // Rota com `filCod` no path (§6): sem ele o ERP devolve 405.
        const bordero = (await probe(`fin014/${FIL_COD}/${BOR_COD}`, () =>
            base.getGeneric<AnyRecord>(`fin014/${FIL_COD}/${BOR_COD}`, { filCod: FIL_COD }),
        )) as AnyRecord | null;
        if (bordero) {
            // eslint-disable-next-line no-console
            console.log(`[SONDA] borderô ${BOR_COD}: ${JSON.stringify(bordero)}`);
        }
        // H-baixa-dupla: mais de uma baixa para o mesmo título dentro do borderô colidiria na gravação.
        // A lista de baixas é um `list` filtrado por `borCod` (§6) — `list/{borCod}` dá 405, e
        // `list3/{borCod}` é a grade de CHEQUES, não a de baixas.
        const baixas = (await probe(`fin014/baixas/list(${BOR_COD})`, () =>
            base.postGeneric<AnyRecord>(
                'fin014/baixas/list',
                {
                    fieldList: [],
                    filterList: { 'borCod#EQ': String(BOR_COD) },
                    serviceName: 'fin014.FinBaixa',
                    pageNumber: 1,
                    pageSize: 100,
                },
                { filCod: FIL_COD },
            ),
        )) as AnyRecord | null;
        // eslint-disable-next-line no-console
        console.log(
            `[SONDA] baixas do borderô ${BOR_COD}: count=${String(baixas?.count)} ` +
                `rows=${JSON.stringify(baixas?.rows ?? [])}`,
        );
        expect((relatorio.probes as AnyRecord)[`fin014/${FIL_COD}/${BOR_COD}`]).toBeDefined();
    });

    it('2. H-numero: quantos títulos ABERTOS da filial compartilham o mesmo titEspNumero?', async () => {
        // A população inteira de títulos a receber abertos. REFUTADO como causa do 400 (o borderô 133 usa
        // um `titEspNumero` único e falha igual), mas a duplicidade em si é real e continua sendo um
        // follow-up: em produção o `docEspNumero` é o nº do PROCESSO, aqui sai como a data.
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
                        'titMnyTotPago',
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
        const homonimos = rows.filter((r) => String(r.titEspNumero) === TIT_ESP_NUMERO_SUSPEITO);
        const porNumero = new Map<string, number>();
        for (const r of rows) {
            const n = String(r.titEspNumero);
            porNumero.set(n, (porNumero.get(n) ?? 0) + 1);
        }
        const duplicados = [...porNumero.entries()].filter(([, q]) => q > 1);
        (relatorio.probes as AnyRecord).analiseNumeros = {
            totalAbertos: rows.length,
            suspeito: TIT_ESP_NUMERO_SUSPEITO,
            homonimosDoSuspeito: homonimos.map((r) => ({
                docCod: r.docCod,
                titCod: r.titCod,
                titEspNumero: r.titEspNumero,
                titMnyAberto: r.titMnyAberto,
            })),
            numerosDuplicados: duplicados,
        };
        // eslint-disable-next-line no-console
        console.log(
            `[SONDA] títulos abertos=${rows.length}; com número "${TIT_ESP_NUMERO_SUSPEITO}"=` +
                `${homonimos.length}; números duplicados=${JSON.stringify(duplicados)}`,
        );
        // eslint-disable-next-line no-console
        console.log(`[SONDA] homônimos: ${JSON.stringify(homonimos, null, 2)}`);
        expect((relatorio.probes as AnyRecord)['lov/TituloBorderoReceber(todos)']).toBeDefined();
    });

    it('3. os documentos 736/737/738: número, valor e se o título já foi baixado', async () => {
        for (const docCod of DOCS) {
            const doc = (await probe(`com299/${docCod}`, () =>
                base.getGeneric<AnyRecord>(`com299/${docCod}`, { filCod: FIL_COD }),
            )) as AnyRecord | null;
            if (doc) {
                // eslint-disable-next-line no-console
                console.log(
                    `[SONDA] doc ${docCod}: docEspNumero=${String(doc.docEspNumero)} ` +
                        `docMnyValor=${String(doc.docMnyValor)} mnyTitValor=${String(doc.mnyTitValor)} ` +
                        `docVldFinalizado=${String(doc.docVldFinalizado)}`,
                );
            }
            // O título deste doc ainda aparece como ABERTO? Para o 738 isso responde o risco de retomada:
            // se a baixa pegou e o título saiu do LOV, um re-POST recriaria borderô sem ter o que baixar.
            await probe(`lov/TituloBorderoReceber(${docCod})`, () =>
                base.postGeneric<unknown>(
                    'lov/TituloBorderoReceber',
                    {
                        fieldList: ['docCod', 'titCod', 'titEspNumero', 'titMnyAberto'],
                        filterList: { 'docCod#EQ': docCod, borVldFinalizado: 0, exibirTitulos: 1 },
                        pageNumber: 1,
                        orderBy: 'asc',
                        sortBy: 'titCod',
                    },
                    { filCod: FIL_COD },
                ),
            );
            // A explicação do próprio ERP para o documento, se houver validação pendente.
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
        expect((relatorio.probes as AnyRecord)['com299/738']).toBeDefined();
    });

    it('4. H-campo-faltante: existe borderô a-receber JÁ FINALIZADO no HML para comparar?', async () => {
        // Population dos borderôs a-receber (borVldTipo=1) da filial, mais novos primeiro. `fieldList: []`
        // para descobrir TODOS os campos — inclusive o(s) que carregam o "código identificador".
        const lista = (await probe('fin014/list(a receber)', () =>
            base.postGeneric<AnyRecord>(
                'fin014/list',
                {
                    fieldList: [],
                    filterList: { 'borVldTipo#EQ': 1 },
                    pageNumber: 1,
                    pageSize: 50,
                    orderList: { orderList: [{ propertyName: 'borCod', order: 'desc' }] },
                },
                { filCod: FIL_COD },
            ),
        )) as AnyRecord | null;
        const rows = (lista?.rows ?? []) as AnyRecord[];
        const finalizados = rows.filter((r) => Number(r.borVldFinalizado) === 1);
        // eslint-disable-next-line no-console
        console.log(
            `[SONDA] borderôs a-receber=${rows.length}; finalizados=${finalizados.length}; ` +
                `topo=${JSON.stringify(rows.slice(0, 5))}`,
        );
        // Se existe um finalizado, o detalhe dele é o contraexemplo: comparar campo a campo com o 135.
        const modelo = finalizados[0]?.borCod;
        if (modelo !== undefined) {
            await probe(`fin014/${String(modelo)}(finalizado)`, () =>
                base.getGeneric<AnyRecord>(`fin014/${FIL_COD}/${String(modelo)}`, {
                    filCod: FIL_COD,
                }),
            );
            await probe(`fin014/baixas/list(${String(modelo)})`, () =>
                base.postGeneric<unknown>(
                    'fin014/baixas/list',
                    {
                        fieldList: [],
                        filterList: { 'borCod#EQ': String(modelo) },
                        serviceName: 'fin014.FinBaixa',
                        pageNumber: 1,
                        pageSize: 100,
                    },
                    { filCod: FIL_COD },
                ),
            );
            // O que a finalização ESCREVE quando funciona (§4 do diagnóstico): um lote contábil `RC`
            // fechado + dois lançamentos (débito banco / crédito clientes). É o gabarito do que
            // esperamos ver no 135 quando a perna finalmente rodar.
            await probe(`fin014/lancamentosContabeis/${String(modelo)}`, () =>
                base.postGeneric<unknown>(
                    `fin014/lancamentosContabeis/${String(modelo)}`,
                    { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 50 },
                    { filCod: FIL_COD },
                ),
            );
        }
        expect((relatorio.probes as AnyRecord)['fin014/list(a receber)']).toBeDefined();
    });
});

import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * EXPERIMENTO DA ORDEM INVERTIDA (HML) — item ANTES da condição de pagamento resolve o título?
 *
 * Continuação de `recebimentos.e2e.hmlTituloZero.integration.test.ts`, que mediu passo a passo o doc
 * 734 e mostrou o seguinte (ordem ATUAL do produto: condição → item):
 *   0. geração                    → `docMnyValor` 123,45 · `mnyTitValor` **123,45** (o título NASCE aqui)
 *   1. PUT da condição (1 → 101)  → `docMnyValor` **0** · `mnyTitValor` **0**   ← zera tudo
 *   2. linha de item              → `mnyBruto` 123,45 · `docMnyValor` 0 · título 0
 *   3. reaplicar a condição       → `docMnyValor` 123,45 (recalculou do item) · título ainda 0
 *
 * Leitura: o PUT do com299 RECALCULA o `docMnyValor` a partir das linhas de item. No passo 1 não havia
 * item, então o valor foi a zero e as parcelas foram reescritas sobre um documento de valor zero. No
 * passo 3 o valor voltou (já havia item), mas as parcelas não — a condição não MUDOU (101 → 101), e é a
 * mudança que dispara o `vldRwCondpgt:1`.
 *
 * Hipótese deste experimento: com a ordem INVERTIDA — item primeiro, condição depois — o único PUT do
 * fluxo acontece com o documento já valorizado E com a condição mudando de fato (1 A VISTA → 101 do
 * cliente), que são exatamente as duas condições que nunca coexistiram. Se o título sobreviver, a
 * correção no produto é trocar a ordem dentro de `completarSnAdiantamento`.
 *
 * Mede: geração → item → condição → finalização (só se `mnyTitValor === docMnyValor`) → e, se finalizar,
 * confere se o título aparece no `lov/TituloBorderoReceber`, que é o que a `etapaFin014` consulta.
 *
 * ESCRITA REAL, restrita ao HML: cria UM documento com299 novo (R$ 123,45, SKYJACK pri 186, filial 2).
 * Aborta se `CONEXOS_BASE_URL` não for homologação. NÃO toca em documento pré-existente nem na NDe.
 *
 * Rodar explicitamente:
 *   npx jest recebimentos.e2e.hmlTituloOrdem --testPathIgnorePatterns "/node_modules/"
 *
 * Saída: console + `C:/tmp/exp-titulo-ordem-hml.json`.
 */

jest.setTimeout(900_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const FIL_COD = 2;
const PRI_COD = 186;
const SKYJACK_PES_COD = 232;
const MOE_COD = 790;
const VALOR = 123.45;
const RELATORIO = 'C:/tmp/exp-titulo-condicao-hml.json';

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

describe('EXPERIMENTO DA CONDIÇÃO (HML) — condição no header da geração (A) ou não mexer nela (B)?', () => {
    const relatorio: AnyRecord = { valor: VALOR, priCod: PRI_COD, passos: [] as AnyRecord[] };
    let gerDoc: AnyRecord;
    let service: AnyRecord;
    let payloadBuilder: AnyRecord;
    let base: AnyRecord;
    let docCod: number | undefined;

    const registrar = (passo: string, dados: AnyRecord): void => {
        (relatorio.passos as AnyRecord[]).push({ passo, ...dados });
        // eslint-disable-next-line no-console
        console.log(`[COND] ${passo}: ${JSON.stringify(dados)}`);
    };

    const lerDoc = async (): Promise<AnyRecord> =>
        (await (gerDoc.getDocumento as (p: AnyRecord) => Promise<AnyRecord>)({
            tela: 'com299',
            filCod: FIL_COD,
            docCod,
        })) as AnyRecord;

    /**
     * Releitura + registro do estado após um passo. Devolve o `mnyTitValor` medido.
     * Sem chamador hoje (sobra do diagnóstico de títulos de 2026-08-03) — mantido com `_` para quem
     * retomar a medição passo-a-passo neste roteiro opt-in de HML.
     */
    const _medir = async (passo: string): Promise<number> => {
        const doc = await lerDoc();
        const estado = estadoDo(doc);
        registrar(passo, estado);
        return Number(estado.mnyTitValor ?? 0);
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
        process.env.CONEXOS_WRITE_ENABLED = 'true';
        process.env.CONEXOS_DRY_RUN = 'false';
        process.env.SN_GCD_COD = dotenv.SN_GCD_COD ?? '150';
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
        // O serviço é resolvido só pelo `classificarAlocacao`, mas o tsyringe injeta o construtor
        // INTEIRO — então os dois repositórios precisam existir. Stubs: nada aqui os exercita (a
        // escrita é feita direto pelos clients, passo a passo).
        const { registerRecebimentosPorts } = await import('../domain/recebimentosContainer.js');
        registerRecebimentosPorts();
        const { SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN, NDE_REPOSITORY_TOKEN } =
            await import('../domain/interface/recebimentos/ports.js');
        container.register(SOLICITACAO_NUMERARIO_EXECUCAO_REPOSITORY_TOKEN, {
            useValue: {
                findByIdempotencyKey: async () => null,
                beginExecution: async () => ({ status: 'reconciling', alreadySettled: false }),
                setDocCod: async () => undefined,
                setRequestPayload: async () => undefined,
                setFin014BorCod: async () => undefined,
                setNdDocCod: async () => undefined,
                setEtapa: async () => undefined,
                setRevisaoHumana: async () => undefined,
                setNdeAutorizado: async () => undefined,
                markSettled: async () => undefined,
                markError: async () => undefined,
            },
        });
        container.register(NDE_REPOSITORY_TOKEN, {
            useValue: {
                save: async (nde: AnyRecord) => nde,
                findByRecebimentoId: async () => null,
                listParaPainel: async () => [],
                contarPendentes: async () => 0,
                updateNumeroNde: async () => undefined,
            },
        });
        const { default: ConexosGerDocProcessoClient } = await import(
            '../domain/client/ConexosGerDocProcessoClient.js'
        );
        const { default: RecebimentoNumerarioService } = await import(
            '../domain/service/recebimentos/RecebimentoNumerarioService.js'
        );
        const { default: SnPayloadBuilder } = await import(
            '../domain/service/recebimentos/SnPayloadBuilder.js'
        );
        gerDoc = container.resolve(ConexosGerDocProcessoClient) as never;
        // O serviço entra APENAS pelo `classificarAlocacao` (pré-flight read-only) — a escrita deste
        // experimento é feita passo a passo pelos clients, para poder medir entre um passo e outro.
        service = container.resolve(RecebimentoNumerarioService) as never;
        payloadBuilder = container.resolve(SnPayloadBuilder) as never;
    });

    afterAll(() => {
        relatorio.docCod = docCod ?? null;
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[COND] relatório em ${RELATORIO} (doc criado: ${String(docCod)})`);
    });

    /** Gera uma SN nova; `extra` entra no header do `gerDocProcesso` (ex.: a condição de pagamento). */
    const gerarSn = async (extra: AnyRecord = {}): Promise<number> => {
        const processo = {
            priCod: PRI_COD,
            filCod: FIL_COD,
            pesCod: SKYJACK_PES_COD,
            dpeNomPessoa: 'SKYJACK BRASIL IMPORTACAO E COMERCIO',
            moeCod: MOE_COD,
        };
        const preflight = (await (
            service.classificarAlocacao as (p: AnyRecord) => Promise<AnyRecord>
        )({ processo, filCod: FIL_COD, gcdCodFallback: 150 })) as AnyRecord;
        const config = await (gerDoc.validaConfigDoc as (p: AnyRecord) => Promise<AnyRecord>)({
            tela: 'com299',
            filCod: FIL_COD,
            docTip: 1,
            globalDocVldTipo: 9,
            priCod: PRI_COD,
            pesCod: SKYJACK_PES_COD,
            pdcDocFederal: preflight.pdcDocFederal,
            endCodFis: preflight.endCodFis,
            gcdCod: preflight.gcdCod ?? 150,
        });
        const payload = (
            payloadBuilder.buildSnRealPayload as (
                a: unknown,
                b: unknown,
                c: unknown,
                d: unknown,
            ) => AnyRecord
        )(
            {
                processo,
                valorSn: VALOR,
                dataReferencia: new Date(),
                gcdCod: (preflight.gcdCod ?? 150) as number,
            },
            config,
            { endCodFis: preflight.endCodFis, pdcDocFederal: preflight.pdcDocFederal },
            {
                ...(preflight.gcdCod !== undefined ? { gcdCod: preflight.gcdCod } : {}),
                ...(preflight.gcdDesNome !== undefined ? { gcdDesNome: preflight.gcdDesNome } : {}),
            },
        );
        await (gerDoc.validarGeracao as (p: AnyRecord) => Promise<unknown>)({
            tela: 'com299',
            filCod: FIL_COD,
            gcdCod: preflight.gcdCod ?? 150,
        });
        const gen = (await (gerDoc.gerarDocProcesso as (p: AnyRecord) => Promise<AnyRecord>)({
            tela: 'com299',
            filCod: FIL_COD,
            payload: { ...payload, ...extra },
        })) as AnyRecord;
        return Number(gen.docCod);
    };

    /** Linha de item (conta ADIANTAMENTO DE CLIENTE ENCOMENDA) — idêntica à do produto. */
    const criarItem = async (): Promise<void> => {
        const contas = (await (
            gerDoc.listContasProjetoCtb as (p: AnyRecord) => Promise<Array<AnyRecord>>
        )({ filCod: FIL_COD, prjCod: 1, priCod: PRI_COD, tpdCod: 3 })) as Array<AnyRecord>;
        const conta = contas.find((c) =>
            String(c.ctpDesNome).toUpperCase().includes('ADIANTAMENTO DE CLIENTE ENCOMENDA'),
        );
        expect(conta).toBeDefined();
        const doc = await lerDoc();
        const template = await (
            gerDoc.comDocProdutosInitialValues as (p: AnyRecord) => Promise<AnyRecord>
        )({ tela: 'com299', filCod: FIL_COD, doc });
        await (gerDoc.adicionarComDocProduto as (p: AnyRecord) => Promise<unknown>)({
            tela: 'com299',
            filCod: FIL_COD,
            payload: {
                ...template,
                filCod: FIL_COD,
                docCod,
                priCod: PRI_COD,
                dprQtdQuantidade: 1,
                dprPreValorun: VALOR,
                prjCod: 1,
                ctpCod: conta?.ctpCod,
                ctpDesNome: conta?.ctpDesNome,
            },
        });
    };

    /** Validações do próprio ERP para o documento (com194). `fdvVldErr:2` = bloqueante; `1` = aviso. */
    const lerValidacoes = async (): Promise<unknown> => {
        try {
            return await (
                base.postGeneric as (p: string, b: unknown, o: AnyRecord) => Promise<unknown>
            )(
                'com194/documento/list',
                {
                    fieldList: [],
                    filterList: { docTip: 1, docCod, fdvVldTperr: 1 },
                    pageNumber: 1,
                    pageSize: 50,
                    orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                },
                { filCod: FIL_COD },
            );
        } catch (cause) {
            return { erro: cause instanceof Error ? cause.message : String(cause) };
        }
    };

    /** Finaliza se título == documento; devolve se o ERP REALMENTE finalizou (`docVldFinalizado===1`). */
    const tentarFinalizar = async (rotulo: string): Promise<boolean> => {
        const doc = await lerDoc();
        const valorDoc = Number(doc.docMnyValor ?? 0);
        const titulo = Number(doc.mnyTitValor ?? 0);
        if (!(titulo > 0 && titulo === valorDoc)) {
            registrar(`${rotulo} finalização NÃO tentada`, { valorDoc, titulo });
            return false;
        }
        try {
            await (gerDoc.finalizarDocumento as (p: AnyRecord) => Promise<unknown>)({
                tela: 'com299',
                filCod: FIL_COD,
                docCod,
            });
        } catch (cause) {
            registrar(`${rotulo} finalização FALHOU`, {
                erro: cause instanceof Error ? cause.message : String(cause),
            });
        }
        const depois = await lerDoc();
        registrar(`${rotulo} após finalizar`, estadoDo(depois));
        return Number(depois.docVldFinalizado ?? 0) === 1;
    };

    /** O título aparece no LOV que a `etapaFin014` consulta? É isso que destrava a leg da baixa. */
    const titulosDoFin014 = async (): Promise<unknown> => {
        const { default: ConexosFin014Client } = await import(
            '../domain/client/ConexosFin014Client.js'
        );
        const { container } = await import('tsyringe');
        const fin014 = container.resolve(ConexosFin014Client) as unknown as AnyRecord;
        return (fin014.listTitulosBorderoReceber as (p: AnyRecord) => Promise<unknown>)({
            filCod: FIL_COD,
            docCod,
        });
    };

    it('A: gerar já com a condição do cliente no header; B (se A falhar): não tocar na condição', async () => {
        // ── VARIANTE A — a condição do cliente vai no HEADER da geração. Se o ERP aceitar, o documento
        // nasce com a condição CERTA e o título coerente, e o PUT que destruía as parcelas some do fluxo.
        const condicoes = (await (
            gerDoc.listCondPgtoPessoa as (p: AnyRecord) => Promise<Array<AnyRecord>>
        )({ filCod: FIL_COD, pesCod: SKYJACK_PES_COD })) as Array<AnyRecord>;
        const cond = condicoes.find((c) => /^SKYJACK/.test(String(c.pgtDesNome).toUpperCase()));
        expect(cond).toBeDefined();
        registrar('A. condição do cliente', { cond: cond ?? null });

        docCod = await gerarSn({ pgtCod: cond?.pgtCod, pgtDesNome: cond?.pgtDesNome });
        registrar('A. documento GERADO', { docCod });
        const nasceu = await lerDoc();
        registrar('A. estado após a geração', estadoDo(nasceu));
        const nasceuComCondicao = Number(nasceu.pgtCod ?? 0) === Number(cond?.pgtCod ?? -1);
        const tituloNaGeracaoA = Number(nasceu.mnyTitValor ?? 0);

        await criarItem();
        registrar('A. estado após o item', estadoDo(await lerDoc()));

        const finalizouA = await tentarFinalizar('A.');
        registrar('A. validações com194', { validacoes: await lerValidacoes() });
        if (finalizouA) {
            registrar('A. títulos visíveis ao fin014', { titulos: await titulosDoFin014() });
        }

        const docA = docCod;
        relatorio.varianteA = {
            docCod: docA,
            nasceuComCondicao,
            tituloNaGeracao: tituloNaGeracaoA,
            pgtCod: nasceu.pgtCod,
            finalizou: finalizouA,
        };

        if (finalizouA && nasceuComCondicao) {
            relatorio.veredito = 'A-RESOLVE (condição no header da geração)';
            registrar('VEREDITO', { veredito: relatorio.veredito, docCod: docA });
            expect(typeof relatorio.veredito).toBe('string');
            return;
        }

        // ── VARIANTE B — deixar a condição DEFAULT (a que o ERP escolhe na geração) e só finalizar.
        // Responde se a condição do cliente é requisito do ERP ou premissa nossa: a com194 dirá se
        // "CONDIÇÃO DE PAGAMENTO DIFERENTE DA SUGERIDA" é aviso (fdvVldErr:1) ou erro (2).
        docCod = await gerarSn();
        registrar('B. documento GERADO (condição default)', { docCod });
        registrar('B. estado após a geração', estadoDo(await lerDoc()));
        await criarItem();
        registrar('B. estado após o item', estadoDo(await lerDoc()));
        const finalizouB = await tentarFinalizar('B.');
        registrar('B. validações com194', { validacoes: await lerValidacoes() });
        if (finalizouB) {
            registrar('B. títulos visíveis ao fin014', { titulos: await titulosDoFin014() });
        }

        relatorio.varianteB = { docCod, finalizou: finalizouB };
        relatorio.veredito = finalizouB
            ? 'B-RESOLVE (não mexer na condição; confirmar se a do cliente é mesmo exigida)'
            : 'nem-A-nem-B (a geração de título precisa de passo próprio — capturar HAR do com032)';
        registrar('VEREDITO', {
            veredito: relatorio.veredito,
            varianteA: relatorio.varianteA as AnyRecord,
            varianteB: relatorio.varianteB as AnyRecord,
        });
        expect(typeof relatorio.veredito).toBe('string');
    });
});

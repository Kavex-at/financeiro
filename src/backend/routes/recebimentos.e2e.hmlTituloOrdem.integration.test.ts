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
const RELATORIO = 'C:/tmp/exp-titulo-ordem-hml.json';

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

describe('EXPERIMENTO DA ORDEM (HML) — item antes da condição preserva o título da SN?', () => {
    const relatorio: AnyRecord = { valor: VALOR, priCod: PRI_COD, passos: [] as AnyRecord[] };
    let gerDoc: AnyRecord;
    let service: AnyRecord;
    let payloadBuilder: AnyRecord;
    let docCod: number | undefined;

    const registrar = (passo: string, dados: AnyRecord): void => {
        (relatorio.passos as AnyRecord[]).push({ passo, ...dados });
        // eslint-disable-next-line no-console
        console.log(`[ORDEM] ${passo}: ${JSON.stringify(dados)}`);
    };

    const lerDoc = async (): Promise<AnyRecord> =>
        (await (gerDoc.getDocumento as (p: AnyRecord) => Promise<AnyRecord>)({
            tela: 'com299',
            filCod: FIL_COD,
            docCod,
        })) as AnyRecord;

    /** Releitura + registro do estado após um passo. Devolve o `mnyTitValor` medido. */
    const medir = async (passo: string): Promise<number> => {
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
        container.resolve(ConexosBaseClient);
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
        console.log(`[ORDEM] relatório em ${RELATORIO} (doc criado: ${String(docCod)})`);
    });

    it('gera uma SN nova com a ordem INVERTIDA (item → condição) e mede o título', async () => {
        const processo = {
            priCod: PRI_COD,
            filCod: FIL_COD,
            pesCod: SKYJACK_PES_COD,
            dpeNomPessoa: 'SKYJACK BRASIL IMPORTACAO E COMERCIO',
            moeCod: MOE_COD,
        };

        // ── Pré-flight read-only (mesmo do fluxo real): resolve endCodFis/pdcDocFederal/gcd por-processo.
        const preflight = (await (
            service.classificarAlocacao as (p: AnyRecord) => Promise<AnyRecord>
        )({ processo, filCod: FIL_COD, gcdCodFallback: 150 })) as AnyRecord;
        registrar('pré-flight', {
            classificacao: preflight.classificacao,
            gcdCod: preflight.gcdCod,
            gcdDesNome: preflight.gcdDesNome,
            endCodFis: preflight.endCodFis,
        });
        expect(preflight.endCodFis).toBeDefined();
        expect(preflight.pdcDocFederal).toBeDefined();

        // ── PASSO 0 — geração do documento (header, sem itens), idêntica à `etapaSn`.
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
        const snPayloadInput = {
            processo,
            valorSn: VALOR,
            dataReferencia: new Date(),
            gcdCod: (preflight.gcdCod ?? 150) as number,
        };
        const payload = (
            payloadBuilder.buildSnRealPayload as (
                a: unknown,
                b: unknown,
                c: unknown,
                d: unknown,
            ) => AnyRecord
        )(
            snPayloadInput,
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
            payload,
        })) as AnyRecord;
        docCod = Number(gen.docCod);
        registrar('0. documento GERADO', { docCod });
        const tituloNaGeracao = await medir('0. estado após a geração');

        // ── PASSO 1 (INVERTIDO) — linha de item ANTES da condição. Assim o único PUT do fluxo acontece
        // com o documento já valorizado, e não sobre um doc de valor zero.
        const contas = (await (
            gerDoc.listContasProjetoCtb as (p: AnyRecord) => Promise<Array<AnyRecord>>
        )({ filCod: FIL_COD, prjCod: 1, priCod: PRI_COD, tpdCod: 3 })) as Array<AnyRecord>;
        const conta = contas.find((c) =>
            String(c.ctpDesNome).toUpperCase().includes('ADIANTAMENTO DE CLIENTE ENCOMENDA'),
        );
        registrar('1. conta de rateio', { conta: conta ?? null, total: contas.length });
        expect(conta).toBeDefined();
        const docParaItem = await lerDoc();
        const template = await (
            gerDoc.comDocProdutosInitialValues as (p: AnyRecord) => Promise<AnyRecord>
        )({ tela: 'com299', filCod: FIL_COD, doc: docParaItem });
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
        const tituloAposItem = await medir('1. estado após a LINHA DE ITEM');

        // ── PASSO 2 (INVERTIDO) — condição de pagamento por último. Aqui a condição REALMENTE muda
        // (1 A VISTA → 101 do cliente) com item já lançado: é a combinação que o run anterior nunca teve.
        const condicoes = (await (
            gerDoc.listCondPgtoPessoa as (p: AnyRecord) => Promise<Array<AnyRecord>>
        )({ filCod: FIL_COD, pesCod: SKYJACK_PES_COD })) as Array<AnyRecord>;
        const cond = condicoes.find((c) => /^SKYJACK/.test(String(c.pgtDesNome).toUpperCase()));
        registrar('2. condição escolhida', { cond: cond ?? null, total: condicoes.length });
        expect(cond).toBeDefined();
        const docParaPut = await lerDoc();
        await (gerDoc.atualizarDocumento as (p: AnyRecord) => Promise<unknown>)({
            tela: 'com299',
            filCod: FIL_COD,
            payload: {
                ...docParaPut,
                pgtCod: cond?.pgtCod,
                pgtDesNome: cond?.pgtDesNome,
                vldRwCondpgt: 1,
            },
        });
        const tituloAposCondicao = await medir('2. estado após a CONDIÇÃO de pagamento');

        // ── PASSO 3 — finalizar SÓ se os totais batem (é o que o ERP exige: título == documento).
        const docAntesFinal = await lerDoc();
        const valorDoc = Number(docAntesFinal.docMnyValor ?? 0);
        const tituloAntesFinal = Number(docAntesFinal.mnyTitValor ?? 0);
        let finalizado = false;
        if (tituloAntesFinal > 0 && tituloAntesFinal === valorDoc) {
            try {
                await (gerDoc.finalizarDocumento as (p: AnyRecord) => Promise<unknown>)({
                    tela: 'com299',
                    filCod: FIL_COD,
                    docCod,
                });
                const doc = await lerDoc();
                registrar('3. estado após FINALIZAR', estadoDo(doc));
                finalizado = Number(doc.docVldFinalizado ?? 0) === 1;
            } catch (cause) {
                registrar('3. finalização FALHOU', {
                    erro: cause instanceof Error ? cause.message : String(cause),
                });
            }
        } else {
            registrar('3. finalização NÃO tentada', { valorDoc, tituloAntesFinal });
        }

        // ── PASSO 4 — o teste que importa para a leg seguinte: o título aparece no LOV que o fin014 usa?
        // Sem isto, `etapaFin014` não acha o que baixar, mesmo com o documento finalizado.
        if (finalizado) {
            const { default: ConexosFin014Client } = await import(
                '../domain/client/ConexosFin014Client.js'
            );
            const { container } = await import('tsyringe');
            const fin014 = container.resolve(ConexosFin014Client) as unknown as AnyRecord;
            const titulos = (await (
                fin014.listTitulosBorderoReceber as (p: AnyRecord) => Promise<Array<AnyRecord>>
            )({ filCod: FIL_COD, docCod })) as Array<AnyRecord>;
            registrar('4. títulos visíveis ao fin014', { titulos });
        }

        const veredito =
            tituloAposCondicao > 0 && tituloAposCondicao === Number(docAntesFinal.docMnyValor ?? -1)
                ? 'ORDEM-INVERTIDA-RESOLVE (item antes da condição)'
                : tituloAposItem > 0
                  ? 'o-item-preserva-o-titulo-mas-a-condicao-ainda-zera'
                  : 'ordem-invertida-NAO-resolve';
        relatorio.veredito = veredito;
        relatorio.medidas = { tituloNaGeracao, tituloAposItem, tituloAposCondicao, finalizado };
        registrar('VEREDITO', { veredito, medidas: relatorio.medidas as AnyRecord });
        expect(typeof relatorio.veredito).toBe('string');
    });
});

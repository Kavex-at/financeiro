import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * EXPERIMENTO DO ZERO (HML) — em QUE passo o título da SN nasce, e em qual ele morre?
 *
 * Gera uma SN NOVA no HML e mede `mnyTitValor` DEPOIS DE CADA PASSO, na mesma ordem e com as mesmas
 * chamadas que o `RecebimentoNumerarioService.etapaSn`/`completarSnAdiantamento` fazem — só que com
 * uma releitura do documento entre um passo e outro. Isso transforma "o doc 733 terminou sem título"
 * (observação de fim de linha) em "o passo X zerou o título" (causa).
 *
 * Passos medidos:
 *   0. geração (`gerDocProcesso`)          → o título já nasce aqui? (o doc 732 sugere que SIM)
 *   1. PUT com299 da condição de pagamento (`vldRwCondpgt:1`)
 *   2. linha de item (`comDocProdutos`)     → materializa `docMnyValor`
 *   3. reaplicação da condição DEPOIS do item (só se o título tiver sumido) → regenera?
 *   4. finalização — SÓ se `mnyTitValor === docMnyValor`; senão o ERP recusa e o teste registra isso
 *      como desfecho esperado, sem falhar.
 *
 * ESCRITA REAL, restrita ao HML: cria UM documento com299 novo (R$ 123,45, SKYJACK pri 186, filial 2)
 * — mesmo custo dos resíduos 731/732/733 que já existem lá. Aborta se `CONEXOS_BASE_URL` não for
 * homologação. NÃO toca em fin014, NDe ou qualquer documento pré-existente.
 *
 * Rodar explicitamente:
 *   npx jest recebimentos.e2e.hmlTituloZero --testPathIgnorePatterns "/node_modules/"
 *
 * Saída: console + `C:/tmp/exp-titulo-zero-hml.json`.
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
const RELATORIO = 'C:/tmp/exp-titulo-zero-hml.json';

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

describe('EXPERIMENTO DO ZERO (HML) — em que passo o título da SN nasce e morre', () => {
    const relatorio: AnyRecord = { valor: VALOR, priCod: PRI_COD, passos: [] as AnyRecord[] };
    let gerDoc: AnyRecord;
    let service: AnyRecord;
    let payloadBuilder: AnyRecord;
    let docCod: number | undefined;

    const registrar = (passo: string, dados: AnyRecord): void => {
        (relatorio.passos as AnyRecord[]).push({ passo, ...dados });
        // eslint-disable-next-line no-console
        console.log(`[ZERO] ${passo}: ${JSON.stringify(dados)}`);
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
        console.log(`[ZERO] relatório em ${RELATORIO} (doc criado: ${String(docCod)})`);
    });

    it('gera uma SN nova e mede o título após CADA passo', async () => {
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

        // ── PASSO 1 — condição de pagamento do próprio cliente (PUT com299 `vldRwCondpgt:1`).
        const condicoes = (await (
            gerDoc.listCondPgtoPessoa as (p: AnyRecord) => Promise<Array<AnyRecord>>
        )({ filCod: FIL_COD, pesCod: SKYJACK_PES_COD })) as Array<AnyRecord>;
        const cond = condicoes.find((c) => /^SKYJACK/.test(String(c.pgtDesNome).toUpperCase()));
        registrar('1. condição escolhida', { cond: cond ?? null, total: condicoes.length });
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
        const tituloAposCondicao = await medir('1. estado após a CONDIÇÃO de pagamento');

        // ── PASSO 2 — linha de item (é ela que materializa o `docMnyValor`).
        const contas = (await (
            gerDoc.listContasProjetoCtb as (p: AnyRecord) => Promise<Array<AnyRecord>>
        )({ filCod: FIL_COD, prjCod: 1, priCod: PRI_COD, tpdCod: 3 })) as Array<AnyRecord>;
        const conta = contas.find((c) =>
            String(c.ctpDesNome).toUpperCase().includes('ADIANTAMENTO DE CLIENTE ENCOMENDA'),
        );
        registrar('2. conta de rateio', { conta: conta ?? null, total: contas.length });
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
        const tituloAposItem = await medir('2. estado após a LINHA DE ITEM');

        // ── PASSO 3 — só se o título sumiu: reaplicar a condição AGORA (com o valor já no doc).
        let tituloAposReaplicar: number | undefined;
        if (tituloAposItem === 0) {
            const docParaReput = await lerDoc();
            await (gerDoc.atualizarDocumento as (p: AnyRecord) => Promise<unknown>)({
                tela: 'com299',
                filCod: FIL_COD,
                payload: {
                    ...docParaReput,
                    pgtCod: cond?.pgtCod,
                    pgtDesNome: cond?.pgtDesNome,
                    vldRwCondpgt: 1,
                },
            });
            tituloAposReaplicar = await medir('3. estado após REAPLICAR a condição');
        }

        // ── PASSO 4 — finalizar SÓ se os totais batem; senão o ERP recusa e isso já é o resultado.
        const docFinal = await lerDoc();
        const valorDoc = Number(docFinal.docMnyValor ?? 0);
        const tituloFinal = Number(docFinal.mnyTitValor ?? 0);
        if (tituloFinal > 0 && tituloFinal === valorDoc) {
            try {
                await (gerDoc.finalizarDocumento as (p: AnyRecord) => Promise<unknown>)({
                    tela: 'com299',
                    filCod: FIL_COD,
                    docCod,
                });
                await medir('4. estado após FINALIZAR');
            } catch (cause) {
                registrar('4. finalização FALHOU', {
                    erro: cause instanceof Error ? cause.message : String(cause),
                });
            }
        } else {
            registrar('4. finalização NÃO tentada', { valorDoc, tituloFinal });
        }

        // Veredito: qual passo destrói o título — é isso que decide a correção no produto.
        const veredito =
            tituloNaGeracao === 0
                ? 'o-titulo-nunca-nasce (gap real: geração é passo separado)'
                : tituloAposCondicao === 0
                  ? 'a-CONDICAO-de-pagamento-zera-o-titulo'
                  : tituloAposItem === 0
                    ? 'a-LINHA-DE-ITEM-zera-o-titulo'
                    : 'o-titulo-sobrevive-a-cadeia-inteira';
        relatorio.veredito = veredito;
        relatorio.medidas = {
            tituloNaGeracao,
            tituloAposCondicao,
            tituloAposItem,
            ...(tituloAposReaplicar !== undefined ? { tituloAposReaplicar } : {}),
        };
        registrar('VEREDITO', { veredito, medidas: relatorio.medidas as AnyRecord });
        expect(typeof relatorio.veredito).toBe('string');
    });
});

import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * DISCRIMINADOR — o defeito `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` do `fin014` é do AMBIENTE
 * inteiro ou só dos dados da FILIAL 2?
 *
 * Contexto: `docs/e2e/fin014-finalizacao-hml-diagnostico.md`. No HML de hoje, na filial 2, TODO borderô
 * a-receber que carrega uma baixa falha em `POST fin014/validacoes/{borCod}` e em
 * `POST fin014/finalizar/{borCod}` — inclusive um montado inteiramente pela UI do Conexos com um título
 * de terceiro anterior ao projeto. Borderôs VAZIOS não falham. A assinatura é de identificador de
 * registro de validação colidindo no banco.
 *
 * A pergunta que sobra, e que este teste responde: **isso acontece também na filial 1?**
 *
 *   - Se na filial 1 a validação PASSAR → o defeito é de dados por filial. A leg `fin014 → NDe` pode ser
 *     exercitada em homologação lá, e o E2E que falta deixa de depender de um chamado com a Conexos.
 *   - Se FALHAR igual → o defeito é do ambiente todo, e o chamado (§9.1 do diagnóstico) vira o único
 *     caminho. O resultado negativo também é útil: fecha a hipótese com uma medição, não com suposição.
 *
 * ⚠️ ESTE TESTE ESCREVE NO HML. É o mínimo necessário para discriminar, e é REVERSÍVEL:
 *   1. cria UM borderô a-receber na filial 1;
 *   2. grava UMA baixa sobre um título já aberto e de TERCEIRO (não cria documento nenhum);
 *   3. chama `validacoes` — o discriminador;
 *   4. **desfaz tudo** no `afterAll` (exclui a baixa, exclui o borderô) e confirma a exclusão.
 *
 * NUNCA chama `finalizar`. Finalizar escreveria lote e lançamentos contábeis sobre o título de um
 * terceiro — irreversível pela API. O discriminador não precisa disso: a `validacoes` já falha sozinha.
 *
 * Guard-rails: aborta se `CONEXOS_BASE_URL` não contiver `-hml`; aborta antes de qualquer escrita se as
 * pré-condições de leitura não forem satisfeitas; escolhe o título de MENOR valor em aberto.
 *
 * Fora da suíte padrão (`*.integration.test.ts`). Rodar explicitamente:
 *   npx jest recebimentos.e2e.hmlFilial1Bordero --testPathIgnorePatterns "/node_modules/"
 *
 * Saída: veredito no console (`[DISCRIMINADOR]`) + dump em `C:/tmp/probe-filial1-fin014.json`.
 */

jest.setTimeout(600_000);

jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

/** A filial sob teste — a hipótese é que o defeito não a alcança. */
const FIL_ALVO = 1;
/** A filial onde o defeito está provado — braço de CONTROLE da mesma rodada. */
const FIL_CONTROLE = 2;
/** Borderô nosso, na filial 2, já medido falhando. Serve para provar que o ambiente não mudou. */
const BOR_CONTROLE = 135;
/** Títulos a receber (`fin014` = a receber; o `fin010`, a pagar, usa 2). */
const BOR_VLD_TIPO = 1;
const DOC_TIP = 1;
const RELATORIO = 'C:/tmp/probe-filial1-fin014.json';
/** A assinatura do defeito — o que estamos tentando reproduzir (ou não) na filial 1. */
const DEFEITO = 'CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE';

type AnyRecord = Record<string, unknown>;

interface TituloAberto {
    docCod: number;
    titCod: number;
    titEspNumero: string;
    titMnyAberto: number;
    dpeNomPessoa?: string;
}

const buildFakeDb = (): AnyRecord => ({
    init: async () => undefined,
    withAdvisoryLock: async (_k: number, onAcquired: () => Promise<unknown>): Promise<unknown> =>
        onAcquired(),
    selectMany: async () => {
        throw new Error('discriminador: SQL indisponível');
    },
    selectFirst: async () => {
        throw new Error('discriminador: SQL indisponível');
    },
    insert: async () => {
        throw new Error('discriminador: SQL indisponível');
    },
    update: async () => {
        throw new Error('discriminador: SQL indisponível');
    },
    withTransaction: async () => {
        throw new Error('discriminador: SQL indisponível');
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

/** A mensagem crua do ERP, venha ela do envelope `{messages}` ou do corpo de um 400. */
const mensagemDoErp = (algo: unknown): string => {
    const alvo = algo as {
        response?: { data?: unknown };
        cause?: { response?: { data?: unknown } };
        messages?: Array<{ message?: string }>;
    };
    const data = (alvo?.response?.data ?? alvo?.cause?.response?.data ?? algo) as
        | { messages?: Array<{ message?: string }> }
        | undefined;
    const msgs = data?.messages ?? alvo?.messages;
    if (Array.isArray(msgs) && msgs.length > 0) {
        return msgs.map((m) => m?.message ?? '?').join(' | ');
    }
    if (algo instanceof Error) return algo.message;
    return JSON.stringify(algo ?? null);
};

describe('DISCRIMINADOR — o defeito do fin014 alcança a filial 1?', () => {
    const relatorio: AnyRecord = { ambiente: null, leituras: {} as AnyRecord, veredito: null };
    let base: {
        ensureSid: () => Promise<void>;
        getGeneric: <T>(p: string, o?: { filCod?: number }) => Promise<T>;
        postGeneric: <T>(p: string, b: unknown, o?: { filCod?: number }) => Promise<T>;
        deleteGeneric: <T>(p: string, o?: { filCod?: number }) => Promise<T>;
    };
    /** Recursos criados nesta rodada — o `afterAll` os desfaz mesmo se um teste quebrar no meio. */
    const criado: { borCod?: number; baixa?: TituloAberto & { bxaCodSeq: number } } = {};
    let titulo: TituloAberto | undefined;
    let gerNum: number | undefined;

    const registrar = (nome: string, valor: unknown): void => {
        (relatorio.leituras as AnyRecord)[nome] = valor;
    };

    /**
     * A MEDIÇÃO que discrimina, isolada porque os dois braços (alvo e controle) precisam dela idêntica.
     * Devolve `reproduziu: true` só quando o ERP responde com a assinatura exata do defeito.
     */
    const medirValidacao = async (
        borCod: number,
        filCod: number,
    ): Promise<{ reproduziu: boolean; detalhe: string }> => {
        try {
            const r = await base.postGeneric<AnyRecord>(
                `fin014/validacoes/${borCod}`,
                {},
                { filCod },
            );
            return { reproduziu: false, detalhe: `PASSOU: ${JSON.stringify(r).slice(0, 600)}` };
        } catch (cause) {
            const msg = mensagemDoErp(cause);
            return { reproduziu: msg.includes(DEFEITO), detalhe: `FALHOU: ${msg}` };
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
        process.env.CONEXOS_FIL_COD = String(FIL_ALVO);
        process.env.environment = 'local';
        delete process.env.client_name;
        delete process.env.databaseConnectionString;
        relatorio.ambiente = { baseUrl: url, filAlvo: FIL_ALVO, filControle: FIL_CONTROLE };

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

    afterAll(async () => {
        // LIMPEZA — ordem obrigatória: a baixa primeiro (o ERP recusa excluir borderô com filho:
        // `CHILDRECORDFOUND`), o borderô depois. Nunca lança: a limpeza não pode mascarar o veredito.
        const limpeza: AnyRecord = {};
        const b = criado.baixa;
        if (b !== undefined && criado.borCod !== undefined) {
            const rota = `fin014/baixas/${criado.borCod}/${DOC_TIP}/${b.docCod}/${b.titCod}/${b.bxaCodSeq}`;
            try {
                await base.deleteGeneric(rota, { filCod: FIL_ALVO });
                limpeza.baixa = 'excluída';
            } catch (cause) {
                limpeza.baixa = `FALHOU: ${mensagemDoErp(cause)}`;
            }
        }
        if (criado.borCod !== undefined) {
            try {
                await base.deleteGeneric(`fin014/${criado.borCod}`, { filCod: FIL_ALVO });
                limpeza.bordero = 'excluído';
            } catch (cause) {
                limpeza.bordero = `FALHOU: ${mensagemDoErp(cause)}`;
            }
            // Confirmação: o borderô tem mesmo que sumir (`RECORDNOTFOUND` é o sucesso aqui).
            try {
                const ainda = await base.getGeneric<AnyRecord>(
                    `fin014/${FIL_ALVO}/${criado.borCod}`,
                    { filCod: FIL_ALVO },
                );
                limpeza.conferencia = `AINDA EXISTE: ${JSON.stringify(ainda)}`;
            } catch (cause) {
                limpeza.conferencia = `sumiu (${mensagemDoErp(cause)})`;
            }
        }
        relatorio.limpeza = limpeza;
        writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2), 'utf8');
        // eslint-disable-next-line no-console
        console.log(`[DISCRIMINADOR] limpeza: ${JSON.stringify(limpeza)}`);
        // eslint-disable-next-line no-console
        console.log(`[DISCRIMINADOR] relatório completo em ${RELATORIO}`);
    });

    it('1. pré-condições de LEITURA na filial 1: existe conta financeira e título aberto?', async () => {
        // Conta financeira (`gerNum`) — o borderô a exige. `fin005` = FinCcorrentes (mapa da §5 do
        // diagnóstico). Sem uma conta na filial 1 o experimento não sai do papel.
        const contas = await base.postGeneric<AnyRecord>(
            'fin005/list',
            {
                fieldList: [],
                filterList: {},
                pageNumber: 1,
                pageSize: 50,
                orderList: { orderList: [{ propertyName: 'gerNum', order: 'asc' }] },
            },
            { filCod: FIL_ALVO },
        );
        const linhasConta = (contas?.rows ?? []) as AnyRecord[];
        registrar('fin005/list(filial 1)', linhasConta);
        gerNum = linhasConta.map((c) => Number(c.gerNum)).find((n) => Number.isInteger(n) && n > 0);
        // eslint-disable-next-line no-console
        console.log(
            `[DISCRIMINADOR] contas financeiras na filial ${FIL_ALVO}: ${linhasConta.length}; ` +
                `gerNum escolhido=${String(gerNum)}`,
        );

        // Título a receber JÁ ABERTO — de terceiro, preexistente. Não criamos documento nenhum.
        const lov = await base.postGeneric<AnyRecord>(
            'lov/TituloBorderoReceber',
            {
                fieldList: [
                    'docTip',
                    'docCod',
                    'titCod',
                    'titEspNumero',
                    'dpeNomPessoa',
                    'titMnyAberto',
                ],
                filterList: { borVldFinalizado: 0, exibirTitulos: 1 },
                pageNumber: 1,
                orderBy: 'asc',
                sortBy: 'titCod',
            },
            { filCod: FIL_ALVO },
        );
        const abertos = ((lov?.rows ?? []) as AnyRecord[])
            .map((r) => ({
                docCod: Number(r.docCod),
                titCod: Number(r.titCod),
                titEspNumero: String(r.titEspNumero),
                titMnyAberto: Number(r.titMnyAberto ?? 0),
                ...(r.dpeNomPessoa != null ? { dpeNomPessoa: String(r.dpeNomPessoa) } : {}),
            }))
            .filter((t) => t.titMnyAberto > 0);
        registrar('lov/TituloBorderoReceber(filial 1)', abertos);
        // O de MENOR valor em aberto: se algo escapar da limpeza, que seja o menor estrago possível.
        titulo = [...abertos].sort((a, b) => a.titMnyAberto - b.titMnyAberto)[0];
        // eslint-disable-next-line no-console
        console.log(
            `[DISCRIMINADOR] títulos abertos na filial ${FIL_ALVO}: ${abertos.length}; ` +
                `escolhido=${JSON.stringify(titulo ?? null)}`,
        );
        expect(Array.isArray(abertos)).toBe(true);
    });

    it('2. CONTROLE — o defeito continua vivo na filial 2 (borderô 135)?', async () => {
        // Sem este braço, um eventual sucesso na filial 1 seria ambíguo: poderia significar que a
        // Conexos consertou o ambiente no intervalo. O controle roda na MESMA sessão.
        const { reproduziu, detalhe } = await medirValidacao(BOR_CONTROLE, FIL_CONTROLE);
        const veredito = reproduziu
            ? `defeito ainda presente na filial ${FIL_CONTROLE} (como esperado) — ${detalhe}`
            : `ATENÇÃO, o controle mudou de comportamento — ${detalhe}`;
        relatorio.controle = veredito;
        registrar(`controle/validacoes(${BOR_CONTROLE}, filial ${FIL_CONTROLE})`, veredito);
        // eslint-disable-next-line no-console
        console.log(`[DISCRIMINADOR] CONTROLE: ${veredito}`);
        expect(typeof veredito).toBe('string');
    });

    it('3. o experimento: borderô + baixa na filial 1 e a validação que discrimina', async () => {
        if (titulo === undefined || gerNum === undefined) {
            relatorio.veredito =
                'INCONCLUSIVO — filial 1 sem título aberto e/ou sem conta financeira';
            // eslint-disable-next-line no-console
            console.log(`[DISCRIMINADOR] ${String(relatorio.veredito)}`);
            return;
        }

        // Passo 1 — borderô. Mesmo payload de `ConexosFin014Client.criarBordero`.
        const hoje = new Date();
        const dataMovto = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
        const bordero = await base.postGeneric<AnyRecord>(
            'fin014',
            {
                filCod: FIL_ALVO,
                borVldTipo: BOR_VLD_TIPO,
                borDtaMvto: dataMovto,
                borVldFinalizado: 0,
                frontModelName: 'bordero',
                gerNum,
            },
            { filCod: FIL_ALVO },
        );
        criado.borCod = Number(bordero?.borCod);
        registrar('fin014(criar, filial 1)', bordero);
        // eslint-disable-next-line no-console
        console.log(
            `[DISCRIMINADOR] borderô criado na filial ${FIL_ALVO}: ${String(criado.borCod)}`,
        );
        expect(criado.borCod).toBeGreaterThan(0);

        // Passo 2 — o em-aberto vivo, direto do ERP (a mesma chamada que o serviço faz).
        const val = await base.postGeneric<AnyRecord>(
            'fin014/baixas/validacao/tituloBaixa',
            {
                filCod: FIL_ALVO,
                borCod: criado.borCod,
                borVldTipo: BOR_VLD_TIPO,
                docTip: DOC_TIP,
                docCod: titulo.docCod,
                titCod: titulo.titCod,
                titEspNumero: titulo.titEspNumero,
                borVldFinalizado: 0,
            },
            { filCod: FIL_ALVO },
        );
        registrar('fin014/baixas/validacao/tituloBaixa(filial 1)', val);
        const dados = (val?.responseData ?? {}) as AnyRecord;
        const bxaMnyValor = Number(dados.bxaMnyValor ?? titulo.titMnyAberto);
        // A UI grava com `bxaVldCcorrente: 1` (§6 do diagnóstico); a validação manda o valor de verdade.
        const bxaVldCcorrente = Number(dados.bxaVldCcorrente ?? 1);

        // Passo 3 — a baixa. É a escrita que faz o borderô "carregar baixa", condição do defeito.
        const baixa = await base.postGeneric<AnyRecord>(
            'fin014/baixas',
            {
                filCod: FIL_ALVO,
                borCod: criado.borCod,
                borVldTipo: BOR_VLD_TIPO,
                borVldFinalizado: 0,
                bxaVldSistema: 0,
                bxaVldAdto: 0,
                bxaVldCcorrente,
                bxaVldCorrenteDc: 1,
                docTip: DOC_TIP,
                docCod: titulo.docCod,
                titCod: titulo.titCod,
                titEspNumero: titulo.titEspNumero,
                gerNum,
                ...(bordero?.gerDes != null ? { gerDes: bordero.gerDes } : {}),
                bxaMnyValor,
                bxaMnyJuros: 0,
                bxaMnyMulta: 0,
                bxaMnyDesconto: 0,
                bxaMnyLiquido: bxaMnyValor,
            },
            { filCod: FIL_ALVO },
        );
        registrar('fin014/baixas(filial 1)', baixa);
        const bxaCodSeq = Number(baixa?.bxaCodSeq);
        if (Number.isInteger(bxaCodSeq) && bxaCodSeq > 0) {
            criado.baixa = { ...titulo, bxaCodSeq };
        }
        // eslint-disable-next-line no-console
        console.log(
            `[DISCRIMINADOR] baixa gravada na filial ${FIL_ALVO}: bxaCodSeq=${String(bxaCodSeq)} ` +
                `valor=${bxaMnyValor}`,
        );

        // Passo 4 — O DISCRIMINADOR. Na filial 2 esta chamada devolve 400 CODIGO_IDENTIFICADOR_
        // REGISTRO_EXISTENTE em qualquer borderô com baixa. NÃO finalizamos: o veredito está aqui.
        const { reproduziu, detalhe } = await medirValidacao(criado.borCod, FIL_ALVO);
        const veredito = reproduziu
            ? `o defeito é do AMBIENTE inteiro — só o chamado com a Conexos resolve. ${detalhe}`
            : `o defeito NÃO alcança a filial ${FIL_ALVO} — a leg fin014→NDe pode ser exercitada aqui. ${detalhe}`;
        relatorio.veredito = veredito;
        registrar('fin014/validacoes(filial 1)', veredito);
        // eslint-disable-next-line no-console
        console.log(`[DISCRIMINADOR] VEREDITO: ${veredito}`);
        expect(typeof veredito).toBe('string');
    });
});

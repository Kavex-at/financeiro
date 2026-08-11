import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ConexosError from '../errors/ConexosError.js';
import { LOG_TYPE } from '../interface/log/LogInterface.js';
import type {
    ContaProjetoRow,
    GerDocProcessoPayload,
    GerDocProcessoValidaWrapper,
    ValidaConfigDocPessoaResult,
    ValidaConfigDocResult,
} from '../interface/permutas/SolicitacaoNumerario.js';
import {
    SOLICITACAO_NUMERARIO_DOC_VLD_TIPO,
    SOLICITACAO_NUMERARIO_DOC_VLD_TIPO_ADTO,
} from '../interface/recebimentos/constants.js';
import {
    SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA,
    type SolicitacaoNumerarioListItem,
    type SolicitacaoNumerarioRow,
    solicitacaoNumerarioStatusLabel,
} from '../interface/recebimentos/SolicitacaoNumerarioListItem.js';
import LogService from '../service/LogService.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/** Tela da família "Geração de Documentos" (com068): com299 = SN, com297 = nota de débito. */
export type GerDocTela = 'com299' | 'com297';

/**
 * Zod no boundary de `validaConfigDoc` — config do documento derivada do gcd/pessoa.
 * Lenient (coerce + optional): nenhum campo bloqueia, mas o shape é normalizado.
 */
const VALIDA_CONFIG_DOC_SCHEMA = z.object({
    responseData: z
        .object({
            tpcCod: z.coerce.number().int().optional(),
            tpcDesNome: z
                .string()
                .nullish()
                .transform((v) => v ?? undefined),
            // null → undefined: o ERP devolve `cfoEspCod: null` p/ variantes de SN (ex. gcd 151 TERCEIROS) — o
            // `.optional()` LANÇAVA no null (ZodError, live 2026-08-03, proc 3478). O payload da SN força
            // `cfoEspCod: null` mesmo, então normalizar aqui é seguro.
            cfoEspCod: z
                .string()
                .nullish()
                .transform((v) => v ?? undefined),
            gcdVldFormaRateio: z.coerce.number().int().optional(),
            gcdVldTela: z.coerce.number().int().optional(),
            gcdVldPropria: z.coerce.number().int().optional(),
            fisEspSerie: z.string().nullish(),
        })
        .partial()
        .optional(),
});

/**
 * Envelope de `messages` do `validaConfigDoc` — o SINAL de elegibilidade do (gcd × tela) para o processo
 * (probe 2026-08-02: gcd 107 → `valid:ERRO COM_068.CFOP_INCOMPATIVEL_OU_ERROS`; 188 → `AVISO`; 150 → sem
 * mensagem). `valid:'ERRO'` = config incompatível com o processo (inelegível PARA ESSE gcd); `AVISO` não
 * bloqueia. `VALIDA_CONFIG_DOC_SCHEMA` DROPA `messages`, por isso este schema dedicado.
 */
const CONFIG_DOC_MESSAGES_SCHEMA = z.object({
    messages: z.array(z.object({ valid: z.string(), message: z.string() }).passthrough()).nullish(),
    responseData: z
        .object({ gcdVldTela: z.coerce.number().int().optional() })
        .passthrough()
        .nullish(),
});

/**
 * LOV `ConfigDocProcesso` — as configurações de documento (`gcd`) que o ERP considera VÁLIDAS para o
 * processo/pessoa (o que popula o dropdown de config na tela). É a fonte AUTORITATIVA da elegibilidade:
 * se a "SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA" (gcd 150) NÃO está aqui, a geração falha `gcdDesNomeProc
 * NOT_VALID` (probe 2026-08-02: presente p/ L-FOUNDERS 3254, AUSENTE p/ BUNTECH 459/3478).
 */
const CONFIG_DOC_PROCESSO_SCHEMA = z.object({
    rows: z
        .array(z.object({ gcdCod: z.coerce.number().int(), gcdDesNome: z.string() }).passthrough())
        .default([]),
});

/**
 * LOV `CondPgtoPessoa` — condições de pagamento (fonte do `pgtCod` do cadastro). `count` é o total do
 * envelope, usado para saber quando a paginação esgotou (ver `listCondPgtoPessoa`).
 */
const LOV_COND_PGTO_SCHEMA = z.object({
    count: z.coerce
        .number()
        .int()
        .nullish()
        .transform((v) => v ?? undefined),
    rows: z
        .array(z.object({ pgtCod: z.coerce.number().int(), pgtDesNome: z.string() }).passthrough())
        .default([]),
});

/**
 * `pageSize` PEDIDO ao `lov/CondPgtoPessoa` — o ERP **IGNORA** este valor (HML 2026-08-03: pedimos 500,
 * ele devolveu 50 linhas com `count: 86`). Mandamos assim mesmo (custa nada e outros LOVs honram), mas
 * NENHUM critério de parada pode depender dele — ver `listCondPgtoPessoa`.
 */
const COND_PGTO_PAGE_SIZE = 500;

/** Teto de páginas do LOV de condições — evita loop infinito se o ERP não honrar `count`/`pageNumber`. */
const COND_PGTO_MAX_PAGES = 20;

/**
 * Discriminador de sucesso da FINALIZAÇÃO (`finalizarDocumento`): `docVldFinalizado === 1` na releitura
 * do documento. HTTP 200 não serve — HML 2026-08-03, SN nº 731: os dois POSTs voltaram 200 e o doc
 * ficou `docVldFinalizado: 0` (sem título, `mnyTitValor: 0`).
 */
const DOC_FINALIZADO_SCHEMA = z
    .object({
        docVldFinalizado: z.coerce
            .number()
            .int()
            .nullish()
            .transform((v) => v ?? undefined),
    })
    .passthrough();

/** Valor de `docVldFinalizado` que o ERP grava quando o documento REALMENTE finalizou. */
const DOC_FINALIZADO_OK = 1;

/** LOV `ContasProjetoCtb` — contas de projeto (rateio); a SN Encomenda usa a "ADIANTAMENTO DE CLIENTE ENCOMENDA". */
const LOV_CONTAS_PROJETO_SCHEMA = z.object({
    rows: z
        .array(
            z
                .object({
                    ctpCod: z.coerce.number().int(),
                    ctpDesNome: z.string(),
                    ctpEspConta: z.string().nullish(),
                })
                .passthrough(),
        )
        .default([]),
});

/**
 * Zod no boundary de `validaProcessoPessoa` — endereço/documento da pessoa do processo, a FONTE de
 * `endCodFis` + `pdcDocFederal` que o `gerDocProcesso` da SN exige (HAR doc 18339). Passthrough do resto
 * do endereço; só os três campos load-bearing (`pesCod`/`endCodFis`/`pdcDocFederal`) são tipados.
 */
const VALIDA_PROCESSO_PESSOA_SCHEMA = z.object({
    responseData: z
        .object({
            pesCod: z.coerce.number().int().optional(),
            endCodFis: z.coerce.number().int().optional(),
            pdcDocFederal: z.string().optional(),
        })
        .passthrough()
        .optional(),
});

export interface ValidaProcessoPessoaResult {
    pesCod?: number;
    endCodFis?: number;
    pdcDocFederal?: string;
    [key: string]: unknown;
}

/**
 * Zod no boundary de `com191/endereco/list/{pesCod}` — os ENDEREÇOS cadastrados da pessoa, cada um com
 * seu `endCod` e o `pdcDocFederal` (CNPJ) do estabelecimento correspondente. Esta é a ÚNICA fonte que
 * amarra endereço ↔ CNPJ; o `validaProcessoPessoa` NÃO amarra (ver `EnderecoPessoa`).
 *
 * `endVldDefault` é o desempate documentado do ERP ("endereço padrão da pessoa") — só usado quando dois
 * endereços dividem o MESMO CNPJ.
 */
const ENDERECO_PESSOA_ROW_SCHEMA = z
    .object({
        endCod: z.coerce.number().int(),
        pdcDocFederal: z
            .string()
            .nullish()
            .transform((v) => v ?? undefined),
        endVldDefault: z.coerce
            .number()
            .int()
            .nullish()
            .transform((v) => v ?? undefined),
        endereco: z
            .string()
            .nullish()
            .transform((v) => v ?? undefined),
    })
    .passthrough();

const ENDERECO_PESSOA_LIST_SCHEMA = z.union([
    z.array(ENDERECO_PESSOA_ROW_SCHEMA),
    z.object({ rows: z.array(ENDERECO_PESSOA_ROW_SCHEMA).default([]) }),
]);

/** Página do `com191/endereco/list` — uma pessoa não tem centenas de endereços; 200 cobre com folga. */
const ENDERECO_PESSOA_PAGE_SIZE = 200;

/** Um endereço cadastrado da pessoa — o par (`endCod`, `pdcDocFederal`) é o que o documento exige coerente. */
export interface EnderecoPessoa {
    endCod: number;
    /** CNPJ/CPF DO ESTABELECIMENTO deste endereço. É por ele que o endereço do documento é escolhido. */
    pdcDocFederal?: string;
    /** `1` = endereço padrão da pessoa. Desempate APENAS entre endereços de mesmo CNPJ. */
    endVldDefault?: number;
    /** Endereço formatado pelo ERP — só para log/motivo legível. */
    endereco?: string;
    [key: string]: unknown;
}

/**
 * Zod no boundary de `validaConfigDocPessoa` — a Configuração de Documento (`gcd`) que o ERP resolve
 * PARA ESTE processo/pessoa. `.passthrough()`: só `gcdCod`/`gcdDesNome` são tipados; o resto do
 * `responseData` passa livre. Lenient (`coerce`/`optional`) — a ausência de `gcdCod` NÃO é erro aqui, e sim
 * o sinal de "processo sem config SN válida" que o pré-flight do serviço classifica (BLOCKED_ELEGIBILIDADE).
 */
const VALIDA_CONFIG_DOC_PESSOA_SCHEMA = z.object({
    responseData: z
        .object({
            // O ERP devolve `{gcdCod: null, gcdDesNome: null}` para um processo SEM config SN válida —
            // essa é a resposta de domínio "inelegível", NÃO um erro. `.nullish()` aceita null/undefined e o
            // `.transform` normaliza null → undefined para o service ler `gcdCod === undefined`
            // (BLOCKED_ELEGIBILIDADE). Sem isto: `z.string()` LANÇA no null (vira UNKNOWN, mascarando a
            // inelegibilidade) e `z.coerce.number()` coagiria null → 0 (um gcd falso que passaria como READY).
            gcdCod: z.coerce
                .number()
                .int()
                .nullish()
                .transform((v) => v ?? undefined),
            gcdDesNome: z
                .string()
                .min(1)
                .nullish()
                .transform((v) => v ?? undefined),
        })
        .passthrough()
        .optional(),
});

/** Uma linha do rateio servido pelo ERP (`contasProj/list`). */
const CONTA_PROJETO_ROW_SCHEMA = z.object({
    prjCod: z.coerce.number().int(),
    ctpCod: z.coerce.number().int(),
    ctpDesNome: z.string().optional(),
    tpcCod: z.coerce.number().int(),
    tpcDesNome: z.string().optional(),
    cfoEspCod: z.string(),
    total: z.coerce.number(),
    tmpMnyValor: z.coerce.number().nullish(),
});

/** Envelope `{ messages }` das rotas gerDocProcesso — `valid==='ERRO'` chega com HTTP 200. */
const MESSAGES_ENVELOPE_SCHEMA = z.object({
    data: z
        .object({
            messages: z
                .array(
                    z.object({
                        valid: z.string().optional(),
                        message: z.string().optional(),
                        vars: z.record(z.unknown()).optional(),
                    }),
                )
                .optional(),
        })
        .optional(),
    messages: z
        .array(
            z.object({
                valid: z.string().optional(),
                message: z.string().optional(),
                vars: z.record(z.unknown()).optional(),
            }),
        )
        .optional(),
});

/**
 * Envelope `{type:"QUESTION", questions:[...]}` que o `gerDocProcesso/valida` devolve com HTTP **400**
 * (soft-confirm; NÃO é erro). Cada pergunta traz um `answerList` de opções — cada uma com `id/key` e um
 * `type` (`SIMPLE` = continuar, `ABORT` = cancelar). Zod lenient: só o shape necessário para classificar.
 */
const QUESTION_ENVELOPE_SCHEMA = z.object({
    type: z.literal('QUESTION'),
    questions: z
        .array(
            z.object({
                id: z.string().optional(),
                key: z.string().optional(),
                answerList: z
                    .array(
                        z.object({
                            id: z.string().optional(),
                            key: z.string().optional(),
                            type: z.string().optional(),
                        }),
                    )
                    .optional(),
            }),
        )
        .default([]),
});

type QuestionEnvelope = z.infer<typeof QUESTION_ENVELOPE_SCHEMA>;
type QuestionEntry = QuestionEnvelope['questions'][number];

/** Id da única pergunta benigna que auto-respondemos com YES (soft-confirm "doc sem valor — continuar?"). */
const BENIGN_CONTINUE_QUESTION_ID = 'NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR';

export interface GerDocProcessoMessage {
    valid?: string;
    message?: string;
    vars?: Record<string, unknown>;
}

/**
 * Conexos ERP família "Geração de Documentos" (tela `com068`; parent `com299` SN / `com297` nota de
 * débito). Espelha a doutrina do `ConexosBaixaClient` (fin010): Zod no boundary, `ConexosError` no
 * catch, `ensureSid` antes de cada chamada. A geração (`gerarDocProcesso`) e a finalização são
 * ESCRITAS IRREVERSÍVEIS → `postGenericOnce` (tentativa única, sem 401-retry), como `gravarBaixaPermuta`.
 *
 * `tela` parametriza a família (rotas `${tela}/...`) — com299/gerDocProcesso confirmado por captura;
 * com297 assumido no MESMO form com068 (parent com297). GAP: os detalhes com297-específicos
 * (fiscal/observações/homologar) vivem no serviço orquestrador, não aqui.
 */
@singleton()
@injectable()
export default class ConexosGerDocProcessoClient {
    private base: ConexosBaseClient;
    private logService: LogService;

    constructor(
        @inject(ConexosBaseClient) base: ConexosBaseClient,
        @inject(LogService) logService: LogService,
    ) {
        this.base = base;
        this.logService = logService;
    }

    /**
     * `POST {tela}/gerDoc/validaProcessoPessoa` — resolve o endereço/documento da pessoa DO PROCESSO,
     * a FONTE de `endCodFis` + `pdcDocFederal` (HAR doc 18339: chamada logo após escolher o processo,
     * ANTES de `validaConfigDoc`/`gerDocProcesso`). Leitura/validação idempotente → `runWithRetry`.
     * QUESTION-tolerante como `validarGeracao` (best-effort; o HAR devolveu 200) — um 400-QUESTION não é
     * erro; qualquer outra falha re-lança como `ConexosError`. Zod no boundary; passthrough do endereço.
     */
    public validaProcessoPessoa = async (params: {
        tela?: GerDocTela;
        filCod: number;
        docTip: number;
        globalDocVldTipo: number;
        priCod: number;
        priEspRefcliente?: string;
    }): Promise<ValidaProcessoPessoaResult> => {
        const { filCod } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/gerDoc/validaProcessoPessoa`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                try {
                    const raw = await this.base.postGeneric<unknown>(
                        path,
                        {
                            docTip: params.docTip,
                            frontModelName: 'gerDocProcesso',
                            globalDocVldTipo: params.globalDocVldTipo,
                            priCod: params.priCod,
                            ...(params.priEspRefcliente !== undefined
                                ? { priEspRefcliente: params.priEspRefcliente }
                                : {}),
                        },
                        { filCod },
                    );
                    const parsed = VALIDA_PROCESSO_PESSOA_SCHEMA.parse(raw);
                    return { ...(parsed.responseData ?? {}) };
                } catch (httpErr) {
                    // Um 400 com corpo QUESTION é soft-confirm, não erro (paridade com validarGeracao).
                    const question = this.extractQuestionEnvelope(httpErr);
                    if (question) return {};
                    throw httpErr;
                }
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * `POST com191/endereco/list/{pesCod}` — os ENDEREÇOS cadastrados da pessoa, cada um com `endCod` e o
     * `pdcDocFederal` do seu estabelecimento.
     *
     * Existe porque o `validaProcessoPessoa` **não** responde "qual endereço este documento usa": ele
     * devolve o `pdcDocFederal` DO PROCESSO junto de um `endCodFis` que é o endereço PADRÃO da pessoa —
     * um par incoerente quando a pessoa tem mais de um estabelecimento. Medido em produção 2026-08-11
     * (pesCod 699, filial 2): `endCodFis: 1` + `pdcDocFederal: 10384567000405`, sendo que o endereço 1 é
     * o CNPJ `/0001-62` e o `/0004-05` é o endereço **2**. As 140 NDes já emitidas para essa pessoa usam
     * `endCod: 2`. Ver `resolverEndCodDaPessoa` no `RecebimentoNumerarioService`.
     *
     * Leitura idempotente → `runWithRetry`. Zod no boundary; aceita array cru ou envelope `{rows}`.
     */
    public listEnderecosPessoa = async (params: {
        filCod: number;
        pesCod: number;
    }): Promise<EnderecoPessoa[]> => {
        const { filCod, pesCod } = params;
        const path = `com191/endereco/list/${pesCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<unknown>(
                    path,
                    { pageNumber: 1, pageSize: ENDERECO_PESSOA_PAGE_SIZE },
                    { filCod },
                );
                const parsed = ENDERECO_PESSOA_LIST_SCHEMA.parse(raw);
                return Array.isArray(parsed) ? parsed : parsed.rows;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * `POST {tela}/gerDoc/validaConfigDocPessoa` (tela='com299' → `/api/com299/gerDoc/validaConfigDocPessoa`) — resolve a
     * Configuração de Documento (`gcd`) que o ERP considera válida PARA ESTE processo/pessoa. A
     * "SOLICITAÇÃO DE NUMERÁRIO - ENCOMENDA" mapeia para MÚLTIPLOS gcds no histórico (188/150/107); qual
     * vale é POR PROCESSO — hardcodar 150 falha `gcdDesNomeProc NOT_VALID` para processos que resolvem
     * outra config. Devolve `{gcdCod?, gcdDesNome?, ...}` do `responseData` (gcdDesNome = o valor validado
     * como `gcdDesNomeProc`). Leitura idempotente → `runWithRetry`. QUESTION-tolerante como
     * `validaProcessoPessoa` (um 400-QUESTION é soft-confirm, não erro → devolve vazio best-effort); qualquer
     * outra falha re-lança como `ConexosError`. Zod no boundary com `.passthrough()`.
     */
    public validaConfigDocPessoa = async (params: {
        tela?: GerDocTela;
        filCod: number;
        pesCod: number;
        globalDocVldTipo: number;
        docTip: number;
        priCod: number;
    }): Promise<ValidaConfigDocPessoaResult> => {
        const { filCod } = params;
        const tela = params.tela ?? 'com299';
        // Mesmo prefixo `gerDoc/` de validaProcessoPessoa — `{tela}/validaConfigDocPessoa` sem ele
        // devolve 405 (POST não suportado nessa URL). HAR/probe 2026-08-02: `com299/gerDoc/...` é a rota.
        const path = `${tela}/gerDoc/validaConfigDocPessoa`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                try {
                    const raw = await this.base.postGeneric<unknown>(
                        path,
                        {
                            filCod: params.filCod,
                            pesCod: params.pesCod,
                            globalDocVldTipo: params.globalDocVldTipo,
                            docTip: params.docTip,
                            priCod: params.priCod,
                        },
                        { filCod },
                    );
                    const parsed = VALIDA_CONFIG_DOC_PESSOA_SCHEMA.parse(raw);
                    return { ...(parsed.responseData ?? {}) };
                } catch (httpErr) {
                    // Um 400 com corpo QUESTION é soft-confirm, não erro (paridade com validaProcessoPessoa).
                    const question = this.extractQuestionEnvelope(httpErr);
                    if (question) return {};
                    throw httpErr;
                }
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * `POST {tela}/gerDoc/validaConfigDoc` — resolve tpc/cfo/formaRateio/serie a partir do gcd.
     * Leitura (idempotente) → `runWithRetry`. Nunca hardcodar o retorno (config por pessoa/tenant).
     */
    public validaConfigDoc = async (params: {
        tela?: GerDocTela;
        filCod: number;
        docTip: number;
        globalDocVldTipo: number;
        priCod: number;
        pesCod: number;
        pdcDocFederal?: string;
        endCodFis: number;
        gcdCod: number;
    }): Promise<ValidaConfigDocResult> => {
        const { filCod } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/gerDoc/validaConfigDoc`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<unknown>(
                    path,
                    {
                        docTip: params.docTip,
                        globalDocVldTipo: params.globalDocVldTipo,
                        priCod: params.priCod,
                        pesCod: params.pesCod,
                        pdcDocFederal: params.pdcDocFederal ?? null,
                        endCodFis: params.endCodFis,
                        gcdCod: params.gcdCod,
                    },
                    { filCod },
                );
                const parsed = VALIDA_CONFIG_DOC_SCHEMA.parse(raw);
                return { ...(parsed.responseData ?? {}) };
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * Gate de ELEGIBILIDADE do pré-flight (READ-ONLY): roda o MESMO `validaConfigDoc` do fluxo de geração,
     * mas lê o envelope `messages` (não só `responseData`) para dizer se o `gcdCod` alvo é compatível com o
     * processo. `elegivel:false` ⟺ existe `messages[].valid==='ERRO'` (ex.: `COM_068.CFOP_INCOMPATIVEL...`);
     * `AVISO` não bloqueia (vira `aviso`). Idempotente → `runWithRetry`. Um erro de transporte (405/404/401)
     * re-lança como `ConexosError` (o service separa transporte de domínio no gate 0).
     */
    public verificarConfigElegivel = async (params: {
        tela?: GerDocTela;
        filCod: number;
        docTip: number;
        globalDocVldTipo: number;
        priCod: number;
        pesCod: number;
        pdcDocFederal?: string;
        endCodFis: number;
        gcdCod: number;
    }): Promise<{ elegivel: boolean; motivo?: string; aviso?: string; gcdVldTela?: number }> => {
        const { filCod } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/gerDoc/validaConfigDoc`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<unknown>(
                    path,
                    {
                        docTip: params.docTip,
                        globalDocVldTipo: params.globalDocVldTipo,
                        priCod: params.priCod,
                        pesCod: params.pesCod,
                        pdcDocFederal: params.pdcDocFederal ?? null,
                        endCodFis: params.endCodFis,
                        gcdCod: params.gcdCod,
                    },
                    { filCod },
                );
                const parsed = CONFIG_DOC_MESSAGES_SCHEMA.parse(raw);
                const msgs = parsed.messages ?? [];
                const erro = msgs.find((m) => m.valid === 'ERRO');
                const aviso = msgs.find((m) => m.valid === 'AVISO');
                const gcdVldTela = parsed.responseData?.gcdVldTela;
                if (erro) {
                    return {
                        elegivel: false,
                        motivo: erro.message,
                        ...(gcdVldTela !== undefined ? { gcdVldTela } : {}),
                    };
                }
                return {
                    elegivel: true,
                    ...(aviso ? { aviso: aviso.message } : {}),
                    ...(gcdVldTela !== undefined ? { gcdVldTela } : {}),
                };
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * `POST {tela}/gerDoc/contasProj/list/{gcd}/{pes}/{end}` — rateio servido pelo ERP.
     * Leitura paginada → `listGenericPaginated`. Cada linha carrega o `total` (percentual).
     */
    public listContasProjeto = async (params: {
        tela?: GerDocTela;
        filCod: number;
        gcdCod: number;
        pesCod: number;
        endCodFis: number;
    }): Promise<ContaProjetoRow[]> => {
        const { filCod, gcdCod, pesCod, endCodFis } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/gerDoc/contasProj/list/${gcdCod}/${pesCod}/${endCodFis}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const page = await this.base.listGenericPaginated<Record<string, unknown>>(
                    path,
                    {
                        fieldList: [],
                        filterList: {},
                        pageNumber: 1,
                        pageSize: 200,
                        orderList: { orderList: [] },
                    },
                    { filCod },
                );
                return (page.rows ?? []).map((r) => CONTA_PROJETO_ROW_SCHEMA.parse(r));
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * `POST {tela}/gerDocProcesso/valida` — pré-cheque obrigatório antes da geração. O corpo NÃO é o
     * header do documento, e sim o WRAPPER `{items:[{titVldPagopor:null, gcdCod, items:[<stub null>]}]}`
     * (HAR doc 18339). Enviar o header flat causava `SELECTION_ERROR`. Só o `gcdCod` importa — o servidor
     * valida a existência da configuração. Retorna as `messages`; o caller aborta em `valid==='ERRO'`.
     * Sucesso = `messages[0].valid==='SUCESSO'`. Leitura → `runWithRetry`.
     *
     * QUESTION-tolerante: o stub carrega rateio `null`, então o ERP pode devolver HTTP **400** com o
     * envelope `{type:"QUESTION", questions:[...]}` (soft-confirm "documento não será gerado sem valor —
     * continuar?"). Isso NÃO é erro: o `valor` real vai no `gerDocProcesso` seguinte. Para a pergunta
     * benigna `NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR` (ou, genericamente, quando existe uma opção
     * YES/SIMPLE e a única alternativa é ABORT) tratamos a valida como PASSOU (log BUSINESS_WARN auditável,
     * retorno `[{valid:'SUCESSO'}]` sintético) e o caller segue para a geração — SEM round-trip de resposta
     * (o HAR doc 18339 foi direto de valida→gerDocProcesso). Qualquer OUTRA pergunta → fail-closed (throw):
     * não auto-respondemos prompts financeiros arbitrários.
     */
    public validarGeracao = async (params: {
        tela?: GerDocTela;
        filCod: number;
        gcdCod: number;
        titVldPagopor?: null;
    }): Promise<GerDocProcessoMessage[]> => {
        const { filCod, gcdCod } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/gerDocProcesso/valida`;
        const wrapper = this.buildValidaWrapper(gcdCod);
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                try {
                    const raw = await this.base.postGeneric<unknown>(path, wrapper, { filCod });
                    return this.extractMessages(raw);
                } catch (httpErr) {
                    // O HTTP layer lança em 400. Um 400 com corpo QUESTION é soft-confirm, não erro.
                    const question = this.extractQuestionEnvelope(httpErr);
                    if (question) {
                        return await this.handleValidaQuestion({
                            path,
                            tela,
                            filCod,
                            gcdCod,
                            question,
                        });
                    }
                    throw httpErr;
                }
            });
        } catch (cause) {
            // Se já é um ConexosError (fail-closed de pergunta desconhecida) não re-embrulha.
            if (cause instanceof ConexosError) throw cause;
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * Extrai o envelope `{type:"QUESTION", questions:[...]}` do corpo de um AxiosError 400 (ou de qualquer
     * throw que carregue `response.data`/`cause.response.data`). Retorna `undefined` se o corpo não for uma
     * QUESTION — nesse caso o caller re-lança o erro original (é uma falha genuína).
     */
    private extractQuestionEnvelope = (err: unknown): QuestionEnvelope | undefined => {
        const ax = err as {
            response?: { data?: unknown };
            cause?: { response?: { data?: unknown } };
        };
        const data = ax?.response?.data ?? ax?.cause?.response?.data;
        if (data === undefined || data === null) return undefined;
        const parsed = QUESTION_ENVELOPE_SCHEMA.safeParse(data);
        return parsed.success ? parsed.data : undefined;
    };

    /**
     * Classifica a QUESTION da valida: benigna (auto-YES, log + PASSOU) ou desconhecida (fail-closed throw).
     * Benigna = todas as perguntas são "YES-to-continue" (id conhecido `NAO_SERA_GERADO_...`, OU existe uma
     * opção com `id/key==='YES'` type SIMPLE e as demais são ABORT). Retorna as messages sintéticas SUCESSO.
     */
    private handleValidaQuestion = async (p: {
        path: string;
        tela: GerDocTela;
        filCod: number;
        gcdCod: number;
        question: QuestionEnvelope;
    }): Promise<GerDocProcessoMessage[]> => {
        const { path, tela, filCod, gcdCod, question } = p;
        const questions = question.questions;
        const allBenign =
            questions.length > 0 && questions.every((q) => this.isBenignContinueQuestion(q));
        const ids = questions.map((q) => q.id ?? q.key ?? '(unknown)');
        if (!allBenign) {
            // Fail-closed: nunca auto-respondemos um prompt financeiro arbitrário.
            throw new ConexosError({
                endpoint: path,
                message: `gerDocProcesso/valida returned an unrecognized QUESTION (${ids.join(', ')}) — refusing to auto-answer`,
            });
        }
        await this.logService.warn({
            type: LOG_TYPE.BUSINESS_WARN,
            message:
                'gerDocProcesso/valida QUESTION auto-answered YES (soft-confirm "doc sem valor — continuar?"); ' +
                'the real valor is sent in the subsequent gerDocProcesso — proceeding without an answer round-trip',
            data: { tela, filCod, gcdCod, questionIds: ids },
        });
        return [{ valid: 'SUCESSO', message: ids.join(',') }];
    };

    /**
     * `true` quando a pergunta é o soft-confirm benigno "continuar?": id/key conhecido
     * (`NAO_SERA_GERADO_DOC_SEM_VALOR_CONTINUAR`), OU o `answerList` oferece uma opção YES do tipo SIMPLE e a
     * única alternativa é ABORT. Qualquer outra forma NÃO é auto-respondível.
     */
    private isBenignContinueQuestion = (q: QuestionEntry): boolean => {
        const idKey = `${q.id ?? ''} ${q.key ?? ''}`.toUpperCase();
        if (idKey.includes(BENIGN_CONTINUE_QUESTION_ID)) return true;
        const options = q.answerList ?? [];
        const hasYesSimple = options.some(
            (o) =>
                (o.id?.toUpperCase() === 'YES' || o.key?.toUpperCase() === 'YES') &&
                (o.type ?? '').toUpperCase() === 'SIMPLE',
        );
        const othersAreAbort = options.every((o) => {
            const isYes = o.id?.toUpperCase() === 'YES' || o.key?.toUpperCase() === 'YES';
            const isAbort =
                o.id?.toUpperCase() === 'ABORT' ||
                o.key?.toUpperCase() === 'ABORT' ||
                (o.type ?? '').toUpperCase() === 'ABORT';
            return isYes || isAbort;
        });
        return hasYesSimple && othersAreAbort;
    };

    /**
     * Monta o WRAPPER do `gerDocProcesso/valida` a partir do `gcdCod` — um grupo com `titVldPagopor:null`
     * e UMA linha de rateio-stub com todos os campos `null` (HAR doc 18339). Nunca vazamos o header aqui.
     */
    private buildValidaWrapper = (gcdCod: number): GerDocProcessoValidaWrapper => ({
        items: [
            {
                titVldPagopor: null,
                gcdCod,
                items: [
                    {
                        prjCod: null,
                        ctpCod: null,
                        tmpMnyValor: null,
                        ctpDesNome: null,
                        tpcCod: null,
                        tpcDesNome: null,
                        cfoEspCod: null,
                        total: null,
                    },
                ],
            },
        ],
    });

    /**
     * `POST {tela}/gerDocProcesso` — a geração EFETIVA (escrita IRREVERSÍVEL, cria o documento).
     * POST-once: header + `items[]` num só body. `postGenericOnce` (sem 401-retry) + tentativa
     * ÚNICA, como `gravarBaixaPermuta` — um re-POST duplicaria o documento no ERP. Retorna o
     * `docCod` (handle) extraído de `data.messages[i].vars.docCod`.
     */
    public gerarDocProcesso = async (params: {
        tela?: GerDocTela;
        filCod: number;
        payload: GerDocProcessoPayload;
    }): Promise<{ docCod: number; messages: GerDocProcessoMessage[] }> => {
        const { filCod, payload } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/gerDocProcesso`;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(path, payload, { filCod });
            const messages = this.extractMessages(raw);
            const docCod = this.extractDocCod(messages);
            // Sem um `docCod` numérico, não há confirmação persistida — aborta (vira `error`).
            if (docCod === undefined) {
                throw new Error('gerDocProcesso: response missing docCod in messages[].vars');
            }
            return { docCod, messages };
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * FINALIZA o documento gerado (Tela 1/3 do guia: "depois do documento gerado, finalizar").
     * `POST {tela}/validate/finalizacaoDocumento/{docCod}` (pré-cheque) → `POST {tela}/finalizaDocumento/{docCod}`
     * → **releitura do documento** (`GET {tela}/{docCod}`). Endpoints confirmados no bundle com299 (view);
     * com297 assumido na mesma família. Escrita IRREVERSÍVEL → `postGenericOnce`, tentativa única. Aborta em
     * `valid==='ERRO'` na validação.
     *
     * **Sucesso ⟺ `docVldFinalizado === 1` na releitura** — HTTP 200 NÃO é o discriminador: na execução real
     * do HML (2026-08-03, SN nº 731) os dois POSTs voltaram 200 e o documento ficou `docVldFinalizado: 0`,
     * sem título (`mnyTitValor: 0`); o fluxo só quebrou uma etapa depois (fin014), com uma mensagem que
     * apontava para o lugar errado. Mesma doutrina da leg fiscal (`fisVldTipoNfDebito===6`, `fisEspObs`
     * preenchido): cada etapa relê o SEU discriminador e falha-fechado na própria etapa.
     */
    public finalizarDocumento = async (params: {
        tela?: GerDocTela;
        filCod: number;
        docCod: number;
    }): Promise<GerDocProcessoMessage[]> => {
        const { filCod, docCod } = params;
        const tela = params.tela ?? 'com299';
        const validatePath = `${tela}/validate/finalizacaoDocumento/${docCod}`;
        const finalizePath = `${tela}/finalizaDocumento/${docCod}`;
        try {
            await this.base.ensureSid();
            const validaRaw = await this.base.postGeneric<unknown>(validatePath, {}, { filCod });
            const validaMsgs = this.extractMessages(validaRaw);
            // ERRO no pré-cheque: o caller (assertNoErpError) decide — nada foi finalizado, nada a reler.
            if (validaMsgs.some((m) => m.valid === 'ERRO')) return validaMsgs;
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(finalizePath, {}, { filCod });
            const messages = this.extractMessages(raw);
            await this.assertDocumentoFinalizado({ tela, filCod, docCod, messages });
            return messages;
        } catch (cause) {
            // Um ConexosError já carrega a mensagem certa (fail-closed da finalização / falha do GET).
            if (cause instanceof ConexosError) throw cause;
            throw new ConexosError({ endpoint: finalizePath, cause });
        }
    };

    /**
     * Relê o documento e EXIGE `docVldFinalizado === 1`. Fail-closed com o `docCod` na mensagem: a SN
     * existe no ERP (não finalizada) e o analista precisa saber qual documento ficou pendurado e em QUE
     * etapa parou — sem isso o erro só aparece no fin014 ("a SN não ficou finalizável"), longe da causa.
     */
    private assertDocumentoFinalizado = async (p: {
        tela: GerDocTela;
        filCod: number;
        docCod: number;
        messages: GerDocProcessoMessage[];
    }): Promise<void> => {
        const { tela, filCod, docCod, messages } = p;
        const doc = await this.getDocumento({ tela, filCod, docCod });
        const parsed = DOC_FINALIZADO_SCHEMA.safeParse(doc);
        const finalizado = parsed.success ? parsed.data.docVldFinalizado : undefined;
        if (finalizado === DOC_FINALIZADO_OK) return;
        const detalhe = messages
            .map((m) => m.message)
            .filter((m): m is string => typeof m === 'string' && m.trim() !== '')
            .join('; ');
        throw new ConexosError({
            endpoint: `${tela}/finalizaDocumento/${docCod}`,
            message:
                `Finalização do documento ${docCod} (${tela}) NÃO efetivada: o ERP respondeu HTTP 200 mas a ` +
                `releitura traz docVldFinalizado=${String(finalizado ?? 'ausente')} (esperado ${DOC_FINALIZADO_OK}). ` +
                'Sem finalização o documento não gera título a receber — verifique valor/itens e a condição de ' +
                `pagamento do documento no Conexos antes de reprocessar.${detalhe !== '' ? ` ERP: ${detalhe}` : ''}`,
        });
    };

    // ───────────────────────── SN adiantamento: completar o doc até ficar finalizável ─────────────────────
    // O com299/gerDocProcesso nasce SHELL (docMnyValor:0). Para virar um adiantamento BAIXÁVEL no fin014
    // faltam dois passos (HAR 2026-08-02 17-31, doc 18342 → docVldFinalizado:1, docMnyValor:100):
    //   (1) condição de pagamento = a do cadastro da pessoa (senão com194 dá ERRO e trava a finalização);
    //   (2) uma LINHA DE ITEM (comDocProdutos) com o valor alocado (é ela que materializa o docMnyValor).

    /**
     * LOV `ConfigDocProcesso` — as configs (`gcd`) VÁLIDAS p/ o processo/pessoa (o dropdown da tela). Gate
     * AUTORITATIVO de elegibilidade: se o gcd alvo não está aqui, a geração falha `gcdDesNomeProc NOT_VALID`.
     */
    public listConfigDocProcesso = async (params: {
        tela?: GerDocTela;
        filCod: number;
        priCod: number;
        pesCod: number;
        endCodFis: number;
    }): Promise<Array<{ gcdCod: number; gcdDesNome: string }>> => {
        const { filCod, priCod, pesCod, endCodFis } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<unknown>(
                    'lov/ConfigDocProcesso',
                    {
                        fieldList: ['gcdDesNome', 'gcdVldTela', 'gcdCod'],
                        // docTip:1 / globalDocVldTipo:9 = SN (mesmos discriminadores do com299 gerDoc).
                        filterList: {
                            priCod,
                            docTip: 1,
                            globalDocVldTipo: 9,
                            fPesCod: pesCod,
                            fEndCod: endCodFis,
                        },
                        pageNumber: 1,
                        pageSize: 200,
                        orderBy: 'asc',
                        sortBy: 'gcdDesNome',
                    },
                    { filCod },
                );
                return CONFIG_DOC_PROCESSO_SCHEMA.parse(raw).rows;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'lov/ConfigDocProcesso', cause });
        }
    };

    /**
     * LOV das condições de pagamento (`fdocTipPgto:1` = a receber). Leitura idempotente, PAGINADA até
     * esgotar: o `pesCod` vai no `filterList` mas o ERP o IGNORA e devolve a lista GLOBAL ordenada por
     * nome — quem filtra pelo cliente é o caller, e para isso precisa da lista INTEIRA.
     *
     * **A parada é pelo `count` do envelope, NUNCA pelo `pageSize` que pedimos.** Medido no HML
     * (2026-08-03, pesCod 232): pedimos `pageSize: 500` e o ERP respondeu `count: 86` com **50 linhas** —
     * ele impõe a própria página. O critério antigo ("página menor que o pageSize pedido ⟹ acabou")
     * disparava já na 1ª página e nunca buscava a 2ª, que era justamente onde estava a
     * `101 "SKYJACK BRASIL - DUPLICATA"` (ordem alfabética). Agora: acumula enquanto houver linhas e
     * `acumulado < count`; para em página VAZIA, ao alcançar o `count`, ou no teto de páginas. Sem `count`
     * no envelope só a página vazia (ou o teto) encerra — nunca se infere fim por tamanho de página.
     */
    public listCondPgtoPessoa = async (params: {
        filCod: number;
        pesCod: number;
    }): Promise<Array<{ pgtCod: number; pgtDesNome: string }>> => {
        const { filCod, pesCod } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const acumulado: Array<{ pgtCod: number; pgtDesNome: string }> = [];
                // `count` do PRIMEIRO envelope — o total autoritativo da lista.
                let total: number | undefined;
                for (let pageNumber = 1; pageNumber <= COND_PGTO_MAX_PAGES; pageNumber++) {
                    const raw = await this.base.postGeneric<unknown>(
                        'lov/CondPgtoPessoa',
                        {
                            fieldList: ['pgtCod', 'pgtDesNome'],
                            filterList: { pesCod, fdocTipPgto: 1 },
                            pageNumber,
                            pageSize: COND_PGTO_PAGE_SIZE,
                            orderBy: 'asc',
                            sortBy: 'pgtDesNome',
                        },
                        { filCod },
                    );
                    const page = LOV_COND_PGTO_SCHEMA.parse(raw);
                    // Página vazia é o ÚNICO sinal de fim independente do servidor honrar o que pedimos.
                    if (page.rows.length === 0) break;
                    acumulado.push(...page.rows);
                    if (total === undefined) total = page.count;
                    if (total !== undefined && acumulado.length >= total) break;
                }
                return acumulado;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'lov/CondPgtoPessoa', cause });
        }
    };

    /** LOV das contas de projeto (rateio). A SN Encomenda usa a conta "ADIANTAMENTO DE CLIENTE ENCOMENDA". */
    public listContasProjetoCtb = async (params: {
        filCod: number;
        prjCod: number;
        priCod: number;
        tpdCod: number;
    }): Promise<Array<{ ctpCod: number; ctpDesNome: string; ctpEspConta?: string }>> => {
        const { filCod, prjCod, priCod, tpdCod } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<unknown>(
                    'lov/ContasProjetoCtb',
                    {
                        fieldList: ['ctpDesNome', 'ctpEspConta', 'ctpCod'],
                        filterList: { prjCod, docTip: 1, priCod, tpdCod, priCodProd: priCod },
                        pageNumber: 1,
                        pageSize: 500,
                        orderBy: 'asc',
                        sortBy: 'ctpDesNome',
                    },
                    { filCod },
                );
                return LOV_CONTAS_PROJETO_SCHEMA.parse(raw).rows.map((r) => ({
                    ctpCod: r.ctpCod,
                    ctpDesNome: r.ctpDesNome,
                    ...(r.ctpEspConta != null ? { ctpEspConta: r.ctpEspConta } : {}),
                }));
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'lov/ContasProjetoCtb', cause });
        }
    };

    /** GET do documento com299 inteiro — base para o PUT (alterar 1 campo reenviando o doc completo). */
    public getDocumento = async (params: {
        tela?: GerDocTela;
        filCod: number;
        docCod: number;
    }): Promise<Record<string, unknown>> => {
        const { filCod, docCod } = params;
        const tela = params.tela ?? 'com299';
        try {
            await this.base.ensureSid();
            return await this.base.getGeneric<Record<string, unknown>>(`${tela}/${docCod}`, {
                filCod,
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: `${tela}/${docCod}`, cause });
        }
    };

    /** `PUT {tela}` — reenvia o doc INTEIRO (usado p/ setar a condição de pagamento). Escrita → putGenericOnce. */
    public atualizarDocumento = async (params: {
        tela?: GerDocTela;
        filCod: number;
        payload: Record<string, unknown>;
    }): Promise<Record<string, unknown>> => {
        const { filCod, payload } = params;
        const tela = params.tela ?? 'com299';
        try {
            await this.base.ensureSid();
            return await this.base.putGenericOnce<Record<string, unknown>>(tela, payload, {
                filCod,
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: `PUT ${tela}`, cause });
        }
    };

    /** Template default de um item comDocProdutos — o servidor pré-preenche prdCod/tpcCod/cfoEspCod/etc. */
    public comDocProdutosInitialValues = async (params: {
        tela?: GerDocTela;
        filCod: number;
        doc: Record<string, unknown>;
    }): Promise<Record<string, unknown>> => {
        const { filCod, doc } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/comDocProdutos/initialValues`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<Record<string, unknown>>(path, doc, {
                    filCod,
                });
                // Resposta vem aninhada em {COM299:{ComDocProdutos:{...}}} — normaliza p/ o template flat.
                const outer = (raw?.COM299 ?? {}) as Record<string, unknown>;
                const nested = outer.ComDocProdutos as Record<string, unknown> | undefined;
                return nested ?? raw;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /** Cria a LINHA DE ITEM (é ela que dá valor ao doc). Escrita irreversível → postGenericOnce. */
    public adicionarComDocProduto = async (params: {
        tela?: GerDocTela;
        filCod: number;
        payload: Record<string, unknown>;
    }): Promise<Record<string, unknown>> => {
        const { filCod, payload } = params;
        const tela = params.tela ?? 'com299';
        const path = `${tela}/comDocProdutos`;
        try {
            await this.base.ensureSid();
            return await this.base.postGenericOnce<Record<string, unknown>>(path, payload, {
                filCod,
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * Resolve o `gcdCod` a partir do NOME da Configuração (`gcdDesNome`) — evita hardcodar um número
     * que varia por tenant/filial (Tela 3: "NOTA DE DÉBITO ELETRÔNICA"). `POST {tela}/list` + casa o
     * primeiro doc cujo `gcdDesNome` CONTÉM o nome (case-insensitive). `undefined` se nenhum doc da
     * filial usa essa Configuração (o caller decide: config override ou fail-closed).
     */
    public resolveGcdCodByName = async (params: {
        tela: GerDocTela;
        filCod: number;
        gcdDesNome: string;
    }): Promise<number | undefined> => {
        const { tela, filCod, gcdDesNome } = params;
        const alvo = gcdDesNome.trim().toLowerCase();
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const page = await this.base.listGenericPaginated<Record<string, unknown>>(
                    `${tela}/list`,
                    {
                        fieldList: ['gcdCod', 'gcdDesNome'],
                        filterList: {},
                        pageNumber: 1,
                        pageSize: 500,
                        serviceName: tela,
                        orderList: { orderList: [{ propertyName: 'docCod', order: 'desc' }] },
                    },
                    { filCod },
                );
                for (const r of page.rows ?? []) {
                    const nome = String(r.gcdDesNome ?? '')
                        .trim()
                        .toLowerCase();
                    const cod = Number(r.gcdCod);
                    if (nome?.includes(alvo) && Number.isFinite(cod)) return cod;
                }
                return undefined;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: `${tela}/list`, cause });
        }
    };

    /**
     * Lista as **Solicitações de Numerário (SN)** já existentes de um processo (`POST /api/com299/list`,
     * HAR-confirmado). Alimenta o painel "selecionar SN existente" do modal Alocar (ADR-0027): o analista
     * escolhe uma SN existente (baixa fin014 + NDe com297 contra o `docCod` dela) OU cria uma nova.
     *
     * O servidor filtra a família SN via `docVldTipo#EQ:9` + `docVldTipoAdto#EQ:1` (reusa as constantes
     * `SOLICITACAO_NUMERARIO_DOC_VLD_TIPO`/`_ADTO` — nunca hardcodar 9/1) e `vldStatus#IN:["1","3"]`; e
     * `priCod#EQ` amarra ao processo. Uma NC/ND do mesmo processo é `docVldTipoAdto===0` — o servidor já
     * a exclui, mas o filtro DEFENSIVO abaixo garante que uma linha fora do discriminador nunca vaze para
     * o analista. Leitura idempotente → `runWithRetry` + `ensureSid` (paridade EXATA com `listContasProjeto`
     * / `resolveGcdCodByName`: `listGenericPaginated` NÃO embrulha retry/ensureSid — só o `paginate` faz);
     * falha vira `ConexosError` como os métodos irmãos. Zod no boundary (`.passthrough()`); projeta ao DTO.
     */
    public listSNsByProcesso = async (params: {
        filCod: number;
        priCod: number;
        pageSize?: number;
    }): Promise<SolicitacaoNumerarioListItem[]> => {
        const { filCod, priCod } = params;
        const pageSize = params.pageSize ?? 50;
        const path = 'com299/list';
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const page = await this.base.listGenericPaginated<Record<string, unknown>>(
                    // URL path = `com299/list` (o 1º arg vira `/${serviceName}` no adapter). O sibling
                    // `resolveGcdCodByName` faz igual (`${tela}/list`); passar só `'com299'` POSTaria em
                    // `/com299` (documento, não a lista) — a lista viria vazia/4xx e a feature ficaria inerte.
                    // O `serviceName: 'com299'` do BODY é o do envelope (contrato HAR), não a URL.
                    'com299/list',
                    {
                        fieldList: [
                            'docCod',
                            'priCod',
                            'priEspRefcliente',
                            'docDtaEmissao',
                            'docEspNumero',
                            'docVldTipoAdto',
                            'tpdDesNome',
                            'pesCod',
                            'dpeNomPessoa',
                            'ufEspSigla',
                            'mnyBruto',
                            'docMnyValor',
                            'vldStatus',
                            'gerDes',
                            'docVldTipo',
                            'pdcDocFederal',
                            'gcdCod',
                            'gcdDesNome',
                            'moeCod',
                            'fisVldFundapDesc',
                            'moeEspNome',
                            'filCod',
                            'docTip',
                        ],
                        filterList: {
                            'priCod#EQ': priCod,
                            'docVldTipo#EQ': SOLICITACAO_NUMERARIO_DOC_VLD_TIPO,
                            'docVldTipoAdto#EQ': SOLICITACAO_NUMERARIO_DOC_VLD_TIPO_ADTO,
                            'vldStatus#IN': ['1', '3'],
                        },
                        pageNumber: 1,
                        pageSize,
                        serviceName: 'com299',
                        orderList: { orderList: [{ propertyName: 'docCod', order: 'desc' }] },
                    },
                    { filCod },
                );
                const envelope = SOLICITACAO_NUMERARIO_LIST_ENVELOPE_SCHEMA.parse({
                    ...page,
                    rows: page.rows ?? [],
                });
                return (
                    envelope.rows
                        // Guard defensivo: a SN é docVldTipo===9 && docVldTipoAdto===1. Uma NC/ND (adto===0)
                        // que escape do filtro do servidor NUNCA chega ao analista como se fosse SN.
                        .filter(
                            (r) =>
                                r.docVldTipo === SOLICITACAO_NUMERARIO_DOC_VLD_TIPO &&
                                r.docVldTipoAdto === SOLICITACAO_NUMERARIO_DOC_VLD_TIPO_ADTO,
                        )
                        .map((r) => this.toSolicitacaoNumerarioListItem(r))
                );
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /** Projeta a linha crua do `com299/list` na projeção lógica devolvida à API (data ISO, descrição derivada). */
    private toSolicitacaoNumerarioListItem = (
        r: SolicitacaoNumerarioRow,
    ): SolicitacaoNumerarioListItem => ({
        docCod: r.docCod,
        numero: r.docEspNumero,
        data: new Date(r.docDtaEmissao).toISOString(),
        descricao: r.gcdDesNome ?? r.tpdDesNome ?? r.gerDes ?? '',
        ...(r.gcdCod !== undefined ? { gcdCod: r.gcdCod } : {}),
        status: r.vldStatus,
        statusLabel: solicitacaoNumerarioStatusLabel(r.vldStatus),
        solicitado: r.mnyBruto,
        valor: r.docMnyValor,
    });

    /**
     * Adiciona uma linha de produto ao documento (`{tela}/comDocProdutos`) — o Produto 41978 da nota de
     * débito (Tela 3). ESCRITA → `postGenericOnce`. Retorna as messages do ERP.
     */
    public adicionarProduto = async (params: {
        tela: GerDocTela;
        filCod: number;
        payload: Record<string, unknown>;
    }): Promise<GerDocProcessoMessage[]> => {
        const { tela, filCod, payload } = params;
        const path = `${tela}/comDocProdutos`;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(path, payload, { filCod });
            return this.extractMessages(raw);
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * Homologa o documento (`POST {tela}/enviaConferencia/homologaNfe/{docCod}` — Tela 3). ESCRITA
     * IRREVERSÍVEL → `postGenericOnce`. Retorna as messages (`docVldComvalidacoes` 1=ok/2=aviso).
     */
    public homologarNfe = async (params: {
        tela: GerDocTela;
        filCod: number;
        docCod: number;
    }): Promise<GerDocProcessoMessage[]> => {
        const { tela, filCod, docCod } = params;
        const path = `${tela}/enviaConferencia/homologaNfe/${docCod}`;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(path, {}, { filCod });
            return this.extractMessages(raw);
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /** Extrai `messages` do envelope (aceita `.data.messages` ou `.messages` no topo). */
    private extractMessages = (raw: unknown): GerDocProcessoMessage[] => {
        const parsed = MESSAGES_ENVELOPE_SCHEMA.safeParse(raw);
        if (!parsed.success) return [];
        return parsed.data.data?.messages ?? parsed.data.messages ?? [];
    };

    /** `docCod` (número) do primeiro message que o traz em `vars.docCod`. */
    private extractDocCod = (messages: GerDocProcessoMessage[]): number | undefined => {
        for (const m of messages) {
            const raw = m.vars?.docCod;
            const n = Number(raw);
            if (raw !== undefined && raw !== null && Number.isFinite(n)) return n;
        }
        return undefined;
    };
}

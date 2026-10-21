import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ConexosError from '../errors/ConexosError.js';
import ConexosWriteDisabledError from '../errors/ConexosWriteDisabledError.js';
import ErpResponseReader from '../errors/ErpResponseReader.js';
import type {
    BaixaGravada,
    BorderoCriado,
    BorderoDetalhe,
    BorderoIdentificado,
    BorderoListaItem,
    BuscaIdentidadeBordero,
    FalhaClassificada,
    Fin010ValidacaoResponse,
    JanelaBorderoParams,
    TituloBaixaValidacao,
    TituloPermutaValidacao,
} from '../interface/permutas/Fin010Baixa.js';
import EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * Zod no boundary das ESCRITAS fin010 que viram confirmação persistida (Regis P0 integrability).
 * O crítico é o identificador que gravamos: `borCod` (borderô criado) e `bxaCodSeq` (baixa gravada).
 * Demais campos são lenientes (coerce + default) — não bloqueiam, mas o id confirmado é exigido.
 */
const BORDERO_CRIADO_SCHEMA = z.object({
    borCod: z.coerce.number().int().positive(),
    filCod: z.coerce.number().int().optional().default(0),
    borVldTipo: z.coerce.number().int().optional().default(2),
    borDtaMvto: z.coerce.number().optional().default(0),
});

const BAIXA_GRAVADA_SCHEMA = z.object({
    bxaCodSeq: z.coerce.number().int().positive(),
    borCod: z.coerce.number().int().optional().default(0),
    docCod: z.coerce.number().optional().default(0),
    bxaDocCod: z.coerce.number().optional().default(0),
    bxaMnyValor: z.coerce.number().optional().default(0),
    bxaMnyJuros: z.coerce.number().optional().default(0),
    bxaMnyLiquido: z.coerce.number().optional().default(0),
});

/** Epoch ms do ERP: inteiro positivo, sem coerção de `null`/`''` (que viraria 0). */
const EPOCH_MS = z.number().int().positive();

/**
 * Borderô do grupo (ADR-0076, I19l): a identidade que persistimos é `borCod` + `borTimCad`.
 * Sem um dos dois a resposta não prova QUAL borderô foi criado — falha (transitória: a
 * retomada reconhece pela janela de `borTimCad`, I19s).
 */
const BORDERO_IDENTIFICADO_SCHEMA = z
    .object({
        filCod: z.coerce.number().int().positive(),
        borCod: z.coerce.number().int().positive(),
        borTimCad: EPOCH_MS,
        usnCodCad: z.number().int().positive().nullish(),
        gerNum: z.number().int().nullish(),
        borDtaMvto: z.number().nullish(),
        borVldFinalizado: z.number().int().nullish(),
        vlrTotalLiquido: z.number().nullish(),
        vldHasRemessaPgto: z.number().int().nullish(),
    })
    .passthrough()
    .transform(
        (r): BorderoIdentificado => ({
            filCod: r.filCod,
            borCod: r.borCod,
            borTimCad: r.borTimCad,
            ...(r.usnCodCad != null ? { usnCodCad: r.usnCodCad } : {}),
            ...(r.gerNum != null ? { gerNum: r.gerNum } : {}),
            ...(r.borDtaMvto != null ? { borDtaMvto: r.borDtaMvto } : {}),
            ...(r.borVldFinalizado != null ? { borVldFinalizado: r.borVldFinalizado } : {}),
            ...(r.vlrTotalLiquido != null ? { vlrTotalLiquido: r.vlrTotalLiquido } : {}),
            ...(r.vldHasRemessaPgto != null ? { vldHasRemessaPgto: r.vldHasRemessaPgto } : {}),
        }),
    );

/** Situação da busca pela identidade (`buscarBorderoPorIdentidade`). */
export const IDENTIDADE_BORDERO = {
    PRESENTE: 'PRESENTE',
    AUSENTE: 'AUSENTE',
    ALHEIO: 'ALHEIO',
} as const;

/** Página da busca por janela/identidade: muito acima do esperado (0, 1 ou poucos). */
const PAGINA_IDENTIDADE = 50;

/** Campos opcionais do cabeçalho que o grupo lê (Permutas ignora). */
const camposDoGrupo = (d: Record<string, unknown>) => ({
    ...(d.vldHasRemessaPgto != null ? { vldHasRemessaPgto: Number(d.vldHasRemessaPgto) } : {}),
    ...(d.borTimCad != null ? { borTimCad: Number(d.borTimCad) } : {}),
    ...(d.usnCodCad != null ? { usnCodCad: Number(d.usnCodCad) } : {}),
});

/**
 * Conexos ERP `fin010` write family (baixa/permuta — Fase 3, risco
 * arquitetural #1). Handshake de 5 chamadas; ver
 * `business-rules/fin010-write-contract.md`. Toda escrita reusa o
 * `postGeneric` (authenticatedPost: sid + cnx-filcod + cnx-usncod +
 * retry-em-401) e o `RetryExecutor` da base, espelhando o lado de leitura.
 *
 * Behaviour is IDENTICAL to the former `ConexosClient` methods of the same
 * name — only the owning class changed (CC-2 split by endpoint family). The
 * non-idempotent writes (criarBordero, gravarBaixaPermuta, the exclui /
 * finaliza / cancela / estorna borderô calls) remain WITHOUT a RetryExecutor
 * exactly as before.
 */
@singleton()
@injectable()
export default class ConexosBaixaClient {
    private base: ConexosBaseClient;
    private environmentProvider?: EnvironmentProvider;

    /**
     * `environmentProvider` é opcional só para os harnesses que montam o client à mão: as
     * escritas do GRUPO exigem `conexosWriteEnabled` e, sem ele, recusam (fail-closed). As de
     * Permutas seguem sem gate interno, como sempre.
     */
    constructor(
        @inject(ConexosBaseClient) base: ConexosBaseClient,
        @inject(EnvironmentProvider) environmentProvider?: EnvironmentProvider,
    ) {
        this.base = base;
        this.environmentProvider = environmentProvider;
    }

    /**
     * Classifica a falha para o serviço do borderô do grupo (I19p): `DETERMINISTICA` = o ERP
     * respondeu 4xx de negócio (repetir dá o mesmo); `TRANSITORIA` = timeout, 5xx, contrato
     * inesperado ou erro sem resposta — inclusive o `500 RECORDNOTFOUND` do `GET fin010`, que por
     * isso NUNCA é usado como prova de ausência.
     */
    public static classificarFalha = (err: unknown): FalhaClassificada => {
        const deterministica =
            err instanceof ConexosError
                ? err.code === 'CONEXOS_UPSTREAM_REJECTED'
                : ErpResponseReader.isDeterministicRefusal(err);
        const data = ErpResponseReader.responseOf(err)?.data as
            | { messages?: Array<{ message?: string }> }
            | undefined;
        const codigoErp = ErpResponseReader.pickMessage(data?.messages)?.message;
        return {
            tipo: deterministica ? 'DETERMINISTICA' : 'TRANSITORIA',
            ...(codigoErp ? { codigoErp } : {}),
        };
    };

    private exigirEscrita = async (): Promise<void> => {
        const env = await this.environmentProvider?.getEnvironmentVars();
        if (env?.conexosWriteEnabled !== true) throw new ConexosWriteDisabledError();
    };

    /**
     * Passo 1 — cria o borderô (tipo permuta) e retorna o `borCod`.
     *
     * SEM RetryExecutor (Regis 2026-06-23, F-fault-tolerance-1 / F-availability-2):
     * é uma ESCRITA não-idempotente. Um retry após timeout-pós-sucesso criaria um
     * borderô duplicado. Só o 401-retry interno do `authenticatedPost` é aceitável
     * (a sessão é rejeitada ANTES de o servidor processar a criação). Tentativa única.
     */
    public criarBordero = async (params: {
        filCod: number;
        /** Data de movimento em epoch-ms (meia-noite UTC do dia). */
        dataMovto: number;
        /** Conta financeira (opcional). Ausente ⇒ corpo IDÊNTICO ao de Permutas. */
        gerNum?: number;
    }): Promise<BorderoCriado> => {
        const { filCod, dataMovto, gerNum } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGeneric<unknown>(
                'fin010',
                this.corpoBordero({ filCod, dataMovto, gerNum }),
                { filCod },
            );
            // Zod no boundary (Regis P0 integrability): a resposta vira confirmação persistida —
            // sem um `borCod` numérico válido, abortamos (não criamos borderô fantasma na trilha).
            return BORDERO_CRIADO_SCHEMA.parse(raw);
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010', cause });
        }
    };

    /** Corpo do `POST fin010`. Nada em `borEspNrbanco` (ADR-0076, emenda 2026-10-21). */
    private corpoBordero = (p: {
        filCod: number;
        dataMovto: number;
        gerNum?: number;
    }): Record<string, unknown> => ({
        filCod: p.filCod,
        borVldTipo: 2,
        borVldFinalizado: 0,
        frontModelName: 'bordero',
        borDtaMvto: p.dataMovto,
        ...(p.gerNum !== undefined ? { gerNum: p.gerNum } : {}),
    });

    /**
     * Borderô do GRUPO de boleto (ADR-0076, I19l(2)) — `POST fin010` em cadastro, com a conta
     * pagadora do lote (`gerNum`), SEM marcador. Tentativa ÚNICA (`postGenericOnce`: sem retry e
     * sem re-POST após 401) — um segundo `POST` criaria outro borderô. Exige `conexosWriteEnabled`.
     *
     * Devolve a identidade `filCod + borCod + borTimCad` (+ `usnCodCad`, o usuário do robô que a
     * retomada usa no filtro da janela). Resposta sem `borCod`/`borTimCad` ⇒ `ConexosError`
     * transitório: o borderô pode existir, e quem decide é a busca por janela (I19s).
     */
    public criarBorderoDoGrupo = async (params: {
        filCod: number;
        /** Data de débito do lote, epoch-ms meia-noite UTC. */
        dataMovto: number;
        gerNum: number;
    }): Promise<BorderoIdentificado> => {
        const { filCod, dataMovto, gerNum } = params;
        if (!Number.isInteger(gerNum) || gerNum <= 0) {
            throw new Error(`gerNum inválido para o borderô do grupo: ${gerNum}`);
        }
        await this.exigirEscrita();
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(
                'fin010',
                this.corpoBordero({ filCod, dataMovto, gerNum }),
                { filCod },
            );
            const b = BORDERO_IDENTIFICADO_SCHEMA.parse(raw);
            return {
                filCod: b.filCod,
                borCod: b.borCod,
                borTimCad: b.borTimCad,
                ...(b.usnCodCad !== undefined ? { usnCodCad: b.usnCodCad } : {}),
                ...(b.borDtaMvto !== undefined ? { borDtaMvto: b.borDtaMvto } : {}),
            };
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010', cause });
        }
    };

    /**
     * Baixa simples de UM título no borderô do grupo (I19l(3)) — `POST fin010/baixas` com o
     * `responseData` da `validacao/tituloBaixa` + a chave + `gerNum`; juros/multa/desconto 0 e
     * líquido = valor validado. Corpo igual ao da fase `baixaBor` da sonda HML. Tentativa ÚNICA:
     * repetir gravaria baixa duplicada. Exige `conexosWriteEnabled`; `bxaCodSeq` validado por Zod.
     */
    public gravarBaixaSimples = async (params: {
        filCod: number;
        borCod: number;
        gerNum: number;
        docCod: number;
        titCod: number;
        /** `responseData` cru da `validacao/tituloBaixa` (o ERP manda `null`s). */
        validacao: Record<string, unknown>;
    }): Promise<BaixaGravada> => {
        const { filCod, borCod, gerNum, docCod, titCod, validacao } = params;
        const valor = Number(validacao.bxaMnyValor);
        if (!Number.isFinite(valor) || valor <= 0) {
            throw new Error(`validação sem bxaMnyValor para ${docCod}/${titCod}`);
        }
        await this.exigirEscrita();
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(
                'fin010/baixas',
                {
                    ...validacao,
                    filCod,
                    borCod,
                    borVldTipo: 2,
                    docTip: 2,
                    docCod,
                    titCod,
                    gerNum,
                    bxaMnyValor: valor,
                    bxaMnyJuros: 0,
                    bxaMnyMulta: 0,
                    bxaMnyDesconto: 0,
                    bxaMnyLiquido: valor,
                    bxaVldSistema: 0,
                    bxaVldCcorrente: 0,
                    bxaVldCorrenteDc: 1,
                    bxaVldAdto: 0,
                    frontModelName: 'baixa',
                },
                { filCod },
            );
            return BAIXA_GRAVADA_SCHEMA.parse(raw);
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010/baixas', cause });
        }
    };

    /**
     * Resposta perdida do `POST fin010` (I19s): borderôs de grupo (tipo 2, em cadastro) do
     * usuário do robô, na conta e data do lote, com `borTimCad` em `[t0 − margem, (t1 ?? agora) +
     * margem]`. O filtro é em **epoch ms** (ISO dá 500 no ERP; `#GTE`/`#BETWEEN` não existem).
     * Devolve TODOS: um ⇒ adota, zero ⇒ cria, dois ou mais ⇒ `indeterminado` (decisão do
     * chamador). Linha sem identidade ou lista truncada ⇒ erro: nunca vira "zero ⇒ cria".
     */
    public buscarBorderosNaJanela = async (
        params: JanelaBorderoParams,
    ): Promise<BorderoIdentificado[]> => {
        const { filCod, usnCodCad, gerNum, borDtaMvto, t0, t1, agora, margemMs } = params;
        const de = t0 - margemMs;
        const ate = (t1 ?? agora) + margemMs;
        if (!(de <= ate)) {
            throw new Error(`janela de borTimCad inválida: ${de} > ${ate}`);
        }
        return this.listarIdentificados(filCod, {
            'borVldTipo#EQ': 2,
            'borVldFinalizado#EQ': 0,
            'usnCodCad#EQ': usnCodCad,
            'gerNum#EQ': gerNum,
            'borDtaMvto#EQ': borDtaMvto,
            'borTimCad#GE': de,
            'borTimCad#LE': ate,
        });
    };

    /**
     * Releitura pela identidade (I19q/I19s): `fin010/list borCod#EQ` (o `GET` de borderô ausente
     * responde `500 RECORDNOTFOUND`, não 404 — não serve de prova). Sem linha ⇒ `AUSENTE`; mesmo
     * `borTimCad` ⇒ `PRESENTE`; o `borCod` com outro `borTimCad` ⇒ `ALHEIO` (o ERP reusou o
     * número). O que fazer com `ALHEIO` depende da etapa e é decisão do serviço.
     */
    public buscarBorderoPorIdentidade = async (params: {
        filCod: number;
        borCod: number;
        borTimCad: number;
    }): Promise<BuscaIdentidadeBordero> => {
        const { filCod, borCod, borTimCad } = params;
        const linhas = await this.listarIdentificados(filCod, {
            'borVldTipo#EQ': 2,
            'borCod#EQ': borCod,
        });
        const nosso = linhas.find((b) => b.borCod === borCod && b.borTimCad === borTimCad);
        if (nosso) return { situacao: IDENTIDADE_BORDERO.PRESENTE, bordero: nosso };
        const outro = linhas.find((b) => b.borCod === borCod);
        if (outro) return { situacao: IDENTIDADE_BORDERO.ALHEIO, bordero: outro };
        return { situacao: IDENTIDADE_BORDERO.AUSENTE };
    };

    /** `fin010/list` com leitura completa e identidade validada (leitura → `runWithRetry`). */
    private listarIdentificados = async (
        filCod: number,
        filterList: Record<string, unknown>,
    ): Promise<BorderoIdentificado[]> => {
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const page = await this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin010/list',
                    {
                        fieldList: [],
                        filterList,
                        pageNumber: 1,
                        pageSize: PAGINA_IDENTIDADE,
                        orderList: { orderList: [{ propertyName: 'borCod', order: 'asc' }] },
                    },
                    { filCod },
                );
                const rows = page.rows ?? [];
                const count = Number(page.count);
                if (Number.isFinite(count) && count > rows.length) {
                    throw new Error(
                        `fin010/list truncado: ${rows.length} de ${count} linhas (identidade)`,
                    );
                }
                return rows.map((r) => BORDERO_IDENTIFICADO_SCHEMA.parse(r));
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010/list', cause });
        }
    };

    /**
     * Lê o estado VIVO de um borderô (`GET /fin010/{filCod}/{borCod}`) — situação
     * (EM CADASTRO / FINALIZADO / ESTORNADO), datas e usuários. Usado pela tela de
     * gestão de borderôs. Retorna `null` se o borderô não existe mais (404 — removido).
     *
     * SEM RetryExecutor: é uma leitura de STATUS best-effort, chamada N vezes (uma por
     * borderô) na listagem. Re-tentar 3× cada borderô ausente/com erro deixava a tela MUITO
     * lenta — aqui falha rápido (o serviço marca INDISPONIVEL e o usuário dá "Atualizar").
     */
    public getBordero = async (params: {
        filCod: number;
        borCod: number;
    }): Promise<BorderoDetalhe | null> => {
        const { filCod, borCod } = params;
        try {
            await this.base.ensureSid();
            const d = await this.base.getGeneric<Record<string, unknown>>(
                `fin010/${filCod}/${borCod}`,
                { filCod },
            );
            if (!d || typeof d !== 'object') return null;
            return {
                borCod: Number(d.borCod ?? borCod),
                filCod: Number(d.filCod ?? filCod),
                ...(d.borDtaMvto != null ? { borDtaMvto: Number(d.borDtaMvto) } : {}),
                ...(d.borVldFinalizado != null
                    ? { borVldFinalizado: Number(d.borVldFinalizado) }
                    : {}),
                borCodEstornado: d.borCodEstornado != null ? Number(d.borCodEstornado) : null,
                borDtaFinalizado: d.borDtaFinalizado != null ? Number(d.borDtaFinalizado) : null,
                usnDesNomeCad: (d.usnDesNomeCad as string | null) ?? null,
                usnDesNomeFin: (d.usnDesNomeFin as string | null) ?? null,
                ...(d.vldHasBaixa != null ? { vldHasBaixa: Number(d.vldHasBaixa) } : {}),
                ...(d.vlrTotalLiquido != null
                    ? { vlrTotalLiquido: Number(d.vlrTotalLiquido) }
                    : {}),
                ...camposDoGrupo(d),
            };
        } catch (cause) {
            const status = (cause as { response?: { status?: number } })?.response?.status;
            if (status === 404) return null; // borderô removido no ERP
            throw new ConexosError({ endpoint: `fin010/${filCod}/${borCod}`, cause });
        }
    };

    /**
     * Lista as baixas de um borderô — `POST /fin010/baixas/list/{borCod}` (sonda HAR). Fonte da
     * verdade do que está DENTRO do borderô (mesmo os não criados por nós). Retorna o necessário
     * para excluir cada baixa (docCod/titCod/bxaCodSeq) + sinais de finalização.
     */
    public listBaixas = async (params: {
        filCod: number;
        borCod: number;
    }): Promise<
        Array<{
            filCod: number;
            docTip: number;
            docCod: number;
            titCod: number;
            bxaCodSeq: number;
            bxaMnyLiquidoPermuta?: number;
            borVldFinalizado?: number;
        }>
    > => {
        const { filCod, borCod } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const page = await this.base.listGenericPaginated<Record<string, unknown>>(
                    `fin010/baixas/list/${borCod}`,
                    {
                        fieldList: [],
                        filterList: {},
                        pageNumber: 1,
                        pageSize: 200,
                        orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                    },
                    { filCod },
                );
                return (
                    (page.rows ?? [])
                        .map((r) => ({
                            filCod: Number(r.filCod ?? filCod),
                            docTip: Number(r.docTip ?? 2),
                            docCod: Number(r.docCod),
                            titCod: Number(r.titCod ?? 1),
                            bxaCodSeq: Number(r.bxaCodSeq),
                            ...(r.bxaMnyLiquidoPermuta != null
                                ? { bxaMnyLiquidoPermuta: Number(r.bxaMnyLiquidoPermuta) }
                                : {}),
                            ...(r.borVldFinalizado != null
                                ? { borVldFinalizado: Number(r.borVldFinalizado) }
                                : {}),
                        }))
                        // Guard de identidade (Regis P1): docCod/bxaCodSeq são usados no DELETE da baixa
                        // no ERP — um NaN apagaria a baixa errada / quebraria o path. Descarta inválidos.
                        .filter((b) => Number.isFinite(b.docCod) && Number.isFinite(b.bxaCodSeq))
                );
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: `fin010/baixas/list/${borCod}`, cause });
        }
    };

    /**
     * Exclui UMA baixa de um borderô EM CADASTRO (antes de finalizar/aprovar).
     * `DELETE /fin010/baixas/{borCod}/{docTip}/{docCod}/{titCod}/{bxaCodSeq}` — o 2º segmento é o
     * **docTip** (tipo do documento, 2 = invoice), NÃO o filCod (este vai no header `cnx-filcod`).
     * A sonda inicial confundiu os dois porque na filial 2 o filCod coincide com o docTip 2.
     * Tentativa única (DELETE é idempotente; falha sobe pro caller). Lança `ConexosError`.
     */
    public excluirBaixa = async (params: {
        filCod: number;
        borCod: number;
        invoiceDocCod: number;
        titCod: number;
        bxaCodSeq: number;
        docTip?: number;
    }): Promise<void> => {
        const { filCod, borCod, invoiceDocCod, titCod, bxaCodSeq } = params;
        const docTip = params.docTip ?? 2; // 2 = título de invoice (default do fluxo de permuta)
        const path = `fin010/baixas/${borCod}/${docTip}/${invoiceDocCod}/${titCod}/${bxaCodSeq}`;
        try {
            await this.base.ensureSid();
            await this.base.deleteGeneric<unknown>(path, { filCod });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * Exclui o BORDERÔ inteiro (em cadastro) — `moduleBordero.delete`. Sonda HAR 2026-06-23:
     * `DELETE /fin010/{borCod}` — só o borCod no path; o filCod vai no header `cnx-filcod`
     * (≠ do GET, que usa /fin010/{filCod}/{borCod}). Tentativa única; lança `ConexosError`.
     */
    public excluirBordero = async (params: { filCod: number; borCod: number }): Promise<void> => {
        const { filCod, borCod } = params;
        const path = `fin010/${borCod}`;
        try {
            await this.base.ensureSid();
            await this.base.deleteGeneric<unknown>(path, { filCod });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * FINALIZA (aprova) o borderô — `moduleBordero.finalizar`. Sonda HAR: `POST /fin010/finalizar/{borCod}`
     * (body vazio; filCod no header). Tentativa única; lança `ConexosError`.
     *
     * `postGenericOnce` (NÃO `postGeneric`): a transição de estado do borderô é IRREVERSÍVEL do
     * ponto de vista do re-envio. O `postGeneric` re-posta o request depois de um 401 — e um 401
     * que chega DEPOIS de o ERP já ter aplicado a mudança faria a segunda tentativa agir sobre um
     * borderô que já mudou de estado (e, no caso do estorno/cancelamento, sobre um ciclo inteiro
     * de finalizar↔estornar). Mesma razão que moveu o `gravarBaixaPermuta` para `Once`: a falha
     * (incl. 401) sobe para o serviço e o operador confere no ERP, em vez de o cliente decidir
     * sozinho repetir uma escrita.
     */
    public finalizarBordero = async (params: { filCod: number; borCod: number }): Promise<void> => {
        const { filCod, borCod } = params;
        const path = `fin010/finalizar/${borCod}`;
        try {
            await this.base.ensureSid();
            await this.base.postGenericOnce<unknown>(path, {}, { filCod });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * CANCELA o borderô (em cadastro) — `POST /fin010/cancelar/{borCod}` (body vazio; filCod no header).
     * Tentativa única; lança `ConexosError`.
     *
     * `postGenericOnce` (NÃO `postGeneric`): a transição de estado do borderô é IRREVERSÍVEL do
     * ponto de vista do re-envio. O `postGeneric` re-posta o request depois de um 401 — e um 401
     * que chega DEPOIS de o ERP já ter aplicado a mudança faria a segunda tentativa agir sobre um
     * borderô que já mudou de estado (e, no caso do estorno/cancelamento, sobre um ciclo inteiro
     * de finalizar↔estornar). Mesma razão que moveu o `gravarBaixaPermuta` para `Once`: a falha
     * (incl. 401) sobe para o serviço e o operador confere no ERP, em vez de o cliente decidir
     * sozinho repetir uma escrita.
     */
    public cancelarBordero = async (params: { filCod: number; borCod: number }): Promise<void> => {
        const { filCod, borCod } = params;
        const path = `fin010/cancelar/${borCod}`;
        try {
            await this.base.ensureSid();
            await this.base.postGenericOnce<unknown>(path, {}, { filCod });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * ESTORNA o borderô FINALIZADO — `POST /fin010/estornar/{borCod}` (body vazio; filCod no header).
     * Desfaz a finalização: o borderô VOLTA para EM CADASTRO. Tentativa única; lança `ConexosError`.
     *
     * `postGenericOnce` (NÃO `postGeneric`): a transição de estado do borderô é IRREVERSÍVEL do
     * ponto de vista do re-envio. O `postGeneric` re-posta o request depois de um 401 — e um 401
     * que chega DEPOIS de o ERP já ter aplicado a mudança faria a segunda tentativa agir sobre um
     * borderô que já mudou de estado (e, no caso do estorno/cancelamento, sobre um ciclo inteiro
     * de finalizar↔estornar). Mesma razão que moveu o `gravarBaixaPermuta` para `Once`: a falha
     * (incl. 401) sobe para o serviço e o operador confere no ERP, em vez de o cliente decidir
     * sozinho repetir uma escrita.
     */
    public estornarBordero = async (params: { filCod: number; borCod: number }): Promise<void> => {
        const { filCod, borCod } = params;
        const path = `fin010/estornar/${borCod}`;
        try {
            await this.base.ensureSid();
            await this.base.postGenericOnce<unknown>(path, {}, { filCod });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * Lista os borderôs de PERMUTA (borVldTipo=2) de uma filial — `POST /fin010/list` (sonda HAR).
     * Fonte autoritativa da tela de gestão (situação ao vivo: em cadastro/finalizado/cancelado/
     * estornado vem do próprio registro). Best-effort: erro → lança `ConexosError` (o serviço trata).
     */
    public listBorderos = async (params: {
        filCod: number;
        pageSize?: number;
        /** Quando informado, filtra `borCod#IN` — busca PRECISA (sem perder por paginação). */
        borCods?: number[];
    }): Promise<BorderoListaItem[]> => {
        const { filCod, borCods } = params;
        // Com borCods: pageSize generoso (1000) — se o ERP aplicar `borCod#IN`, volta só os
        // casados; se IGNORAR o filtro, ainda assim cobre os borderôs recentes (alto borCod) da
        // filial, evitando perder o alvo por paginação. Sem borCods: a listagem normal (200).
        const pageSize = params.pageSize ?? (borCods ? 1000 : 200);
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const page = await this.base.listGenericPaginated<Record<string, unknown>>(
                    'fin010/list',
                    {
                        fieldList: [
                            'borCod',
                            'filCod',
                            'borDtaMvto',
                            'borVldFinalizado',
                            'borCodEstornado',
                            'vlrTotalLiquido',
                            'usnDesNomeCad',
                            'vldHasRemessaPgto',
                            'borTimCad',
                            'usnCodCad',
                        ],
                        filterList: {
                            'borVldTipo#EQ': 2,
                            ...(borCods && borCods.length > 0
                                ? { 'borCod#IN': borCods.map(String) }
                                : {}),
                        },
                        pageNumber: 1,
                        pageSize,
                        orderList: { orderList: [{ propertyName: 'borCod', order: 'desc' }] },
                    },
                    { filCod },
                );
                return (
                    (page.rows ?? [])
                        .map((r) => ({
                            borCod: Number(r.borCod),
                            filCod: Number(r.filCod ?? filCod),
                            ...(r.borDtaMvto != null ? { borDtaMvto: Number(r.borDtaMvto) } : {}),
                            ...(r.borVldFinalizado != null
                                ? { borVldFinalizado: Number(r.borVldFinalizado) }
                                : {}),
                            borCodEstornado:
                                r.borCodEstornado != null ? Number(r.borCodEstornado) : null,
                            ...(r.vlrTotalLiquido != null
                                ? { vlrTotalLiquido: Number(r.vlrTotalLiquido) }
                                : {}),
                            usnDesNomeCad: (r.usnDesNomeCad as string | null) ?? null,
                            ...camposDoGrupo(r),
                        }))
                        // Guard de identidade (Regis P1): descarta rows sem `borCod` numérico — um NaN
                        // viraria chave inválida no cache `permuta_bordero` / no status permuta→borderô.
                        .filter((b) => Number.isFinite(b.borCod))
                );
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010/list', cause });
        }
    };

    /** Passo 2 — valida o título da INVOICE; o ERP devolve `bxaMnyValor` + contas. */
    public validarTituloBaixa = async (params: {
        filCod: number;
        borCod: number;
        invoiceDocCod: number;
        titCod: number;
    }): Promise<Fin010ValidacaoResponse<TituloBaixaValidacao>> => {
        const { filCod, borCod, invoiceDocCod, titCod } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.postGeneric<Fin010ValidacaoResponse<TituloBaixaValidacao>>(
                    'fin010/baixas/validacao/tituloBaixa',
                    {
                        bxaVldSistema: 0,
                        docTip: 2,
                        bxaVldCcorrente: 0,
                        bxaVldCorrenteDc: 1,
                        filCod,
                        borCod,
                        borVldTipo: 2,
                        bxaVldAdto: 0,
                        frontModelName: 'baixa',
                        docCod: invoiceDocCod,
                        titCod,
                    },
                    { filCod },
                );
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010/baixas/validacao/tituloBaixa', cause });
        }
    };

    /** Passo 3 — valida o título da PERMUTA (adiantamento); devolve dados da permuta. */
    public validarTituloPermuta = async (params: {
        filCod: number;
        borCod: number;
        adiantamentoDocCod: number;
        bxaTitCod: number;
    }): Promise<Fin010ValidacaoResponse<TituloPermutaValidacao>> => {
        const { filCod, borCod, adiantamentoDocCod, bxaTitCod } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.postGeneric<Fin010ValidacaoResponse<TituloPermutaValidacao>>(
                    'fin010/baixas/validacao/tituloPermuta',
                    {
                        bxaTitCod,
                        bxaDocCod: adiantamentoDocCod,
                        bxaDocTip: 2,
                        borCod,
                        borVldTipo: 2,
                        filCod,
                    },
                    { filCod },
                );
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010/baixas/validacao/tituloPermuta', cause });
        }
    };

    /** Passo 4 — recalcula o valor líquido com o juros informado; devolve `bxaMnyLiquido`. */
    public atualizarValorLiquido = async (params: {
        filCod: number;
        borCod: number;
        invoiceDocCod: number;
        titCod: number;
        valor: number;
        juros: number;
        desconto?: number;
        multa?: number;
    }): Promise<Fin010ValidacaoResponse<{ bxaMnyLiquido: number }>> => {
        const { filCod, borCod, invoiceDocCod, titCod, valor, juros } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.postGeneric<Fin010ValidacaoResponse<{ bxaMnyLiquido: number }>>(
                    'fin010/baixas/validacao/atualizaValorLiquido',
                    {
                        titCod,
                        docTip: 2,
                        docCod: invoiceDocCod,
                        borCod,
                        borVldTipo: 2,
                        filCod,
                        bxaMnyMulta: params.multa ?? 0,
                        bxaMnyValor: valor,
                        bxaMnyDesconto: params.desconto ?? 0,
                        bxaMnyJuros: juros,
                    },
                    { filCod },
                );
            });
        } catch (cause) {
            throw new ConexosError({
                endpoint: 'fin010/baixas/validacao/atualizaValorLiquido',
                cause,
            });
        }
    };

    /**
     * Passo 5 — grava a baixa/permuta (o write efetivo). O `payload` é o objeto
     * consolidado dos passos 2/3/4 (montado pelo serviço a partir das respostas
     * do ERP + dados da alocação). Retorna a baixa gravada com `bxaCodSeq`.
     *
     * SEM RetryExecutor (Regis 2026-06-23, F-fault-tolerance-1) E SEM 401-retry
     * (via `postGenericOnce`): é a ESCRITA IRREVERSÍVEL. Um retry após
     * timeout-pós-sucesso — OU um re-POST silencioso do `authenticatedPost` após
     * um 401 que chegou pós-aplicação — gravaria uma baixa DUPLICADA
     * (super-pagamento, `bxaCodSeq` duplicado); a chave de idempotência local não
     * protege dentro de um retry interno. Tentativa ÚNICA de verdade; a falha
     * (incl. 401) sobe para o serviço marcar `error` e o operador conciliar manualmente.
     */
    public gravarBaixaPermuta = async (params: {
        filCod: number;
        payload: Record<string, unknown>;
    }): Promise<BaixaGravada> => {
        const { filCod, payload } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>('fin010/baixas', payload, {
                filCod,
            });
            // Zod no boundary (Regis P0 integrability): só marcamos `settled` com um `bxaCodSeq`
            // numérico confirmado pelo ERP. Resposta sem isso aborta (vira `error` na reconciliação).
            return BAIXA_GRAVADA_SCHEMA.parse(raw);
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin010/baixas', cause });
        }
    };
}

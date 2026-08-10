import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ExtratoTruncadoError from '../errors/ExtratoTruncadoError.js';
import Logger from '../libs/logger/Logger.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * ConexosExtratoClient — leitura da superfície de EXTRATOS BANCÁRIOS do Conexos
 * (Frente IV, Módulo 1).
 *
 * READ-ONLY por contrato: só endpoints de listagem. Nenhuma escrita (a baixa do
 * recebível é `fin014` e vive fora deste client — Fase 5, gated).
 *
 * Fontes (confirmadas em produção via `jobs/probe-fin134.ts` + `probe-extratos-fase2/3`):
 *   - `fin133/list` → contas financeiras da filial (`gerNum` + `gerDes` + saldos)
 *   - `fin095/list` → LANÇAMENTOS do extrato bancário, filtrados por `gerNum`
 *
 * A tela `fin134` ("Importação de Extratos Bancários") lista os ARQUIVOS `.RET`
 * importados, não os lançamentos — por isso a fonte dos créditos é o `fin095`.
 * O `gerNum` que este client devolve é a mesma "Conta Financeira de Baixa" que o
 * `fin014` exigirá na Fase 5.
 */

/**
 * Coerção tolerante (aceita string numérica; senão `undefined`).
 *
 * O `preprocess` é obrigatório: `z.coerce.number()` converte `null` em **0**, e o
 * `fin095` manda `exiMnyLctoCr: null` na maioria das linhas. Sem isso, o
 * `exiMnyLctoCr ?? exiMnyLcto` do mapper pegaria o zero e descartaria o
 * lançamento inteiro como "sem valor".
 */
const numOpt = z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.coerce.number().optional().catch(undefined),
);
const strOpt = z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .optional()
    .catch(undefined);
/** Identidade wire aceita number|string → string (nunca coalesce). */
const wireId = z.union([z.number(), z.string()]).transform((v) => String(v));

/**
 * Row do `fin133` — uma conta financeira. `gerNum` é obrigatório: é a chave de
 * tudo abaixo (e a "Conta Financeira de Baixa" do `fin014`).
 */
const contaRowSchema = z
    .object({
        gerNum: z.coerce.number().int(),
        gerDes: strOpt,
        bncCod: strOpt,
        bncDesNome: strOpt,
        ccoCod: strOpt,
        qtdeSistema: numOpt,
        qtdeBanco: numOpt,
    })
    .passthrough();

/**
 * Row do `fin095` — um lançamento de extrato.
 *
 * Obrigatórios: `extCod`+`exiCodSeq` (identidade), `exiDtaLcto` (quando) e
 * `exiVldTipo` (crédito×débito). Uma linha sem eles não tem identidade nem
 * semântica — é DESCARTADA com warn, nunca coalescida para zero.
 */
const lancamentoRowSchema = z
    .object({
        extCod: wireId,
        exiCodSeq: wireId,
        exiDtaLcto: z.coerce.number(),
        exiVldTipo: z.coerce.number().int(),
        exiMnyLcto: numOpt,
        exiMnyLctoCr: numOpt,
        exiMnyLctoDeb: numOpt,
        exiEspNrdocto: strOpt,
        exiEspHistorico: strOpt,
        exiEspLinha: strOpt,
        exiEspCategoria: strOpt,
        exiEspCategoriaDesc: strOpt,
        exiDtaCtbLcto: numOpt,
        vldConciliado: numOpt,
        vldStatusConciliacao: strOpt,
        dtaConc: numOpt,
    })
    .passthrough();

type LancamentoRow = z.infer<typeof lancamentoRowSchema>;

/** `exiVldTipo` do `fin095`: 1 = débito, 2 = crédito (confirmado em produção). */
export const EXI_VLD_TIPO = { DEBITO: 1, CREDITO: 2 } as const;

/** Conta financeira da filial (`fin133`). */
export interface ContaFinanceira {
    /** Chave da conta — é a "Conta Financeira de Baixa" do `fin014`. */
    gerNum: number;
    /** Descrição legível: `"BANCO ITAÚ - AG. 0641 CONTA 55.795-4"`. */
    gerDes?: string;
    bncCod?: string;
    bncDesNome?: string;
    ccoCod?: string;
    /** Nº de lançamentos do lado SISTEMA — usado para pular contas sem movimento. */
    qtdeSistema?: number;
    /** Nº de lançamentos do lado BANCO — idem. */
    qtdeBanco?: number;
}

/** Lançamento de extrato bancário (`fin095`), já normalizado no boundary. */
export interface LancamentoExtrato {
    /** Identidade wire (metade 1) — extrato de origem. */
    extCod: string;
    /** Identidade wire (metade 2) — sequência dentro do extrato. */
    exiCodSeq: string;
    /** Vem do PARÂMETRO da consulta: a linha traz `gerNum` nulo. */
    gerNum: number;
    /**
     * ⚠️ NÃO existe `filCod` aqui — de propósito (ADR-0032). O `filCod` do
     * `listLancamentos` é só o header de sessão; o `fin095` filtra por `gerNum` +
     * janela e devolve o MESMO extrato para qualquer filial. Expor o parâmetro
     * como se fosse dado da linha foi exatamente o que pôs a filial na chave
     * natural e duplicou a carteira uma vez por filial.
     */
    dataLancamento: Date;
    tipo: 'CREDITO' | 'DEBITO';
    /** SEMPRE positivo — o sinal vive em `tipo`. */
    valor: number;
    /**
     * `exiEspHistorico` cru. **Truncado em ~24 caracteres pelo banco**
     * (`"SISPAG  BELLIZ INDUSTRIA"`) e sem CNPJ/`pesCod`. É dica de exibição —
     * NUNCA use como chave de junção com cliente ou processo.
     */
    historico?: string;
    numeroDocumento?: string;
    /** Linha CNAB crua quando o ERP a expõe (veio nula nas amostras). */
    linhaBruta?: string;
    categoria?: string;
    categoriaDesc?: string;
    /**
     * Conciliação do PRÓPRIO ERP (banco × extrato-sistema). NÃO é a nossa
     * conciliação (crédito × processo do cliente) — não mapear uma na outra.
     */
    conciliadoNoErp: boolean;
    statusConciliacaoErp?: string;
    /** Row wire íntegra (auditoria + reprocessamento). */
    raw: Record<string, unknown>;
}

export interface ListLancamentosParams {
    filCod: number;
    gerNum: number;
    de: Date;
    ate: Date;
    /** Default `CREDITO`. Passe `undefined` explicitamente para trazer todos. */
    exiVldTipo?: number;
}

@singleton()
@injectable()
export default class ConexosExtratoClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /** Body de query padrão do Conexos (`/list`). */
    private listBody = (
        serviceName: string,
        filterList: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
        fieldList: [],
        filterList,
        serviceName,
    });

    /**
     * Contas financeiras da filial (`fin133/list`, sem filtro).
     *
     * O `gerDes` é a descrição que aparece no `fin014` como "Conta Financeira de
     * Baixa" — a mesma string, o mesmo `gerNum`.
     */
    public listContas = async (filCod: number): Promise<ContaFinanceira[]> => {
        const rows = await this.base.paginate<Record<string, unknown>>({
            endpoint: 'fin133/list',
            bodyBase: this.listBody('fin133'),
            opts: { filCod },
        });

        let descartadas = 0;
        const contas = rows.flatMap((row) => {
            const parsed = contaRowSchema.safeParse(row);
            if (!parsed.success) {
                descartadas += 1;
                return [];
            }
            const r = parsed.data;
            return [
                {
                    gerNum: r.gerNum,
                    gerDes: r.gerDes,
                    bncCod: r.bncCod,
                    bncDesNome: r.bncDesNome,
                    ccoCod: r.ccoCod,
                    qtdeSistema: r.qtdeSistema,
                    qtdeBanco: r.qtdeBanco,
                },
            ];
        });

        if (descartadas > 0) {
            Logger.warn(
                `[EXTRATO] fin133/list filial ${filCod}: ${descartadas} conta(s) sem gerNum válido descartada(s)`,
            );
        }
        return contas;
    };

    /**
     * Lançamentos de extrato de UMA conta, numa janela de datas (`fin095/list`).
     *
     * `exiDtaLcto` é epoch-ms no wire; os operadores de range `#GE`/`#LE` foram
     * confirmados em produção. Sem o filtro de tipo a conta devolve o extrato
     * inteiro (28k linhas na conta 38) — por isso o default é só CRÉDITO.
     *
     * Se o `paginate` bater no teto de páginas, LANÇA `ExtratoTruncadoError` em
     * vez de devolver uma lista silenciosamente incompleta: uma ingestão que grava
     * metade do extrato reportando sucesso é pior que uma que falha alto.
     */
    public listLancamentos = async (
        params: ListLancamentosParams,
    ): Promise<LancamentoExtrato[]> => {
        const { filCod, gerNum, de, ate } = params;
        const exiVldTipo = 'exiVldTipo' in params ? params.exiVldTipo : EXI_VLD_TIPO.CREDITO;

        const filterList: Record<string, unknown> = {
            gerNum,
            'exiDtaLcto#GE': de.getTime(),
            'exiDtaLcto#LE': ate.getTime(),
        };
        if (exiVldTipo !== undefined) filterList.exiVldTipo = exiVldTipo;

        let truncou = false;
        const rows = await this.base.paginate<Record<string, unknown>>({
            endpoint: 'fin095/list',
            bodyBase: this.listBody('fin095', filterList),
            opts: { filCod },
            onCapHit: () => {
                truncou = true;
            },
        });

        if (truncou) {
            throw new ExtratoTruncadoError({ filCod, gerNum, de, ate, lidas: rows.length });
        }

        let descartadas = 0;
        const lancamentos = rows.flatMap((row) => {
            const parsed = lancamentoRowSchema.safeParse(row);
            if (!parsed.success) {
                descartadas += 1;
                return [];
            }
            const mapeado = this.mapLancamento(parsed.data, row, gerNum);
            if (mapeado === null) {
                descartadas += 1;
                return [];
            }
            return [mapeado];
        });

        if (descartadas > 0) {
            Logger.warn(
                `[EXTRATO] fin095/list filial ${filCod} conta ${gerNum}: ${descartadas} lançamento(s) inválido(s) descartado(s)`,
            );
        }
        return lancamentos;
    };

    /**
     * Mapeia uma row do `fin095`. Devolve `null` quando o lançamento não tem valor
     * utilizável — um lançamento de valor zero/NaN não é conciliável e entraria na
     * carteira só para poluir a fila do analista.
     */
    private mapLancamento = (
        r: LancamentoRow,
        raw: Record<string, unknown>,
        gerNum: number,
    ): LancamentoExtrato | null => {
        const tipo = r.exiVldTipo === EXI_VLD_TIPO.CREDITO ? 'CREDITO' : 'DEBITO';
        // O ERP às vezes só preenche `exiMnyLcto` (Cr/Deb vieram nulos nas amostras).
        const bruto =
            tipo === 'CREDITO'
                ? (r.exiMnyLctoCr ?? r.exiMnyLcto)
                : (r.exiMnyLctoDeb ?? r.exiMnyLcto);
        const valor = Math.abs(Number(bruto ?? 0));
        if (!Number.isFinite(valor) || valor === 0) return null;

        return {
            extCod: r.extCod,
            exiCodSeq: r.exiCodSeq,
            gerNum,
            dataLancamento: this.base.parseDate(r.exiDtaLcto),
            tipo,
            valor,
            historico: r.exiEspHistorico,
            numeroDocumento: r.exiEspNrdocto,
            linhaBruta: r.exiEspLinha,
            categoria: r.exiEspCategoria,
            categoriaDesc: r.exiEspCategoriaDesc,
            conciliadoNoErp: r.vldConciliado === 1,
            statusConciliacaoErp: r.vldStatusConciliacao,
            raw,
        };
    };
}

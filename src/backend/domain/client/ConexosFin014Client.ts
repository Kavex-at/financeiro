import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ConexosError from '../errors/ConexosError.js';
import type {
    Fin014BaixaGravada,
    Fin014BorderoCriado,
    Fin014TituloBaixaValidacao,
    Fin014TituloReceber,
} from '../interface/permutas/Fin014Recebimento.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/** Envelope `{ messages, responseData }` das validações fin014 (`valid='ERRO'` chega com HTTP 200). */
interface Fin014ValidacaoResponse<T> {
    messages?: Array<{ valid?: string; message?: string; vars?: Record<string, unknown> }>;
    responseData?: T;
}

/** Zod no boundary da criação do borderô — sem `borCod` numérico, abortamos (não cria borderô fantasma). */
const BORDERO_CRIADO_SCHEMA = z.object({
    borCod: z.coerce.number().int().positive(),
    filCod: z.coerce.number().int().optional().default(0),
    borDtaMvto: z.coerce.number().optional().default(0),
    // O ERP ecoa a descrição da conta financeira na criação — reusada no payload da baixa (HAR 15-55).
    gerDes: z.string().nullish(),
});

/** Zod no boundary do LOV `TituloBorderoReceber` — o título a-receber REAL a baixar (docCod/titCod/número). */
const TITULO_RECEBER_SCHEMA = z.object({
    rows: z
        .array(
            z
                .object({
                    docCod: z.coerce.number().int(),
                    titCod: z.coerce.number().int(),
                    titEspNumero: z.coerce.string(),
                    titMnyAberto: z.coerce.number().nullish(),
                })
                .passthrough(),
        )
        .default([]),
});

/** Zod no boundary da baixa gravada — sem `bxaCodSeq`, não há confirmação persistida. */
const BAIXA_GRAVADA_SCHEMA = z.object({
    bxaCodSeq: z.coerce.number().int().positive(),
    borCod: z.coerce.number().int().optional().default(0),
    docCod: z.coerce.number().optional().default(0),
    bxaMnyValor: z.coerce.number().optional().default(0),
    bxaMnyLiquido: z.coerce.number().optional().default(0),
});

/**
 * Conexos ERP `fin014` write family (RECEBIMENTO DO CRÉDITO — Tela 2 do guia "telas Conexos").
 * ESPELHA `ConexosBaixaClient` (fin010): mesma doutrina de borderô+baixa, Zod no boundary,
 * `ConexosError` no catch, `ensureSid` antes de cada chamada, `postGenericOnce` na ESCRITA
 * IRREVERSÍVEL (gravar baixa) — um re-POST duplicaria o recebimento. Difere do fin010: a-receber
 * (docTip=1), UM borderô por recebimento, conta financeira (`gerNum`) informada pelo caller (FIN_134).
 * Rotas confirmadas por probe read-only (borderô list/detalhe) 2026-07-31; corpos derivados do bundle.
 */
@singleton()
@injectable()
export default class ConexosFin014Client {
    private base: ConexosBaseClient;

    constructor(@inject(ConexosBaseClient) base: ConexosBaseClient) {
        this.base = base;
    }

    /**
     * Passo 1 — cria o borderô de recebimento e retorna o `borCod`. `postGeneric` (401-retry ok, SEM
     * RetryExecutor): re-POST pós-timeout criaria borderô duplicado, mas um borderô sem baixa é inócuo
     * (vazio); mesmo trade-off do fin010 criarBordero.
     */
    public criarBordero = async (params: {
        filCod: number;
        dataMovto: number;
        gerNum: number;
    }): Promise<Fin014BorderoCriado> => {
        const { filCod, dataMovto, gerNum } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGeneric<unknown>(
                'fin014',
                {
                    filCod,
                    // borVldTipo=1 = borderô "a RECEBER" (fin014 = Baixa de Títulos a Receber). O fin010
                    // (a pagar) usa 2; o servidor rejeita a criação sem este campo (`borVldTipo required`,
                    // live 2026-08-02). Fixo pelo tipo de documento, não parametrizado.
                    borVldTipo: 1,
                    borDtaMvto: dataMovto,
                    borVldFinalizado: 0,
                    frontModelName: 'bordero',
                    gerNum,
                },
                { filCod },
            );
            const { gerDes, ...parsed } = BORDERO_CRIADO_SCHEMA.parse(raw);
            return { ...parsed, ...(gerDes != null ? { gerDes } : {}) };
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin014', cause });
        }
    };

    /**
     * Passo 2a — o título a-receber REAL do documento (LOV `TituloBorderoReceber`, filtrado pelo docCod).
     * O `titCod` NÃO é 1 fixo (live 2026-08-02: `RECORDNOTFOUND FinBaixa titCod:1`) — vem daqui, junto do
     * `titEspNumero` que a validação/baixa exigem. Só aparece depois que a SN está FINALIZADA com valor.
     */
    public listTitulosBorderoReceber = async (params: {
        filCod: number;
        docCod: number;
    }): Promise<Fin014TituloReceber[]> => {
        const { filCod, docCod } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<unknown>(
                    'lov/TituloBorderoReceber',
                    {
                        fieldList: ['docCod', 'titCod', 'titEspNumero', 'titMnyAberto'],
                        filterList: { 'docCod#EQ': docCod, borVldFinalizado: 0, exibirTitulos: 1 },
                        pageNumber: 1,
                        orderBy: 'asc',
                        sortBy: 'titCod',
                    },
                    { filCod },
                );
                return TITULO_RECEBER_SCHEMA.parse(raw).rows.map((r) => ({
                    docCod: r.docCod,
                    titCod: r.titCod,
                    titEspNumero: r.titEspNumero,
                    ...(r.titMnyAberto != null ? { titMnyAberto: r.titMnyAberto } : {}),
                }));
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'lov/TituloBorderoReceber', cause });
        }
    };

    /** Passo 2b — valida o título a receber (docCod/titCod/titEspNumero reais); o ERP devolve o em-aberto vivo. */
    public validarTituloBaixa = async (params: {
        filCod: number;
        borCod: number;
        docCod: number;
        titCod: number;
        titEspNumero: string;
    }): Promise<Fin014ValidacaoResponse<Fin014TituloBaixaValidacao>> => {
        const { filCod, borCod, docCod, titCod, titEspNumero } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                return this.base.postGeneric<Fin014ValidacaoResponse<Fin014TituloBaixaValidacao>>(
                    'fin014/baixas/validacao/tituloBaixa',
                    {
                        filCod,
                        borCod,
                        // borVldTipo=1 (a receber) — obrigatório aqui também; sem ele o servidor dá NPE
                        // (`java.lang.Long.toString() because borVldTipo is null`, live 2026-08-02).
                        borVldTipo: 1,
                        docTip: 1,
                        docCod,
                        titCod,
                        titEspNumero,
                        borVldFinalizado: 0,
                    },
                    { filCod },
                );
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin014/baixas/validacao/tituloBaixa', cause });
        }
    };

    /**
     * Passo 3 — grava a baixa (recebimento). ESCRITA IRREVERSÍVEL → `postGenericOnce` (sem 401-retry),
     * tentativa única, como `gravarBaixaPermuta` do fin010. Retorna a baixa com `bxaCodSeq`.
     */
    public gravarBaixa = async (params: {
        filCod: number;
        payload: Record<string, unknown>;
    }): Promise<Fin014BaixaGravada> => {
        const { filCod, payload } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>('fin014/baixas', payload, {
                filCod,
            });
            return BAIXA_GRAVADA_SCHEMA.parse(raw);
        } catch (cause) {
            throw new ConexosError({ endpoint: 'fin014/baixas', cause });
        }
    };

    /** Passo 4 — finaliza o borderô de recebimento. `POST /api/fin014/finalizar/{borCod}` (body vazio). */
    public finalizarBordero = async (params: { filCod: number; borCod: number }): Promise<void> => {
        const { filCod, borCod } = params;
        const path = `fin014/finalizar/${borCod}`;
        try {
            await this.base.ensureSid();
            await this.base.postGeneric<unknown>(path, {}, { filCod });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };
}

import { inject, injectable, singleton } from 'tsyringe';
import { z } from 'zod';
import ConexosError from '../errors/ConexosError.js';
import { NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO } from '../interface/recebimentos/constants.js';
import type {
    DocFiscal,
    DocStatusFiscal,
    ObservacoesFiscais,
    ValidacaoDocumento,
} from '../interface/recebimentos/NdeFiscal.js';
import ConexosBaseClient from './ConexosBaseClient.js';

/**
 * Boundary Zod do com300 (fiscal). `.passthrough()` preserva os ~73 campos p/ o read-modify-write —
 * só EXIGIMOS os identificadores + `fisVldTipoNfDebito` (o alvo/discriminador). `fisVldTipoNfCredito`
 * é preservado mas intocado.
 */
const DOC_FISCAL_SCHEMA = z
    .object({
        filCod: z.coerce.number().int(),
        docTip: z.coerce.number().int(),
        docCod: z.coerce.number().int(),
        fisCod: z.coerce.number().int(),
        fisVldTipoNfDebito: z.coerce.number().int(),
    })
    .passthrough();

/** Boundary do com131 — `fisEspObs` é o discriminador (preenchido ⟺ observação gerada). */
const OBSERVACOES_SCHEMA = z
    .object({
        fisEspObs: z.string().nullish(),
        docMemObs: z.string().nullish(),
        fisEspInfadfisco: z.string().nullish(),
    })
    .passthrough();

/** Boundary do poll com297 — todos opcionais/coeridos (só lemos status). */
const DOC_STATUS_SCHEMA = z
    .object({
        vldAutorizado: z.coerce.number().int().optional(),
        docVldNfehom: z.coerce.number().int().optional(),
        vldStatus: z.coerce.number().int().optional(),
        vldTpNf: z.union([z.string(), z.number()]).optional(),
        docVldConferencia: z.coerce.number().int().optional(),
        vldEnviarConferencia: z.coerce.number().int().optional(),
        docMnyValor: z.coerce.number().optional(),
        docEspNumero: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough();

const VALIDACAO_ROW_SCHEMA = z
    .object({
        fdvCodSeq: z.coerce.number().int().optional(),
        fdvEspErr: z.string().nullish(),
        fdvEspObs: z.string().nullish(),
        fdvVldErr: z.coerce.number().int().optional(),
    })
    .passthrough();

/**
 * ConexosNdeFiscalClient — a leg FISCAL da Nota de Débito Eletrônica, capturada por HAR real (doc
 * 18337). Fecha o GAP `nota-debito-fiscal` que o writer permutas deixava fail-closed. QUATRO contratos
 * DISTINTOS, cada um com seu Zod e seu discriminador de sucesso — a spec proíbe reusar UM helper:
 *   (a) com300 — fiscal, read-modify-write: GET o objeto INTEIRO → seta `fisVldTipoNfDebito=6` → PUT
 *       o objeto inteiro. Sucesso ⟺ eco `fisVldTipoNfDebito === 6`. `putGenericOnce` (RMW não-retryable).
 *   (b) com131 — observações: `POST geraObs {docTip,docCod}`. Sucesso ⟺ `fisEspObs` preenchido.
 *   (c) com194 — validações (leitura), logadas quando a homologação volta `docVldComvalidacoes===2`.
 *   (poll) com297 — `GET com297/{docCod}` p/ pré-condição + `vldAutorizado` (SEFAZ é assíncrono).
 * A HOMOLOGAÇÃO em si vive no `ConexosNdeClient` (discriminador `docVldComvalidacoes`). `filCod` SEMPRE
 * no header (`Cnx-filCod`), nunca na URL. Ver `_inbox/recebimentos-numerario-real-fiscal-spec.md`.
 */
@singleton()
@injectable()
export default class ConexosNdeFiscalClient {
    public constructor(@inject(ConexosBaseClient) private readonly base: ConexosBaseClient) {}

    /** (a) leitura do RMW — devolve o `finDocFiscal` INTEIRO. `GET com300/{docTip}/{docCod}/{fisCod}`. */
    public lerDocFiscal = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
        fisCod: number;
    }): Promise<DocFiscal> => {
        const { filCod, docTip, docCod, fisCod } = params;
        const path = `com300/${docTip}/${docCod}/${fisCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.getGeneric<unknown>(path, { filCod });
                return DOC_FISCAL_SCHEMA.parse(raw) as DocFiscal;
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * (a) escrita do RMW — `PUT com300` com o objeto INTEIRO (`fisVldTipoNfDebito=6` já setado pelo
     * caller). Sem id na URL. Tentativa ÚNICA (`putGenericOnce`). **Sucesso ⟺ `fisVldTipoNfDebito===6`.**
     */
    public gravarDocFiscal = async (params: {
        filCod: number;
        finDocFiscal: DocFiscal;
    }): Promise<DocFiscal> => {
        const { filCod, finDocFiscal } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.putGenericOnce<unknown>(
                'com300',
                finDocFiscal as Record<string, unknown>,
                { filCod },
            );
            const eco = DOC_FISCAL_SCHEMA.parse(raw) as DocFiscal;
            if (eco.fisVldTipoNfDebito !== NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO) {
                throw new ConexosError({
                    endpoint: 'com300',
                    cause: new Error(
                        `PUT com300 nao gravou fisVldTipoNfDebito=${NDE_FISCAL_TIPO_NF_DEBITO_PAGAMENTO_ANTECIPADO} (eco=${eco.fisVldTipoNfDebito})`,
                    ),
                });
            }
            return eco;
        } catch (cause) {
            if (cause instanceof ConexosError) throw cause;
            throw new ConexosError({ endpoint: 'com300', cause });
        }
    };

    /** (b) leitura das observações — guard de idempotência do `geraObs`. `GET com131/{docTip}/{docCod}`. */
    public lerObservacoes = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
    }): Promise<ObservacoesFiscais> => {
        const { filCod, docTip, docCod } = params;
        const path = `com131/${docTip}/${docCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.getGeneric<unknown>(path, { filCod });
                const o = OBSERVACOES_SCHEMA.parse(raw);
                return {
                    ...(o.fisEspObs != null ? { fisEspObs: o.fisEspObs } : {}),
                    ...(o.docMemObs != null ? { docMemObs: o.docMemObs } : {}),
                    ...(o.fisEspInfadfisco != null ? { fisEspInfadfisco: o.fisEspInfadfisco } : {}),
                };
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };

    /**
     * (b) gera as observações SINIEF a partir do tipo de nota de débito. `POST com131/geraObs`
     * `{docTip,docCod}` (2 campos; `filCod` no header). **Sucesso ⟺ `fisEspObs` preenchido.**
     */
    public gerarObservacoes = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
    }): Promise<ObservacoesFiscais> => {
        const { filCod, docTip, docCod } = params;
        try {
            await this.base.ensureSid();
            const raw = await this.base.postGenericOnce<unknown>(
                'com131/geraObs',
                { docTip, docCod },
                { filCod },
            );
            const o = OBSERVACOES_SCHEMA.parse(raw);
            if (o.fisEspObs == null || o.fisEspObs.trim() === '') {
                throw new ConexosError({
                    endpoint: 'com131/geraObs',
                    cause: new Error('geraObs nao retornou fisEspObs'),
                });
            }
            return {
                fisEspObs: o.fisEspObs,
                ...(o.docMemObs != null ? { docMemObs: o.docMemObs } : {}),
                ...(o.fisEspInfadfisco != null ? { fisEspInfadfisco: o.fisEspInfadfisco } : {}),
            };
        } catch (cause) {
            if (cause instanceof ConexosError) throw cause;
            throw new ConexosError({ endpoint: 'com131/geraObs', cause });
        }
    };

    /**
     * (c) validações do com194 — leitura p/ log quando a homologação volta `docVldComvalidacoes===2`.
     * `GET initialValues` (contagem) + `POST documento/list` (linhas com `fdvVldTperr:1`).
     */
    public listValidacoes = async (params: {
        filCod: number;
        docTip: number;
        docCod: number;
    }): Promise<ValidacaoDocumento[]> => {
        const { filCod, docTip, docCod } = params;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.postGeneric<{ rows?: unknown[] } | unknown[]>(
                    'com194/documento/list',
                    {
                        fieldList: [],
                        filterList: { docTip, docCod, fdvVldTperr: 1 },
                        pageNumber: 1,
                        pageSize: 20,
                        orderList: { orderList: [{ propertyName: 'docCod', order: 'asc' }] },
                    },
                    { filCod },
                );
                const rows = Array.isArray(raw) ? raw : (raw?.rows ?? []);
                return rows.map((r) => VALIDACAO_ROW_SCHEMA.parse(r) as ValidacaoDocumento);
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: 'com194/documento/list', cause });
        }
    };

    /**
     * (poll) status do documento com297 — pré-condição de homologação (`docVldConferencia`/
     * `vldEnviarConferencia`), roteamento (`vldTpNf`) e poll de autorização SEFAZ (`vldAutorizado`).
     * `GET com297/{docCod}`. Leitura; `runWithRetry` re-`ensureSid` a cada tentativa (cookie expira).
     */
    public lerDocParaPolling = async (params: {
        filCod: number;
        docCod: number;
    }): Promise<DocStatusFiscal> => {
        const { filCod, docCod } = params;
        const path = `com297/${docCod}`;
        try {
            return await this.base.runWithRetry(async () => {
                await this.base.ensureSid();
                const raw = await this.base.getGeneric<unknown>(path, { filCod });
                const o = DOC_STATUS_SCHEMA.parse(raw);
                return {
                    ...(o.vldAutorizado != null ? { vldAutorizado: o.vldAutorizado } : {}),
                    ...(o.docVldNfehom != null ? { docVldNfehom: o.docVldNfehom } : {}),
                    ...(o.vldStatus != null ? { vldStatus: o.vldStatus } : {}),
                    ...(o.vldTpNf != null ? { vldTpNf: String(o.vldTpNf) } : {}),
                    ...(o.docVldConferencia != null
                        ? { docVldConferencia: o.docVldConferencia }
                        : {}),
                    ...(o.vldEnviarConferencia != null
                        ? { vldEnviarConferencia: o.vldEnviarConferencia }
                        : {}),
                    ...(o.docMnyValor != null ? { docMnyValor: o.docMnyValor } : {}),
                    ...(o.docEspNumero != null ? { docEspNumero: String(o.docEspNumero) } : {}),
                };
            });
        } catch (cause) {
            throw new ConexosError({ endpoint: path, cause });
        }
    };
}

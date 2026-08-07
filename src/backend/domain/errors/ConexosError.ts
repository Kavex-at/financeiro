import type { HandlerError } from '../libs/handler/HandlerError.js';
import ErpAccessDenied from './ErpAccessDenied.js';
import ErpResponseReader from './ErpResponseReader.js';

export type ConexosErrorCode =
    | 'CONEXOS_UPSTREAM_TIMEOUT'
    | 'CONEXOS_UPSTREAM_ERROR'
    | 'CONEXOS_UPSTREAM_REJECTED'
    | 'CONEXOS_ACCESS_DENIED';

/**
 * Thrown by `ConexosClient` when an upstream Conexos call fails. Three flavours — the first two
 * picked at the throw site, the third derived from the upstream status:
 *   - `CONEXOS_UPSTREAM_TIMEOUT`  — request exceeded its deadline / socket idle
 *   - `CONEXOS_UPSTREAM_ERROR`    — 5xx, unexpected payload, network reset, etc.
 *   - `CONEXOS_UPSTREAM_REJECTED` — the ERP answered 4xx: a verdict on the request itself
 *
 * A distinção importa porque decide DUAS coisas que antes eram sempre as mesmas:
 *
 *   1. **Se retentar.** Timeout e 5xx são indisponibilidade — a retentativa pode vencer. Um 4xx é
 *      veredito: repetir devolve a mesma resposta, palavra por palavra. A política central de retry
 *      (`RecebimentoPipelineService`) já dizia isso; nada nunca marcava `retryable: false`, então
 *      toda recusa custava N chamadas ao ERP antes de falhar igual.
 *   2. **O que o analista lê.** Antes, uma recusa determinística chegava à modal como "tente novamente
 *      em alguns minutos" — conselho que nunca funcionaria. Agora ela chega com a razão do próprio ERP.
 *
 * O caso que forçou a mudança: `POST fin014/finalizar/{borCod}` devolvendo 400
 * `CODIGO_IDENTIFICADOR_REGISTRO_EXISTENTE` no HML (defeito de ambiente do lado da Conexos,
 * `docs/e2e/fin014-finalizacao-hml-diagnostico.md`). Determinístico, e o produto mandava insistir.
 *
 * Status HTTP para fora: 504 quando é indisponibilidade (estamos represando um upstream lento),
 * **502** quando é recusa (o upstream respondeu, e respondeu "não").
 */
export default class ConexosError extends Error implements HandlerError {
    public readonly endpoint: string;
    public readonly priCod?: string;
    public readonly cause?: unknown;
    public readonly code: ConexosErrorCode;
    public readonly userMessage: string;
    public readonly retryable: boolean;
    public readonly statusCode: number;
    public readonly details?: unknown;

    constructor(params: {
        endpoint: string;
        priCod?: string;
        message?: string;
        cause?: unknown;
        code?: ConexosErrorCode;
    }) {
        super(params.message ?? `Conexos call to ${params.endpoint} failed`);
        this.name = 'ConexosError';
        this.endpoint = params.endpoint;
        this.priCod = params.priCod;
        this.cause = params.cause;
        // Um timeout declarado pelo caller vence a leitura do status: sem veredito do servidor não há
        // recusa a classificar (um status na cadeia de `cause` seria de outra resposta, anterior).
        const rejected =
            params.code !== 'CONEXOS_UPSTREAM_TIMEOUT' &&
            ErpResponseReader.isDeterministicRefusal(params.cause);
        // Permissão negada é uma recusa como as outras (repetir não muda nada), mas separá-la vale
        // pelo desfecho: o envelope já diz qual tela falta e quem libera, e 403 conta ao cliente que
        // o problema é de ACESSO — não do dado enviado, que é o que um 502 sugere.
        const accessDenied = rejected ? ErpAccessDenied.parse(params.cause) : undefined;
        this.code = accessDenied
            ? 'CONEXOS_ACCESS_DENIED'
            : rejected
              ? 'CONEXOS_UPSTREAM_REJECTED'
              : (params.code ?? 'CONEXOS_UPSTREAM_ERROR');
        this.retryable = !rejected;
        this.statusCode = accessDenied ? 403 : rejected ? 502 : 504;
        this.userMessage = accessDenied
            ? ErpAccessDenied.describe(accessDenied)
            : ConexosError.buildUserMessage(this.code, params.cause);
        this.details = { endpoint: params.endpoint, priCod: params.priCod };
    }

    /**
     * A frase que o analista lê na modal. Na recusa ela carrega a razão CRUA do ERP (`vars.msg` ou a
     * key) — é o que permite agir — e nunca sugere repetir, que seria o conselho errado. Em PT-BR por
     * ser texto de operação; o log técnico segue em inglês.
     */
    private static buildUserMessage = (code: ConexosErrorCode, cause: unknown): string => {
        if (code === 'CONEXOS_UPSTREAM_TIMEOUT') {
            return 'O ERP Conexos demorou demais para responder. Tente novamente em alguns minutos.';
        }
        if (code !== 'CONEXOS_UPSTREAM_REJECTED') {
            return 'O ERP Conexos retornou um erro. Tente novamente em alguns minutos.';
        }
        const reason = ErpResponseReader.rawReasonOf(cause);
        const acao =
            'Repetir não muda o resultado — corrija o dado apontado ou acione o suporte do ERP.';
        return reason !== undefined
            ? `O ERP Conexos recusou esta operação: ${reason}. ${acao}`
            : `O ERP Conexos recusou esta operação. ${acao}`;
    };
}

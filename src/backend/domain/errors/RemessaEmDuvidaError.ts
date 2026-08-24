import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * FAIL-CLOSED. Existe uma execução de remessa `reconciling` órfã para este lote: uma sequência
 * de escritas no fin015 foi iniciada e não confirmou. O estado real no ERP é DESCONHECIDO —
 * pode haver um lote nativo criado, títulos importados, ou até uma remessa gerada.
 *
 * Re-executar seria a única coisa pior do que parar: `criarLote`/`importarTitulos`/`gerarRemessa`
 * não são idempotentes, e um segundo lote significa pagar duas vezes. Exige conciliação humana:
 * olhar o `native_flp_cod` da trilha no fin015, cancelar o órfão, e só então liberar.
 *
 * Espelha a doutrina de `GerarSolicitacaoNumerarioService` (Recebimentos). Rota → HTTP 409.
 */
export default class RemessaEmDuvidaError extends Error implements HandlerError {
    public readonly code = 'REMESSA_EM_DUVIDA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: { loteId: string; idempotencyKey: string; nativeFlpCod?: number; etapa?: string }) {
        super(`remessa IN-DOUBT for lote ${params.loteId} (key ${params.idempotencyKey})`);
        this.name = 'RemessaEmDuvidaError';
        this.userMessage = params.nativeFlpCod
            ? `Há uma geração de remessa anterior sem confirmação para este lote. O lote ${params.nativeFlpCod} pode ter ficado órfão no Conexos (parou em "${params.etapa ?? '?'}"). Confira no fin015 e cancele-o antes de tentar de novo — repetir agora poderia gerar um segundo pagamento.`
            : `Há uma geração de remessa anterior sem confirmação para este lote. Confira o fin015 antes de tentar de novo — repetir agora poderia gerar um segundo pagamento.`;
        this.details = params;
    }
}

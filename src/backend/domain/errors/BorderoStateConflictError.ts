import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Estado do borderô (ou da baixa) que impede a ação pedida. */
export type BorderoConflito =
    | { motivo: 'sem-baixas'; borCod: number }
    | { motivo: 'baixa-sem-seq'; borCod: number; invoiceDocCod: string };

/**
 * A ação é válida em geral, mas não no estado atual: aprovar um borderô que ficou sem baixa (casco da
 * I-Write-7) ou excluir uma baixa cuja trilha não tem o `bxaCodSeq` do ERP. Conflito com o estado do
 * recurso → 409. Os textos já eram em português e diziam o que fazer, então `userMessage = message`.
 */
export default class BorderoStateConflictError extends Error implements HandlerError {
    public readonly code: string;
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    constructor(params: BorderoConflito) {
        super(
            params.motivo === 'sem-baixas'
                ? `Borderô ${params.borCod} não possui baixas — não há o que aprovar. Ele ficou vazio porque ` +
                      'a baixa falhou depois de criá-lo; use "Excluir" para removê-lo.'
                : `baixa ${params.borCod}/${params.invoiceDocCod} sem bxaCodSeq — não dá para excluir no ERP`,
        );
        this.name = 'BorderoStateConflictError';
        this.code =
            params.motivo === 'sem-baixas' ? 'BORDERO_SEM_BAIXAS' : 'BAIXA_SEM_SEQUENCIA_ERP';
        this.userMessage = this.message;
        this.details = params;
    }
}

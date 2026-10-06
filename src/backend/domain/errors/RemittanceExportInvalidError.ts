import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Pedido de export dos títulos de remessas com lote que não existe ou que ainda não tem remessa
 * gerada. Recusa o pedido inteiro (em vez de exportar só uma parte) para a planilha nunca sair
 * com menos lotes do que a analista selecionou sem ela perceber.
 */
export default class RemittanceExportInvalidError extends Error implements HandlerError {
    public readonly code = 'EXPORT_REMESSA_INVALIDO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    public constructor(params: { inexistentes: string[]; semRemessa: string[] }) {
        super(
            `export de títulos recusado: inexistentes=[${params.inexistentes.join(',')}] semRemessa=[${params.semRemessa.join(',')}]`,
        );
        this.name = 'RemittanceExportInvalidError';
        const partes: string[] = [];
        if (params.inexistentes.length > 0) {
            partes.push(`${params.inexistentes.length} lote(s) não encontrado(s)`);
        }
        if (params.semRemessa.length > 0) {
            partes.push(`${params.semRemessa.length} lote(s) ainda sem remessa gerada`);
        }
        this.userMessage =
            `Não foi possível exportar: ${partes.join(' e ')}. ` +
            'Atualize a lista e selecione só lotes com remessa gerada.';
        this.details = params;
    }
}

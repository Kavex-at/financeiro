import type { HandlerError } from '../libs/handler/HandlerError.js';

export interface PendingDuplicateItem {
    docCod: string;
    titCod: string;
    credor?: string;
    alertas: Array<{
        id: string;
        tipo: string;
        contraparteFilCod?: number;
        contraparteDocCod?: string;
    }>;
}

const ROTULO_TIPO: Readonly<Record<string, string>> = {
    DUPLICIDADE_FORTE: 'mesma NF',
    DUPLICIDADE_FRACA: 'mesmo valor e vencimento próximo',
};

/**
 * Alerta de duplicidade ABERTA no `finalizarLote` (ADR-0063, I13f): cada alerta precisa ser
 * JUSTIFICADA ou RETIRADA pela analista antes de finalizar. A lista é por item, com a contraparte.
 * HTTP 409.
 */
export default class PendingDuplicateAlertError extends Error implements HandlerError {
    public readonly code = 'ALERTA_DUPLICIDADE_PENDENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { loteId: string; itens: PendingDuplicateItem[] }) {
        super(
            `open duplicate alerts in lot ${params.loteId}: ${params.itens.map((i) => `${i.docCod}/${i.titCod}`).join(', ')}`,
        );
        this.name = 'PendingDuplicateAlertError';
        const linhas = params.itens.map((i) => {
            const contra = i.alertas
                .map((a) => `doc ${a.contraparteDocCod ?? '?'} (${ROTULO_TIPO[a.tipo] ?? a.tipo})`)
                .join(', ');
            return `${i.docCod}/${i.titCod}${i.credor ? ` (${i.credor})` : ''}: possível duplicidade com ${contra}`;
        });
        this.userMessage =
            `Há alerta de duplicidade sem tratamento: ${linhas.join('; ')}. ` +
            'Justifique ou retire cada item antes de finalizar.';
        this.details = { loteId: params.loteId, itens: params.itens };
    }
}

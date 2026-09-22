import type { HandlerError } from '../libs/handler/HandlerError.js';

export const MOTIVO_CONGELADA = {
    /** O pedido trouxe uma data diferente da que o lote nativo já tem. */
    DIFERENTE: 'diferente',
    /** A data congelada ficou no passado antes do `finalizarLote` (o ERP recusaria pelo R1). */
    NO_PASSADO: 'no_passado',
} as const;
export type MotivoCongelada = (typeof MOTIVO_CONGELADA)[keyof typeof MOTIVO_CONGELADA];

export interface DebitDateFrozenDetails {
    motivo: MotivoCongelada;
    /** `'YYYY-MM-DD'` — a data com que o lote nativo foi criado. */
    dataCongelada: string;
    nativeFlpCod: number;
    /** A data que veio no pedido, quando veio. */
    dataPedida?: string;
}

const ddmm = (civil?: string): string => {
    if (!civil) return '?';
    const [, m, d] = civil.split('-');
    return `${d}/${m}`;
};

/**
 * A data de débito está congelada (I8b, ADR-0049): o lote nativo do fin015 já foi criado com
 * ela, e as escritas do fin015 não permitem trocá-la sem criar outro lote.
 *
 * Só volta a ser escolhível se esse lote nativo deixar de existir — cancelado no fin015 e
 * confirmado pelo fluxo do `LoteAnteriorCanceladoError`.
 *
 * Rota → HTTP 409.
 */
export default class DebitDateFrozenError extends Error implements HandlerError {
    public readonly code = 'DATA_DEBITO_CONGELADA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: DebitDateFrozenDetails;

    public constructor(details: DebitDateFrozenDetails) {
        const texto =
            details.motivo === MOTIVO_CONGELADA.NO_PASSADO
                ? `O lote nativo flp ${details.nativeFlpCod} foi criado no Conexos com débito em ${ddmm(details.dataCongelada)}, que já passou. Cancele o lote nativo flp ${details.nativeFlpCod} no fin015 e gere a remessa de novo para escolher outra data.`
                : `A data de débito deste lote está congelada em ${ddmm(details.dataCongelada)}: o lote nativo flp ${details.nativeFlpCod} já foi criado no Conexos com ela. Para mudar, cancele o lote nativo no fin015 e gere de novo.`;
        super(texto);
        this.name = 'DebitDateFrozenError';
        this.userMessage = texto;
        this.details = details;
    }
}

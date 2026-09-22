import type { TituloLimitante } from '../interface/sispag/SispagInterface.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Por que uma data de débito (ou a janela inteira) foi recusada. */
export const MOTIVO_FORA_DA_JANELA = {
    /** Data antes de hoje (R1 do ERP). */
    ANTES_DE_HOJE: 'antes_de_hoje',
    /** Data depois do menor vencimento dos itens (R2 do ERP). */
    DEPOIS_DO_VENCIMENTO: 'depois_do_vencimento',
    /** Sábado, domingo ou feriado bancário nacional (regra nossa, D4). */
    NAO_UTIL: 'nao_util',
    /** Janela vazia: um título do lote já venceu. */
    TITULO_VENCIDO: 'titulo_vencido',
    /** Janela vazia: nenhum dia útil entre hoje e o menor vencimento. */
    SEM_DIA_UTIL: 'sem_dia_util',
    /** Janela vazia: um item sem vencimento conhecido (fail-closed). */
    TITULO_SEM_VENCIMENTO: 'titulo_sem_vencimento',
} as const;
export type MotivoForaDaJanela = (typeof MOTIVO_FORA_DA_JANELA)[keyof typeof MOTIVO_FORA_DA_JANELA];

export interface DebitDateOutsideWindowDetails {
    dataDebito?: string;
    min?: string;
    max?: string;
    motivo: MotivoForaDaJanela;
    limitante?: TituloLimitante;
}

/** `'2026-09-22'` → `'22/09'`, por split: nunca `new Date(...)`, que deslocaria o fuso. */
const ddmm = (civil?: string): string => {
    if (!civil) return '?';
    const [, m, d] = civil.split('-');
    return `${d}/${m}`;
};

const descreverTitulo = (t?: TituloLimitante): string => {
    if (!t) return 'de um título do lote';
    const credor = t.credor ? `${t.credor}, ` : '';
    return `do título ${t.documento} (${credor}vence ${ddmm(t.vencimento)})`;
};

const mensagem = (d: DebitDateOutsideWindowDetails): string => {
    const permitido = d.min && d.max ? ` Permitido: ${ddmm(d.min)} a ${ddmm(d.max)}.` : '';
    switch (d.motivo) {
        case MOTIVO_FORA_DA_JANELA.DEPOIS_DO_VENCIMENTO:
            return `Data ${ddmm(d.dataDebito)} depois do vencimento ${descreverTitulo(d.limitante)}.${permitido} Para usar uma data posterior, reabra o lote e retire esse título.`;
        case MOTIVO_FORA_DA_JANELA.ANTES_DE_HOJE:
            return `Data ${ddmm(d.dataDebito)} já passou: a data de débito não pode ser anterior a hoje.${permitido}`;
        case MOTIVO_FORA_DA_JANELA.NAO_UTIL:
            return `${ddmm(d.dataDebito)} não é dia útil bancário.${permitido}`;
        case MOTIVO_FORA_DA_JANELA.TITULO_VENCIDO:
            return `Não há data de débito possível: o título ${d.limitante?.documento ?? ''} já venceu (${ddmm(d.limitante?.vencimento)}). Reabra o lote e retire o título vencido.`;
        case MOTIVO_FORA_DA_JANELA.SEM_DIA_UTIL:
            return `Não há dia útil bancário entre hoje e o vencimento ${descreverTitulo(d.limitante)}. Reabra o lote e retire esse título.`;
        case MOTIVO_FORA_DA_JANELA.TITULO_SEM_VENCIMENTO:
            return `O título ${d.limitante?.documento ?? ''} está sem vencimento no lote, então não dá para calcular a janela de débito. Reabra o lote e retire ou reinclua o título.`;
    }
};

/**
 * A data de débito pedida está fora da janela permitida do lote (I8a, ADR-0049), ou a janela
 * está vazia. Barrado ANTES de qualquer escrita no ERP — o ledger fica intocado.
 *
 * Rota → HTTP 422, `code` próprio para a tela mostrar a janela em vez de um erro genérico.
 */
export default class DebitDateOutsideWindowError extends Error implements HandlerError {
    public readonly code = 'DATA_DEBITO_FORA_DA_JANELA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details: DebitDateOutsideWindowDetails;

    public constructor(details: DebitDateOutsideWindowDetails) {
        const texto = mensagem(details);
        super(texto);
        this.name = 'DebitDateOutsideWindowError';
        this.userMessage = texto;
        this.details = details;
    }
}

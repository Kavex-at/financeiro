import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Qual verificação nossa (I17d) reprovou o vínculo do item. */
export const CAMPO_DIVERGENTE_VINCULO = {
    VALOR: 'VALOR',
    DATA: 'DATA',
    BANCO: 'BANCO',
    JUROS_DESCONTO: 'JUROS_DESCONTO',
    CODIGO_REPETIDO: 'CODIGO_REPETIDO',
    ELEGIBILIDADE: 'ELEGIBILIDADE',
} as const;
export type CampoDivergenteVinculo =
    (typeof CAMPO_DIVERGENTE_VINCULO)[keyof typeof CAMPO_DIVERGENTE_VINCULO];

export interface VinculoCodigoBarrasDivergenteParams {
    docCod: string;
    titCod: string;
    campo: CampoDivergenteVinculo;
    /** Valor que o título pede / que esperávamos, em centavos. */
    esperadoCentavos?: number;
    /** Valor que o código/ERP trouxe, em centavos. */
    obtidoCentavos?: number;
    /** Vencimento do código − vencimento do título, em dias, com sinal. */
    deltaDias?: number;
    /** Máscara 5+4 do código. */
    codigoMascarado?: string;
    /** Motivo curto da elegibilidade (identificador), quando `campo = ELEGIBILIDADE`. */
    motivo?: string;
}

const reais = (centavos: number): string => `R$ ${(centavos / 100).toFixed(2).replace('.', ',')}`;

const comSinal = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

/**
 * Uma verificação NOSSA do vínculo (ADR-0071, I17d) reprovou o item depois do import: valor,
 * data, banco ou juros/desconto divergentes, ou o código já está em outro item. É falha
 * DETERMINÍSTICA (I17g(3)): o item sai do lote pela maquinaria da I16d, com motivo
 * `VINCULO_CODIGO_BARRAS_FALHOU`, e a remessa segue com os demais.
 *
 * Nada aqui carrega o código completo: só `docCod/titCod`, valores, Δ com sinal e a máscara.
 */
export default class VinculoCodigoBarrasDivergenteError extends Error implements HandlerError {
    public readonly code = 'VINCULO_CODIGO_BARRAS_DIVERGENTE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: unknown;

    public constructor(params: VinculoCodigoBarrasDivergenteParams) {
        const sanear = (t: string): string => t.replace(/\d{10,}/g, '…');
        const doc = sanear(String(params.docCod));
        const tit = sanear(String(params.titCod));
        super(`barcode bind divergent on ${doc}/${tit}: ${params.campo}`);
        this.name = 'VinculoCodigoBarrasDivergenteError';

        const partes: string[] = [];
        if (params.esperadoCentavos !== undefined && params.obtidoCentavos !== undefined) {
            const delta = params.obtidoCentavos - params.esperadoCentavos;
            partes.push(
                `título pede ${reais(params.esperadoCentavos)}, o código traz ` +
                    `${reais(params.obtidoCentavos)} (diferença ${comSinal(delta)} centavo(s))`,
            );
        }
        if (params.deltaDias !== undefined) {
            partes.push(`vencimento do código ${comSinal(params.deltaDias)} dia(s) do título`);
        }
        if (params.codigoMascarado) partes.push(`código ${sanear(params.codigoMascarado)}`);
        if (params.motivo) partes.push(`motivo ${sanear(params.motivo)}`);
        const detalhe = partes.length > 0 ? ` (${partes.join('; ')})` : '';
        this.userMessage =
            `O código de barras não pôde ser vinculado ao título ${doc}/${tit}: ` +
            `${ROTULO[params.campo]}${detalhe}. O título saiu do lote e fica retido; confira o ` +
            `boleto. Nada foi enviado ao banco por este item.`;
        this.details = {
            docCod: doc,
            titCod: tit,
            campo: params.campo,
            ...(params.esperadoCentavos !== undefined
                ? { esperadoCentavos: Number(params.esperadoCentavos) }
                : {}),
            ...(params.obtidoCentavos !== undefined
                ? { obtidoCentavos: Number(params.obtidoCentavos) }
                : {}),
            ...(params.deltaDias !== undefined ? { deltaDias: Number(params.deltaDias) } : {}),
            ...(params.codigoMascarado ? { codigoMascarado: sanear(params.codigoMascarado) } : {}),
            ...(params.motivo ? { motivo: sanear(params.motivo) } : {}),
        };
    }
}

const ROTULO: Record<CampoDivergenteVinculo, string> = {
    VALOR: 'o valor do boleto é diferente do valor em aberto',
    DATA: 'a data do boleto diverge da data de pagamento apurada',
    BANCO: 'o banco do código diverge do banco confirmado pelo ERP',
    JUROS_DESCONTO: 'o ERP aplicou juros ou desconto ao valor do boleto',
    CODIGO_REPETIDO: 'o mesmo código já está em outro item do lote',
    ELEGIBILIDADE: 'a decisão ou o boleto deixaram de atender às condições do vínculo',
};

import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Título com `BloqueioDuplicidade` ATIVO: não entra em lote enquanto a marca valer. HTTP 409.
 *
 * Duas famílias, com texto próprio:
 *  - `DUPLICIDADE_TITULO` (ADR-0063, I13g): foi retirado de um lote por duplicidade e aguarda o
 *    cancelamento de um dos documentos no Conexos;
 *  - `CODIGO_BARRAS_REPETIDO` / `CODIGO_BARRAS_ILEGIVEL` (ADR-0069 emenda 1, I16g): o sistema o
 *    retirou do lote porque o boleto dele repete o de outro título (ou o código é ilegível).
 *    Mostra só a máscara 5+4 (I16e).
 */
export default class DuplicateHoldError extends Error implements HandlerError {
    public readonly code = 'TITULO_BLOQUEADO_DUPLICIDADE';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: {
        filCod: number;
        docCod: string;
        titCod: string;
        motivo?: string;
        marcadoPor?: string;
        /** Origem da marca. Ausente = `DUPLICIDADE_TITULO` (texto histórico). */
        origem?: string;
        codigoMascarado?: string;
        tituloMantido?: { docCod: string; titCod: string };
    }) {
        super(`title ${params.filCod}/${params.docCod}/${params.titCod} is held as a duplicate`);
        this.name = 'DuplicateHoldError';
        this.userMessage = DuplicateHoldError.mensagem(params);
        this.details = {
            filCod: params.filCod,
            docCod: params.docCod,
            titCod: params.titCod,
            ...(params.motivo ? { motivo: params.motivo } : {}),
            ...(params.origem ? { origem: params.origem } : {}),
        };
    }

    private static mensagem = (params: {
        docCod: string;
        titCod: string;
        marcadoPor?: string;
        origem?: string;
        codigoMascarado?: string;
        tituloMantido?: { docCod: string; titCod: string };
    }): string => {
        const id = `${params.docCod}/${params.titCod}`;
        if (params.origem === 'CODIGO_BARRAS_REPETIDO') {
            const mantido = params.tituloMantido
                ? ` O título ${params.tituloMantido.docCod}/${params.tituloMantido.titCod} ficou no lote.`
                : '';
            const codigo = params.codigoMascarado ? ` (código ${params.codigoMascarado})` : '';
            return (
                `O título ${id} foi retirado do lote automaticamente porque o boleto dele` +
                `${codigo} é o mesmo de outro título do lote.${mantido} Ele não entra em lote ` +
                'enquanto estiver retido; resolva o boleto no Conexos ou, se a retenção não se ' +
                'justifica, desfaça-a informando o motivo.'
            );
        }
        if (params.origem === 'CODIGO_BARRAS_ILEGIVEL') {
            return (
                `O título ${id} foi retirado do lote automaticamente porque o código de barras ` +
                'do boleto está ilegível ou inválido. Ele não entra em lote enquanto estiver ' +
                'retido; corrija o boleto no Conexos ou, se a retenção não se justifica, ' +
                'desfaça-a informando o motivo.'
            );
        }
        return (
            `O título ${id} foi retirado por duplicidade` +
            `${params.marcadoPor ? ` por ${params.marcadoPor}` : ''} e aguarda o cancelamento no ` +
            'Conexos. Ele não entra em lote enquanto o bloqueio estiver ativo; se a duplicidade não ' +
            'se confirmou, desfaça o bloqueio informando o motivo.'
        );
    };
}

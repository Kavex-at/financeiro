import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Título identificado só por chave — nunca carrega o código de barras. */
export interface TituloDoVinculo {
    docCod: string;
    titCod: string;
}

export interface VinculoCodigoBarrasIncompletoParams {
    flpCod?: number;
    /** Itens que JÁ ficaram vinculados (ficam; a retomada é idempotente, I17f). */
    vinculados: TituloDoVinculo[];
    /** Itens que ainda precisam do vínculo. */
    pendentes: TituloDoVinculo[];
    /** Identificador curto da causa (nunca o código): `TRANSITORIA`, `LEITURA_INCOMPLETA`… */
    causa: string;
    /** Máscara 5+4 do código do item que falhou, quando há. */
    codigoMascarado?: string;
}

const MAX_NA_MENSAGEM = 20;

/** Rótulo de ledger gravado em `message` (e portanto em `erro_mensagem`). */
export const MOTIVO_LEDGER_VINCULO_INCOMPLETO = 'VINCULO_CODIGO_BARRAS_INCOMPLETO';

/**
 * O vínculo do código de barras ao item NÃO terminou por uma falha transitória ou ambígua
 * (timeout, 5xx, resposta ilegível, `PUT` sem releitura conclusiva, leitura incompleta) — ADR-0071
 * I17g(2). A geração da remessa PARA antes do `finalizarLote`: nada foi enviado ao banco, o
 * rascunho é preservado e reexecutar retoma. NUNCA vira retirada.
 *
 * `details`/`message` carregam só identidade de título, contagens e a máscara; texto livre é
 * saneado (`\d{10,}` → `…`) para o código completo nunca chegar ao ledger, ao log ou à tela.
 */
export default class VinculoCodigoBarrasIncompletoError extends Error implements HandlerError {
    public readonly code = 'VINCULO_CODIGO_BARRAS_INCOMPLETO';
    public readonly userMessage: string;
    public readonly retryable = true;
    public readonly statusCode = 409;
    public readonly details: unknown;

    public constructor(params: VinculoCodigoBarrasIncompletoParams) {
        const E = VinculoCodigoBarrasIncompletoError;
        const vinculados = params.vinculados.map(E.titulo);
        const pendentes = params.pendentes.map(E.titulo);
        const causa = E.sanear(params.causa);
        const lista = E.lista(pendentes);
        const onde = params.flpCod !== undefined ? ` on flpCod ${Number(params.flpCod)}` : '';
        super(
            `${MOTIVO_LEDGER_VINCULO_INCOMPLETO} (${causa}): ${vinculados.length} bound, ` +
                `${pendentes.length} pending${onde}: ${lista}`,
        );
        this.name = 'VinculoCodigoBarrasIncompletoError';
        const ondeNoErp =
            params.flpCod !== undefined ? ` Lote nativo no Conexos: ${Number(params.flpCod)}.` : '';
        const mascara = params.codigoMascarado
            ? ` Código do item que falhou: ${E.sanear(params.codigoMascarado)}.`
            : '';
        this.userMessage =
            `O vínculo do código de barras não terminou: ${vinculados.length} título(s) já ` +
            `ficaram vinculados e ${pendentes.length} ainda faltam (${lista}).${mascara} ` +
            `Nada foi enviado ao banco e o rascunho foi preservado. Gere a remessa de novo: o ` +
            `sistema retoma de onde parou.${ondeNoErp}`;
        this.details = {
            causa,
            ...(params.flpCod !== undefined ? { flpCod: Number(params.flpCod) } : {}),
            vinculados,
            pendentes,
            ...(params.codigoMascarado
                ? { codigoMascarado: E.sanear(params.codigoMascarado) }
                : {}),
        };
    }

    private static sanear = (texto: string): string => texto.replace(/\d{10,}/g, '…');

    private static titulo = (t: TituloDoVinculo): TituloDoVinculo => ({
        docCod: VinculoCodigoBarrasIncompletoError.sanear(String(t.docCod)),
        titCod: VinculoCodigoBarrasIncompletoError.sanear(String(t.titCod)),
    });

    private static lista = (itens: TituloDoVinculo[]): string => {
        const ids = itens.slice(0, MAX_NA_MENSAGEM).map((p) => `${p.docCod}/${p.titCod}`);
        const mais = itens.length - ids.length;
        return `${ids.join(', ')}${mais > 0 ? ` (+${mais})` : ''}`;
    };
}

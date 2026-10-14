import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Item pendente identificado só por título — nunca carrega o código de barras. */
export interface ItemRetiradaPendente {
    docCod: string;
    titCod: string;
}

export type BoletoCodigoBarrasRetiradaIncompletaParams =
    | {
          /**
           * `limpeza`: algum `DELETE` falhou ou a releitura ainda mostra o item (I16d.6).
           * Itens já retirados permanecem retirados; a retomada termina a limpeza (I16h).
           */
          modo: 'limpeza';
          flpCod?: number;
          /** Quantos itens JÁ saíram (local + rascunho nativo). */
          retirados: number;
          /** Itens cuja retirada não foi confirmada pela releitura. */
          pendentes: ItemRetiradaPendente[];
          /** Itens que o rascunho nativo ainda contém, se a releitura chegou a ser feita. */
          restantesNoRascunho?: number;
      }
    | {
          /**
           * `leitura`: a lista nativa não pôde ser lida por inteiro (falha, truncada, item sem
           * `itsCodSeq` ou boleto sem código lido) — I16c. NADA foi retirado.
           */
          modo: 'leitura';
          flpCod?: number;
          /** Boletos do lote local cujo código não foi lido. */
          pendentes: ItemRetiradaPendente[];
          /** Motivo curto (identificador) — nunca o código. */
          causa: 'LISTA_TRUNCADA' | 'LISTA_ILEGIVEL' | 'ITEM_SEM_IDENTIDADE' | 'CODIGO_AUSENTE';
      };

const MAX_NA_MENSAGEM = 20;

/** Rótulo de ledger gravado em `message` (e portanto em `erro_mensagem`). */
export const MOTIVO_LEDGER_LIMPEZA_INCOMPLETA = 'LIMPEZA_CODIGO_REPETIDO_INCOMPLETA';

interface Normalizado {
    params: BoletoCodigoBarrasRetiradaIncompletaParams;
    pendentes: ItemRetiradaPendente[];
    flpCod?: number;
    lista: string;
}

/**
 * A retirada automática por código de barras repetido/ilegível não terminou (ADR-0069 emenda 1,
 * I16c, I16d.6). A geração da remessa PARA antes do `finalizarLote`: nada foi enviado ao banco.
 *
 * `details`/`message` carregam só identidade de título e contagens; texto livre é saneado
 * (`\d{10,}` → `…`) para que o código completo nunca chegue ao ledger, ao log ou à tela.
 */
export default class BoletoCodigoBarrasRetiradaIncompletaError
    extends Error
    implements HandlerError
{
    public readonly code = 'BOLETO_CODIGO_BARRAS_RETIRADA_INCOMPLETA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: unknown;

    public constructor(params: BoletoCodigoBarrasRetiradaIncompletaParams) {
        const E = BoletoCodigoBarrasRetiradaIncompletaError;
        const n = E.normalizar(params);
        super(E.montarMessage(n));
        this.name = 'BoletoCodigoBarrasRetiradaIncompletaError';
        this.userMessage = E.montarUserMessage(n);
        this.details = E.montarDetails(n);
    }

    private static sanear = (texto: string): string => texto.replace(/\d{10,}/g, '…');

    private static normalizar = (
        params: BoletoCodigoBarrasRetiradaIncompletaParams,
    ): Normalizado => {
        const E = BoletoCodigoBarrasRetiradaIncompletaError;
        const pendentes = params.pendentes.map((p) => ({
            docCod: E.sanear(String(p.docCod)),
            titCod: E.sanear(String(p.titCod)),
        }));
        const ids = pendentes.slice(0, MAX_NA_MENSAGEM).map((p) => `${p.docCod}/${p.titCod}`);
        const mais = pendentes.length - ids.length;
        return {
            params,
            pendentes,
            ...(params.flpCod !== undefined ? { flpCod: Number(params.flpCod) } : {}),
            lista: `${ids.join(', ')}${mais > 0 ? ` (+${mais})` : ''}`,
        };
    };

    private static montarMessage = (n: Normalizado): string => {
        const onde = n.flpCod !== undefined ? ` on flpCod ${n.flpCod}` : '';
        if (n.params.modo === 'limpeza') {
            return `${MOTIVO_LEDGER_LIMPEZA_INCOMPLETA}: ${n.pendentes.length} item(s) pending removal${onde}: ${n.lista}`;
        }
        return `incomplete barcode read (${n.params.causa}): ${n.pendentes.length} boleto(s) unread${onde}: ${n.lista}`;
    };

    private static montarUserMessage = (n: Normalizado): string => {
        const ondeNoErp = n.flpCod !== undefined ? ` Lote nativo no Conexos: ${n.flpCod}.` : '';
        if (n.params.modo === 'limpeza') {
            const restantes =
                n.params.restantesNoRascunho !== undefined
                    ? ` O rascunho deste lote no Conexos ainda contém ${n.params.restantesNoRascunho} item(ns).`
                    : '';
            return (
                `A retirada automática dos boletos repetidos não terminou: ${n.params.retirados} ` +
                `título(s) já saíram do lote e ${n.pendentes.length} ainda precisam sair (${n.lista}).` +
                `${restantes} Nada foi enviado ao banco. Gere a remessa de novo: o sistema termina a limpeza.` +
                ondeNoErp
            );
        }
        return (
            'Não foi possível ler por inteiro os códigos de barras do rascunho no Conexos' +
            `${n.pendentes.length > 0 ? ` (títulos sem leitura: ${n.lista})` : ''}. ` +
            'Por segurança nenhum título foi retirado e nada foi enviado ao banco. ' +
            `Gere a remessa de novo; se persistir, confira o rascunho no Conexos.${ondeNoErp}`
        );
    };

    private static montarDetails = (n: Normalizado): unknown => {
        const flpCod = n.flpCod !== undefined ? { flpCod: n.flpCod } : {};
        if (n.params.modo === 'limpeza') {
            return {
                modo: n.params.modo,
                ...flpCod,
                retirados: Number(n.params.retirados),
                pendentes: n.pendentes,
                ...(n.params.restantesNoRascunho !== undefined
                    ? { restantesNoRascunho: Number(n.params.restantesNoRascunho) }
                    : {}),
            };
        }
        return { modo: n.params.modo, causa: n.params.causa, ...flpCod, pendentes: n.pendentes };
    };
}

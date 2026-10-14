import type { HandlerError } from '../libs/handler/HandlerError.js';

/** Item do lote identificado só por título — nunca carrega o código de barras. */
export interface ItemBoletoRepetido {
    docCod: string;
    titCod: string;
    valor?: number;
    /** Data civil `YYYY-MM-DD`. */
    vencimento?: string;
    credor?: string;
}

export interface GrupoRepetidoNoLote {
    /** Forma mascarada (5 primeiros + 4 últimos, I16e). Código completo é saneado se vier. */
    mascarado: string;
    itens: ItemBoletoRepetido[];
}

export interface GrupoRepetidoNoArquivo {
    mascarado: string;
    /** Linhas (1-indexadas) do `.REM` com o mesmo segmento J. */
    linhas: number[];
}

export type BoletoCodigoBarrasRepetidoParams =
    | { origem: 'lote'; grupos: GrupoRepetidoNoLote[]; ilegiveis: ItemBoletoRepetido[] }
    | { origem: 'arquivo'; grupos: GrupoRepetidoNoArquivo[] };

const MAX_TITULOS_NA_MENSAGEM = 20;
const JANELA_SENSIVEL = /\d{10,}/;

/**
 * Mais de um item do lote carrega o MESMO código de barras (ou um item tem código ilegível):
 * o `.REM` pagaria o mesmo boleto N vezes (ADR-0069, I16).
 *
 * O construtor só aceita a forma mascarada — o tipo não tem campo para o código completo — e,
 * defensivamente, qualquer sequência de 10+ dígitos que chegue em texto livre é saneada. Assim
 * `message` (que vai ao ledger e ao log), `userMessage`, `details` e `stack` não vazam o código.
 *
 * Nada é descartado em silêncio: a analista retira o título repetido do lote e gera de novo.
 */
export default class BoletoCodigoBarrasRepetidoError extends Error implements HandlerError {
    public readonly code = 'BOLETO_CODIGO_BARRAS_REPETIDO';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details: unknown;

    public constructor(params: BoletoCodigoBarrasRepetidoParams) {
        const norm = BoletoCodigoBarrasRepetidoError.normalizar(params);
        super(BoletoCodigoBarrasRepetidoError.montarMessage(norm));
        this.name = 'BoletoCodigoBarrasRepetidoError';
        this.userMessage = BoletoCodigoBarrasRepetidoError.montarUserMessage(norm);
        this.details = norm;
    }

    private static sanear = (texto: string): string => texto.replace(/\d{10,}/g, '…');

    private static mascara = (valor: string): string => {
        if (!JANELA_SENSIVEL.test(valor)) return valor;
        const d = valor.replace(/\D/g, '');
        return `${d.slice(0, 5)}…${d.slice(-4)}`;
    };

    private static item = (i: ItemBoletoRepetido): ItemBoletoRepetido => ({
        docCod: BoletoCodigoBarrasRepetidoError.sanear(String(i.docCod)),
        titCod: BoletoCodigoBarrasRepetidoError.sanear(String(i.titCod)),
        ...(i.valor !== undefined ? { valor: i.valor } : {}),
        ...(i.vencimento
            ? { vencimento: BoletoCodigoBarrasRepetidoError.sanear(i.vencimento) }
            : {}),
        ...(i.credor ? { credor: BoletoCodigoBarrasRepetidoError.sanear(i.credor) } : {}),
    });

    private static normalizar = (params: BoletoCodigoBarrasRepetidoParams) => {
        const E = BoletoCodigoBarrasRepetidoError;
        if (params.origem === 'arquivo') {
            return {
                modo: 'arquivo' as const,
                grupos: params.grupos.map((g) => ({
                    mascarado: E.mascara(g.mascarado),
                    linhas: [...g.linhas].map(Number),
                })),
                ilegiveis: [] as ItemBoletoRepetido[],
            };
        }
        return {
            modo: params.grupos.length === 0 ? ('ilegivel' as const) : ('repetido' as const),
            grupos: params.grupos.map((g) => ({
                mascarado: E.mascara(g.mascarado),
                itens: g.itens.map(E.item),
            })),
            ilegiveis: params.ilegiveis.map(E.item),
        };
    };

    private static valor = (v: number): string =>
        `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    private static data = (iso: string): string => {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
        return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
    };

    private static descreverItem = (i: ItemBoletoRepetido): string => {
        const E = BoletoCodigoBarrasRepetidoError;
        const partes = [`${i.docCod}/${i.titCod}`];
        if (i.credor) partes.push(`(${i.credor})`);
        if (i.valor !== undefined) partes.push(E.valor(i.valor));
        if (i.vencimento) partes.push(`venc. ${E.data(i.vencimento)}`);
        return partes.join(' ');
    };

    private static montarMessage = (
        n: ReturnType<typeof BoletoCodigoBarrasRepetidoError.normalizar>,
    ): string => {
        if (n.modo === 'arquivo') {
            const gs = (n.grupos as GrupoRepetidoNoArquivo[])
                .map((g) => `${g.mascarado} at lines ${g.linhas.join(',')}`)
                .join('; ');
            return `remittance file repeats the same boleto barcode: ${gs}`;
        }
        const partes: string[] = [];
        let listados = 0;
        let restantes = 0;
        const grupos = (n.grupos as GrupoRepetidoNoLote[]).map((g) => {
            const ids: string[] = [];
            for (const i of g.itens) {
                if (listados < MAX_TITULOS_NA_MENSAGEM) {
                    ids.push(`${i.docCod}/${i.titCod}`);
                    listados += 1;
                } else {
                    restantes += 1;
                }
            }
            return `${g.mascarado} on ${ids.join(', ')}`;
        });
        if (grupos.length > 0) {
            partes.push(
                `${grupos.length} repeated boleto barcode(s) in lote: ${grupos.join('; ')}${
                    restantes > 0 ? ` (+${restantes})` : ''
                }`,
            );
        }
        if (n.ilegiveis.length > 0) {
            const ids = n.ilegiveis
                .slice(0, MAX_TITULOS_NA_MENSAGEM)
                .map((i) => `${i.docCod}/${i.titCod}`);
            const mais = n.ilegiveis.length - ids.length;
            partes.push(`unreadable barcode on ${ids.join(', ')}${mais > 0 ? ` (+${mais})` : ''}`);
        }
        return partes.join(' | ');
    };

    private static montarUserMessage = (
        n: ReturnType<typeof BoletoCodigoBarrasRepetidoError.normalizar>,
    ): string => {
        const E = BoletoCodigoBarrasRepetidoError;
        const orientacao =
            'A remessa foi interrompida antes de finalizar e nada foi enviado ao banco. O rascunho deste lote no Conexos ainda contém o item repetido: retire o título repetido do lote aqui e peça que o rascunho seja descartado no Conexos antes de gerar a remessa de novo.';
        if (n.modo === 'arquivo') {
            const gs = (n.grupos as GrupoRepetidoNoArquivo[])
                .map((g) => `código ${g.mascarado} nas linhas ${g.linhas.join(' e ')} do arquivo`)
                .join('; ');
            return `O arquivo de remessa repete o mesmo boleto: ${gs}. Pagar duas vezes o mesmo boleto não é permitido. ${orientacao}`;
        }
        const blocos: string[] = [];
        if (n.modo === 'ilegivel' || n.ilegiveis.length > 0) {
            const itens = n.ilegiveis.map(E.descreverItem).join('; ');
            blocos.push(
                `O código de barras está ilegível ou inválido para o título ${itens}. ` +
                    'Revise o boleto antes de gerar a remessa.',
            );
        }
        const grupos = n.grupos as GrupoRepetidoNoLote[];
        if (grupos.length > 0) {
            const gs = grupos
                .map((g) => `código ${g.mascarado}: ${g.itens.map(E.descreverItem).join('; ')}`)
                .join(' | ');
            blocos.push(
                'Mais de um título do lote aponta para o mesmo boleto, e ele seria pago mais de uma ' +
                    `vez — ${gs}. ${orientacao}`,
            );
        }
        return blocos.join(' ');
    };
}

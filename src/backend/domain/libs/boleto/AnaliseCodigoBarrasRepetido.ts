import { inject, injectable } from 'tsyringe';
import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';

/** Entrada: um item do lote (chave opaca para o chamador) e o código como veio do ERP/arquivo. */
export interface ItemCodigoBarras {
    chave: string;
    /** Linha digitável (47) ou barras (44); espaços e pontos são tolerados. */
    codigo: string;
}

export interface GrupoCodigoBarrasRepetido {
    /** Barras normalizadas (44). Uso interno: nunca vai para mensagem, log ou ledger. */
    barras44: string;
    /** Forma mascarada (5 primeiros + 4 últimos), a única que pode sair do módulo. */
    mascarado: string;
    /** Chaves dos itens que carregam este código, na ordem de entrada. */
    chaves: string[];
}

export interface ResultadoAnaliseCodigoBarras {
    grupos: GrupoCodigoBarrasRepetido[];
    /** Chaves cujo código está presente mas é inválido (falha fechado, I16c). */
    ilegiveis: string[];
}

/** Entrada da decisão de retirada (I16d.1): item com a ordem de "quem fica". */
export interface ItemCodigoBarrasComOrdem extends ItemCodigoBarras {
    filCod: number;
    docCod: string;
    titCod: string;
    /** Epoch ms (meia-noite UTC, como o Conexos). Ausente perde o desempate (fica por último). */
    vencimento?: number;
}

export const MOTIVO_RETIRADA = {
    CODIGO_BARRAS_REPETIDO: 'CODIGO_BARRAS_REPETIDO',
    CODIGO_BARRAS_ILEGIVEL: 'CODIGO_BARRAS_ILEGIVEL',
} as const;

export interface RetiradaDecidida {
    /** Chave do item que sai. */
    chave: string;
    /** Máscara 5+4 do código compartilhado (I16e). Nunca as barras. */
    mascarado: string;
    /** Chave do item do grupo que FICA. */
    mantida: string;
    motivo: typeof MOTIVO_RETIRADA.CODIGO_BARRAS_REPETIDO;
}

export interface IlegivelDecidido {
    chave: string;
    motivo: typeof MOTIVO_RETIRADA.CODIGO_BARRAS_ILEGIVEL;
}

export interface DecisaoRetirada {
    retirar: RetiradaDecidida[];
    ilegiveis: IlegivelDecidido[];
}

/**
 * Análise pura de repetição de código de barras num conjunto de itens (ADR-0069, I16).
 *
 * Sem I/O, sem conhecimento de ERP, ledger ou título: recebe o conjunto FINAL de códigos do lote
 * e devolve grupos de repetição e itens ilegíveis. Reutilizável pelo passo 2 da ADR-0068 depois
 * do `PUT finItemSispag`.
 */
@injectable()
export default class AnaliseCodigoBarrasRepetido {
    public constructor(
        @inject(CodigoBarrasBoleto) private readonly codigoBarras: CodigoBarrasBoleto,
    ) {}

    public analisar = (itens: ItemCodigoBarras[]): ResultadoAnaliseCodigoBarras => {
        const porBarras = new Map<string, string[]>();
        const ilegiveis: string[] = [];
        for (const item of itens) {
            const bruto = item.codigo.replace(/[\s.]/g, '');
            const barras = this.codigoBarras.paraBarras(bruto);
            if (!barras) {
                ilegiveis.push(item.chave);
                continue;
            }
            const chaves = porBarras.get(barras) ?? [];
            chaves.push(item.chave);
            porBarras.set(barras, chaves);
        }
        const grupos: GrupoCodigoBarrasRepetido[] = [];
        for (const [barras44, chaves] of porBarras) {
            if (chaves.length < 2) continue;
            grupos.push({ barras44, mascarado: this.mascarar(barras44), chaves });
        }
        return { grupos, ilegiveis };
    };

    /**
     * I16d.1 — de cada grupo de código repetido FICA UM só: o de menor `vencimento` (ausente
     * perde), depois menor `docCod` (numérico), `filCod` e `titCod`. Os demais saem. Item de
     * código ilegível (DV inválido) sai com motivo próprio e sem "quem fica" (I16d.2).
     * Sem I/O; a saída NÃO carrega as barras — só a máscara.
     */
    public decidirRetirada = (itens: ItemCodigoBarrasComOrdem[]): DecisaoRetirada => {
        const porChave = new Map(itens.map((i) => [i.chave, i]));
        const analise = this.analisar(itens);
        const retirar: RetiradaDecidida[] = [];
        for (const grupo of analise.grupos) {
            const membros = grupo.chaves
                .map((c) => porChave.get(c))
                .filter((i): i is ItemCodigoBarrasComOrdem => i !== undefined)
                .sort(AnaliseCodigoBarrasRepetido.compararOrdem);
            const [mantido, ...saem] = membros;
            if (!mantido) continue;
            for (const s of saem) {
                retirar.push({
                    chave: s.chave,
                    mascarado: grupo.mascarado,
                    mantida: mantido.chave,
                    motivo: MOTIVO_RETIRADA.CODIGO_BARRAS_REPETIDO,
                });
            }
        }
        return {
            retirar,
            ilegiveis: analise.ilegiveis.map((chave) => ({
                chave,
                motivo: MOTIVO_RETIRADA.CODIGO_BARRAS_ILEGIVEL,
            })),
        };
    };

    private static compararOrdem = (
        a: ItemCodigoBarrasComOrdem,
        b: ItemCodigoBarrasComOrdem,
    ): number => {
        const va = a.vencimento ?? Number.POSITIVE_INFINITY;
        const vb = b.vencimento ?? Number.POSITIVE_INFINITY;
        if (va !== vb) return va < vb ? -1 : 1;
        const num = (x: string, y: string): number => {
            const nx = Number(x);
            const ny = Number(y);
            if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny;
            return x < y ? -1 : x > y ? 1 : 0;
        };
        return num(a.docCod, b.docCod) || a.filCod - b.filCod || num(a.titCod, b.titCod);
    };

    /** I16e: 5 primeiros + 4 últimos dígitos das barras (44). */
    public mascarar = (barras44: string): string => AnaliseCodigoBarrasRepetido.mascarar(barras44);

    /** Mesma máscara sem instância — única definição da regra I16e (usada pelo validador do .REM). */
    public static mascarar = (barras44: string): string =>
        `${barras44.slice(0, 5)}…${barras44.slice(-4)}`;
}

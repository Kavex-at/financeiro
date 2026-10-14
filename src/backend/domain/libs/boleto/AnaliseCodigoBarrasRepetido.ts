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

    /** I16e: 5 primeiros + 4 últimos dígitos das barras (44). */
    public mascarar = (barras44: string): string => `${barras44.slice(0, 5)}…${barras44.slice(-4)}`;
}

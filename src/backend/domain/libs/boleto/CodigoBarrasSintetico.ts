import CodigoBarrasBoleto from './CodigoBarrasBoleto.js';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Fator 0 do boleto FEBRABAN: 07/10/1997. O ciclo (1000..9999) recomeçou em 22/02/2025. */
const BASE_FATOR = Date.UTC(1997, 9, 7);
const REINICIO_FATOR = Date.UTC(2025, 1, 22);

export interface ParametrosBarrasSinteticas {
    /** Valor do boleto, em reais. */
    valor: number;
    /** Vencimento civil `YYYY-MM-DD`. */
    vencimento: string;
    /** Banco emissor (3 dígitos). Padrão `341`. */
    banco?: string;
    /** Varia o campo livre para gerar códigos distintos com o mesmo valor/data. */
    serie?: number;
}

/**
 * Gerador de códigos de barras SINTÉTICOS (44 dígitos, DV geral módulo 11 válido, e a linha
 * digitável de 47 com os três DVs de campo). Existe para testes e para o harness de HML: nenhum
 * boleto real entra no repositório nem no experimento (I17j).
 */
export default class CodigoBarrasSintetico {
    private static readonly conversor = new CodigoBarrasBoleto();

    /** Fator de vencimento FEBRABAN (reinicia em 1000 a partir de 22/02/2025). */
    public static fator = (vencimento: string): number => {
        const ms = Date.parse(`${vencimento}T00:00:00Z`);
        if (ms >= REINICIO_FATOR) return 1000 + Math.round((ms - REINICIO_FATOR) / DIA_MS);
        return Math.round((ms - BASE_FATOR) / DIA_MS);
    };

    public static barras = (p: ParametrosBarrasSinteticas): string => {
        const livre = `1090000${String(p.serie ?? 0).padStart(3, '0')}1234567890123`
            .slice(0, 25)
            .padEnd(25, '0');
        const corpo =
            `${p.banco ?? '341'}9` +
            String(CodigoBarrasSintetico.fator(p.vencimento)).padStart(4, '0') +
            String(Math.round(p.valor * 100)).padStart(10, '0') +
            livre;
        return `${corpo.slice(0, 4)}${CodigoBarrasSintetico.dvGeral(corpo)}${corpo.slice(4)}`;
    };

    public static linhaDigitavel = (p: ParametrosBarrasSinteticas): string =>
        CodigoBarrasSintetico.conversor.paraLinhaDigitavel(CodigoBarrasSintetico.barras(p)) ?? '';

    /** Troca um dígito do campo livre sem tocar nos DVs: o DV geral deixa de bater. */
    public static corrompido = (barras44: string): string =>
        `${barras44.slice(0, 30)}${(Number(barras44[30]) + 1) % 10}${barras44.slice(31)}`;

    private static dvGeral = (corpo: string): string => {
        // `corpo`: os 43 dígitos SEM o DV (que entra na 5ª posição).
        let soma = 0;
        let peso = 2;
        for (let i = corpo.length - 1; i >= 0; i -= 1) {
            soma += Number(corpo[i]) * peso;
            peso = peso === 9 ? 2 : peso + 1;
        }
        const dv = 11 - (soma % 11);
        return String(dv === 0 || dv === 10 || dv === 11 ? 1 : dv);
    };
}

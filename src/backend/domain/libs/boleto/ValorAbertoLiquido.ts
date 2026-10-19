/**
 * Valores do título lidos AO VIVO no `fin064` (reais) que formam o líquido aberto (I17b emendada,
 * ADR-0073). Todos opcionais na leitura: qualquer ausência é decidida aqui, fail-closed.
 */
export interface ValoresAbertoTitulo {
    totalLiquido?: number;
    totalPago?: number;
    totalAberto?: number;
    titMnyJuros?: number;
    titMnyDesconto?: number;
}

const emCentavos = (v: number): number => Math.round(v * 100);

/**
 * Régua líquida da I17b (ADR-0073): `abertoLiquido = totalLiquido − totalPago`, CONFERIDO contra
 * `totalAberto + titMnyJuros − titMnyDesconto`, em centavos inteiros. As duas fórmulas divergirem
 * ou qualquer campo faltar ⇒ `undefined` (o chamador trata como `VALOR_ABERTO_INDISPONIVEL`).
 *
 * É a MESMA função nos três pontos do vínculo (elegibilidade, conferência pré-`PUT` e
 * pós-releitura) e no Δ do ajuste de centavos (I18a(3)). Pura: sem I/O, sem log, sem relógio.
 */
export default class ValorAbertoLiquido {
    public static calcularCentavos = (v?: ValoresAbertoTitulo): number | undefined => {
        if (!v) return undefined;
        const { totalLiquido, totalPago, totalAberto, titMnyJuros, titMnyDesconto } = v;
        if (
            totalLiquido === undefined ||
            totalPago === undefined ||
            totalAberto === undefined ||
            titMnyJuros === undefined ||
            titMnyDesconto === undefined
        ) {
            return undefined;
        }
        const campos = [totalLiquido, totalPago, totalAberto, titMnyJuros, titMnyDesconto];
        if (campos.some((c) => !Number.isFinite(c))) return undefined;
        const pelaLiquidez = emCentavos(totalLiquido) - emCentavos(totalPago);
        const peloAberto =
            emCentavos(totalAberto) + emCentavos(titMnyJuros) - emCentavos(titMnyDesconto);
        if (pelaLiquidez !== peloAberto || pelaLiquidez < 0) return undefined;
        return pelaLiquidez;
    };

    /** O valor (centavos) é igual ao líquido aberto pela régua? Indisponível ⇒ `false`. */
    public static bate = (v: ValoresAbertoTitulo | undefined, valorCentavos: number): boolean => {
        const liquido = ValorAbertoLiquido.calcularCentavos(v);
        return liquido !== undefined && liquido === valorCentavos;
    };

    /**
     * Tupla coerente de um título SEM juros, desconto nem pagamento (líquido = aberto = `valor`).
     * Uso: previsão local (`shadow`, carteira persistida — indicativa por construção) e fixtures.
     */
    public static semAcrescimos = (valor?: number): ValoresAbertoTitulo | undefined =>
        valor === undefined
            ? undefined
            : {
                  totalLiquido: valor,
                  totalPago: 0,
                  totalAberto: valor,
                  titMnyJuros: 0,
                  titMnyDesconto: 0,
              };
}

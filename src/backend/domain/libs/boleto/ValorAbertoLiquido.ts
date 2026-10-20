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
 * Régua líquida da I17b (ADR-0073): `abertoLiquido = totalLiquido`, CONFERIDO contra
 * `totalAberto + titMnyJuros − titMnyDesconto`, em centavos inteiros. O `totalLiquido` do `fin064`
 * JÁ desconta o pago (PRD 2026-10-20: 15 de 15 títulos com pagamento parcial); subtrair `totalPago`
 * de novo reprovaria todo título parcialmente pago. As duas fórmulas divergirem ou qualquer campo
 * faltar ⇒ `undefined` (o chamador trata como `VALOR_ABERTO_INDISPONIVEL`). `totalPago` segue na
 * tupla para quem precisa saber se houve pagamento (I18a, M4), mas não entra na conta.
 *
 * É a MESMA função nos três pontos do vínculo (elegibilidade, conferência pré-`PUT` e
 * pós-releitura) e no Δ do ajuste de centavos (I18a(3)). Pura: sem I/O, sem log, sem relógio.
 */
export default class ValorAbertoLiquido {
    public static calcularCentavos = (v?: ValoresAbertoTitulo): number | undefined => {
        if (!v) return undefined;
        const { totalLiquido, totalAberto, titMnyJuros, titMnyDesconto } = v;
        if (
            totalLiquido === undefined ||
            totalAberto === undefined ||
            titMnyJuros === undefined ||
            titMnyDesconto === undefined
        ) {
            return undefined;
        }
        const campos = [totalLiquido, totalAberto, titMnyJuros, titMnyDesconto];
        if (campos.some((c) => !Number.isFinite(c))) return undefined;
        const pelaLiquidez = emCentavos(totalLiquido);
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
     * Os cinco campos a partir da linha CRUA do `fin064`. `titMnyJuros`/`titMnyDesconto` NULOS
     * (chave presente) são o "sem juros/desconto" do ERP e viram 0 — seguro porque a régua confere
     * contra `totalLiquido`; chave ausente ou valor não numérico seguem ausentes (fail-closed).
     */
    public static daLinhaFin064 = (row: Record<string, unknown>): ValoresAbertoTitulo => {
        const num = (v: unknown): number | undefined => {
            if (v === null || v === undefined || v === '') return undefined;
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        };
        const zeroSeNulo = (chave: string): number | undefined =>
            chave in row && row[chave] === null ? 0 : num(row[chave]);
        const valores: ValoresAbertoTitulo = {};
        const totalLiquido = num(row.totalLiquido);
        const totalPago = num(row.totalPago);
        const totalAberto = num(row.totalAberto);
        const titMnyJuros = zeroSeNulo('titMnyJuros');
        const titMnyDesconto = zeroSeNulo('titMnyDesconto');
        if (totalLiquido !== undefined) valores.totalLiquido = totalLiquido;
        if (totalPago !== undefined) valores.totalPago = totalPago;
        if (totalAberto !== undefined) valores.totalAberto = totalAberto;
        if (titMnyJuros !== undefined) valores.titMnyJuros = titMnyJuros;
        if (titMnyDesconto !== undefined) valores.titMnyDesconto = titMnyDesconto;
        return valores;
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

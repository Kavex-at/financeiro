/**
 * ToleranciaResiduo — teto ABSOLUTO de resíduo de centavos do domínio de Permutas (ADR-0046 D1).
 *
 * Uma única constante para os dois usos do mesmo fenômeno (arredondamento da taxa a 3 casas):
 *   - a âncora I-Write-6 da baixa (`ReconciliacaoPermutaService`, ADR-0020), que absorve resíduo
 *     de até R$ 1,00 como variação;
 *   - a elegibilidade do ADIANTAMENTO (Gates 2 e 3 + roteamento de cliente-filtro), onde um saldo
 *     ou um em-aberto de até R$ 1,00 conta como zero.
 *
 * Absoluto, não proporcional: num adto de R$ 20 mi, 0,01% já seria R$ 2.000 de saldo real.
 *
 * **Escopo:** só o adiantamento. O `pago` estrito do wire (`ConexosTitulosClient.mapDetalheTitulos`,
 * que também serve às invoices), `Invoice.pago`, o SISPAG e a cobertura da baixa (I-Write-8a) NÃO
 * usam estes predicados — estender a tolerância a eles exige decisão própria.
 *
 * Comparação em CENTAVOS (`Math.round(v * 100)`), para que ruído de ponto flutuante nunca mude o
 * veredito na fronteira.
 */
export default class ToleranciaResiduo {
    /** Teto do resíduo, em BRL. Mesmo valor da âncora I-Write-6 (ADR-0020). */
    public static readonly LIMITE_BRL = 1;

    /**
     * Gate 2 reprovado: saldo a permutar (`mnyTitPermutar`, BRL) ≤ R$ 1,00. Ausente conta como zero
     * (conservador — sem prova de saldo, não há saldo).
     */
    public static readonly semSaldoPermutar = (valorPermutar?: number): boolean =>
        ToleranciaResiduo.dentroDoLimite(valorPermutar ?? 0);

    /**
     * Gate 3 (TOTALMENTE PAGO): em aberto (`mnyTitAberto`, BRL) ≤ R$ 1,00. Sem `valorAberto`, vale o
     * `pago` do wire; sem nenhum dos dois, `false` — nunca se infere pago sem prova.
     */
    public static readonly adiantamentoTotalmentePago = (detalhe: {
        pago?: boolean;
        valorAberto?: number;
    }): boolean => {
        if (detalhe.valorAberto !== undefined && Number.isFinite(detalhe.valorAberto)) {
            return ToleranciaResiduo.dentroDoLimite(detalhe.valorAberto);
        }
        return detalhe.pago === true;
    };

    private static readonly dentroDoLimite = (valorBrl: number): boolean =>
        Math.round(valorBrl * 100) <= ToleranciaResiduo.LIMITE_BRL * 100;
}

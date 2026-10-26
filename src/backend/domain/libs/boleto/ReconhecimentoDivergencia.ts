export interface ReconhecimentoVisto {
    deltaDiasVisto: number;
    /** Centavos. */
    valorBoletoVisto: number;
}

export interface SituacaoAtualDoPar {
    deltaDiasAtual: number;
    /** Centavos. */
    valorBoletoAtual: number;
}

/**
 * Validade do reconhecimento tipado da divergência de data (I15q, ADR-0078). DERIVADA, nunca
 * persistida: o reconhecimento vale enquanto o Δdias e o valor do boleto atuais forem IGUAIS aos que
 * a analista viu — qualquer mudança (1 dia, 1 centavo) o invalida. Pura; fail-closed.
 */
export default class ReconhecimentoDivergencia {
    public static valido = (
        reconhecimento: ReconhecimentoVisto | undefined,
        atual: SituacaoAtualDoPar,
    ): boolean =>
        reconhecimento !== undefined &&
        Number.isInteger(atual.deltaDiasAtual) &&
        Number.isInteger(atual.valorBoletoAtual) &&
        reconhecimento.deltaDiasVisto === atual.deltaDiasAtual &&
        reconhecimento.valorBoletoVisto === atual.valorBoletoAtual;
}

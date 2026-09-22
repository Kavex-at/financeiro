/**
 * Invoice (Fatura) — lado-crédito da permuta.
 *
 * Ontology: `ontology/entities/invoice.md`. Documento INVOICE finalizado no
 * Conexos (`com298` `tpdCod=128`), do mesmo processo (`priCod`) do Adiantamento.
 * Nesta Fatia 1 só lemos a invoice e verificamos se há uma "casada" para o
 * processo — não há baixa/reconciliação (Fatia 2).
 */
export default interface Invoice {
    docCod: string;
    priCod: string;
    dataEmissao: Date;
    valor: number;
    moeda: string;
    pago: boolean;
    exportador?: string;
    /**
     * Referência humana do documento — `docEspNumero` (fallback
     * `priEspRefcliente`). Exibida na coluna "Invoice em aberto" da tela.
     * Opcional: ausente quando o `com298/list` não traz o campo.
     */
    referencia?: string;
    /** Referência EXTERNA do processo (cliente) — `priEspRefcliente` (ex.: "0052INX/26"). */
    referenciaExterna?: string;
    /**
     * Valor da invoice em moeda estrangeira negociada (`titMnyValorMneg` /
     * `TituloAPagar.valorNegociado`). Distinto de `valor` (face). Opcional.
     */
    valorMoedaNegociada?: number;
    /**
     * Sigla da moeda NEGOCIADA do título (`com308` `moedaCod` 220→'USD' /
     * `moedaNome`), distinta de `moeda` (do DOCUMENTO — `moeEspSigla` null →
     * 'BRL'). É a moeda que rotula `valorMoedaNegociada` na tela Gestão.
     * Opcional — depende do detalhe do título.
     */
    moedaNegociada?: string;
    /** Taxa de câmbio negociada do título (`com308` `titFltTaxaMneg`). */
    taxa?: number;
    /**
     * Valor EM ABERTO vivo da invoice em moeda NEGOCIADA (`mnyTitAberto` do
     * detalhe / `taxa`). É o teto da distribuição automática (permuta Simples):
     * quanto a invoice ainda absorve, já descontadas baixas/permutas feitas por
     * fora. Opcional — ausente se o detalhe/taxa não estiverem disponíveis (a
     * distribuição cai no `valorMoedaNegociada`). Read-only.
     */
    valorAbertoNegociado?: number;
    /**
     * `true` quando a leitura do EM ABERTO vivo (`getDetalheTitulos`) **falhou** — o teto não foi
     * verificado nesta run, e a distribuição está usando o fallback `valorMoedaNegociada`.
     *
     * Distinto de `valorAbertoNegociado === undefined` sem esta marca, que significa "o ERP
     * respondeu, e o em-aberto/taxa simplesmente não existem para este título". As duas situações
     * levam ao mesmo fallback, mas só uma é uma FALHA — e quem lê o resultado (operador, log,
     * revisão de rateio) precisa poder distinguir "o teto é o negociado" de "não sabemos o teto".
     */
    valorAbertoNaoVerificado?: boolean;
}

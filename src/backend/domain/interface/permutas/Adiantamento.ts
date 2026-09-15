/**
 * Adiantamento (PROFORMA) — lado-débito da permuta.
 *
 * Ontology: `ontology/entities/adiantamento.md`. Documento financeiro a-pagar
 * do tipo PROFORMA (`com298` `tpdCod=99`), vinculado a um processo de importação
 * (`priCod`). Esta fatia (Fatia 1, READ-ONLY) apenas lê e avalia adiantamentos.
 *
 * `valorPermutar` é hidratado no detail (`getDetalheTitulos`) — `null` no list,
 * por isso opcional. `pago` também é hidratado no detail (`mnyTitAberto ≤ R$1,00`,
 * tolerância de resíduo da ADR-0046 — `ToleranciaResiduo.adiantamentoTotalmentePago`):
 * o list devolve `mnyTitAberto`/`mnyTitPago` NULL em produção, então o valor da
 * row do list é sempre `false` e é sobrescrito pelo detalhe na eleição.
 */
export default interface Adiantamento {
    docCod: string;
    priCod: string;
    /**
     * Filial (branch) que originou o adiantamento — invariante multi-filial I6.
     * Propagado ponta-a-ponta (eleição → snapshot row → INSERT `fil_cod`) para
     * que o painel/auditoria O6 saiba a filial de cada candidata (P0-2).
     */
    filCod: number;
    dataEmissao: Date;
    valor: number;
    moeda: string;
    pago: boolean;
    /** Saldo a permutar (detail `getDetalheTitulos`). Gate 2 (`> R$1,00`, ADR-0046). */
    valorPermutar?: number;
    /**
     * Valor já permutado (detail `getDetalheTitulos` → `mnyTitPermuta`,
     * "Valor Permutado" do RESUMO DOS TÍTULOS), em BRL. Distingue um
     * adiantamento pago SEM saldo a permutar PORQUE já foi 100% permutado
     * (`valorPermutado > 0` ⇒ motivo `JA_PERMUTADO`) de um que simplesmente
     * nunca teve saldo (`0`/ausente ⇒ `SEM_SALDO_PERMUTAR`). Opcional —
     * depende do detalhe do título.
     */
    valorPermutado?: number;
    /** Nome do exportador/destino do pagamento (`com298.dpeNomPessoa`). */
    exportador?: string;
    /**
     * Referência humana do documento — `docEspNumero` (fallback
     * `priEspRefcliente`). Exibida na coluna "Referência" da tela Gestão.
     * Opcional: ausente quando o `com298/list` não traz o campo.
     */
    referencia?: string;
    /** Referência EXTERNA do processo (cliente) — `priEspRefcliente` (ex.: "0052INX/26"). */
    referenciaExterna?: string;
    /**
     * Valor do documento em moeda estrangeira negociada (`titMnyValorMneg` /
     * `TituloAPagar.valorNegociado`). Distinto de `valor` (face). Exibido na
     * coluna "Valor Moeda Negociada". Opcional — depende do detalhe do título.
     */
    valorMoedaNegociada?: number;
    /**
     * Sigla da moeda NEGOCIADA do título (`com308` `moedaCod` 220→'USD' /
     * `moedaNome`), distinta de `moeda` (do DOCUMENTO — `moeEspSigla` null →
     * 'BRL'). É a moeda que rotula `valorMoedaNegociada` na coluna "Valor Moeda
     * Negociada" da tela Gestão. Opcional — depende do detalhe do título.
     */
    moedaNegociada?: string;
    /**
     * Taxa de câmbio negociada do título (`com308` `titFltTaxaMneg`). Travada na
     * contratação. Exibida no detalhe ("Taxa adiantamento") em qualquer status —
     * para os casados a taxa também vai no `permuta_casamento` (com a da invoice
     * + variação). Opcional — depende do detalhe do título.
     */
    taxa?: number;
    /**
     * Valor de FACE do título em BRL (`mnyTitValor` do detail). Total a pagar —
     * base do "progresso de pagamento" dos bloqueados por `nao-pago`. Identidade:
     * `valorTotal = valorPago + valorAberto`. Opcional — depende do detalhe.
     */
    valorTotal?: number;
    /**
     * Saldo AINDA em aberto do título em BRL (`mnyTitAberto` do detail). Quanto
     * falta pagar; `≤ R$1,00` ⇒ totalmente pago (Gate 3, ADR-0046). Opcional — depende do detalhe.
     */
    valorAberto?: number;
    /**
     * Importador (cliente Columbia) do PROCESSO — `pesCod` do `imp021`. Hidratado
     * na eleição via `listProcessos`. Usado para rotear adtos de "clientes filtro"
     * ao estado `permuta-manual`. Opcional.
     */
    pesCod?: string;
    /** Nome do importador (`imp021.dpeNomPessoa`) — exibição/auditoria. Opcional. */
    importador?: string;
}

/**
 * Forma de pagamento do TÍTULO no Conexos — campo `titVldPagopor` ("Pago Por").
 *
 * É a "Situação" que a analista vê no `psq014`/`fin064` (ex.: BOLETO) e NÃO é o vínculo DDA:
 * um título pode ser `BOLETO` aqui e não ter boleto DDA associado (`tem_boleto = false`) — o
 * ERP só associa quando valor E vencimento batem com o `fin124`. Ver
 * `ontology/_inbox/sispag-boleto-dda-sondagem.md`.
 *
 * Rótulos do domínio documentado em `docs/conexos-api/070-com3.json` (`FinTituloFin`) e
 * `090-fin0.json` (`FinTitulo`). Não existe "TED": qual código a Columbia usa para TED ainda
 * não está confirmado — não deduza um.
 */
export const PAGO_POR_CONEXOS = {
    CHEQUE: 1,
    TEF: 2,
    CARTEIRA: 3,
    EXTRA_CAIXA: 4,
    CARTAO_DE_CREDITO: 5,
    BOLETO: 6,
    CAIXA: 7,
    TRANSACAO: 8,
    DOCUMENTO: 9,
    TRANSACAO_AUTOMATICA: 10,
} as const;
export type PagoPorConexos = (typeof PAGO_POR_CONEXOS)[keyof typeof PAGO_POR_CONEXOS];

/** Rótulo exibido ao operador, igual ao do Conexos. */
export const PAGO_POR_CONEXOS_ROTULO: Readonly<Record<PagoPorConexos, string>> = {
    1: 'CHEQUE',
    2: 'TEF',
    3: 'CARTEIRA',
    4: 'EXTRA-CAIXA',
    5: 'CARTÃO DE CRÉDITO',
    6: 'BOLETO',
    7: 'CAIXA',
    8: 'TRANSAÇÃO',
    9: 'DOCUMENTO',
    10: 'TRANSAÇÃO AUTOMÁTICA',
};

export class PagoPorConexosRotulo {
    /** Rótulo do código; `undefined` para ausente ou fora do domínio — quem exibe decide o "—". */
    public static de = (codigo?: number): string | undefined =>
        codigo !== undefined && Object.hasOwn(PAGO_POR_CONEXOS_ROTULO, codigo)
            ? PAGO_POR_CONEXOS_ROTULO[codigo as PagoPorConexos]
            : undefined;
}

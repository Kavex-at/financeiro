import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Item marcado como BOLETO que não tem código de barras para sair na remessa.
 *
 * O barcode não existe no título — medido 0% em `fin064`, `titulosPendentes` e `com308`
 * (`ontology/_inbox/sispag-boleto-dda-sondagem.md`). Ele só chega ao item pela associação do
 * boleto DDA (`fin124`) que o ERP sinaliza em `titVldReflexoDdaAssoc`. Sem essa associação, o
 * `.REM` sairia com **segmento J sem barras** — um pagamento que o banco não liquida.
 *
 * Fail-closed no ENVIO (não no rascunho): a analista pode marcar BOLETO enquanto monta o lote;
 * a validação autoritativa é ao vivo na geração da remessa, como o resto do fluxo (anti-drift).
 */
export default class BoletoSemCodigoBarrasError extends Error implements HandlerError {
    public readonly code = 'BOLETO_SEM_CODIGO_BARRAS';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 409;
    public readonly details?: unknown;

    public constructor(params: { docCod: string; titCod: string; credor?: string }) {
        super(
            `título ${params.docCod}/${params.titCod} is BOLETO but has no DDA barcode associated`,
        );
        this.name = 'BoletoSemCodigoBarrasError';
        const quem = params.credor ? ` (${params.credor})` : '';
        this.userMessage =
            `O título ${params.docCod}/${params.titCod}${quem} está marcado como BOLETO, mas o Conexos ` +
            'não tem um boleto DDA associado a ele — a remessa sairia sem código de barras. ' +
            'Importe o arquivo DDA do boleto no fin124 ou troque a forma de pagamento do item.';
        this.details = params;
    }
}

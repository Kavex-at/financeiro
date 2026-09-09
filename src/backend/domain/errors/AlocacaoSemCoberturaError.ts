import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * IRMÃO-DÉFICIT do `AlocacaoSaldoError`: aquele barra o EXCESSO (o analista alocou mais do que
 * cabe num dos lados); este barra a FALTA (os títulos em aberto da invoice não cobrem o que foi
 * alocado). Os dois são reprovação de regra de negócio, não falha de sistema ⇒ HTTP 422.
 *
 * ── I-Write-8a (pré-POST, fail-closed) ──────────────────────────────────────────────────
 * Lançado ANTES da primeira chamada de baixa do par: nada foi escrito no ERP, nenhum borderô foi
 * consumido, e a trilha que diz "não executado" está dizendo a verdade. Abortar aqui é
 * fail-closed de verdade E de graça — diferente do resíduo que só aparece DEPOIS de baixas já
 * POSTadas, que não dá para desfazer e por isso termina em `parcial` (I-Write-8b).
 *
 * A **cobertura** é derivada, não lida (ver `ReconciliacaoPermutaService.coberturaEmAberto`):
 * `Σ (titMnyValorMneg − titMnyTotPago / titFltTaxaMneg)` sobre os títulos ATIVOS. NÃO é a soma da
 * face: `titVldStatus = 1` significa ATIVO (ciclo de vida do registro), não "em aberto", e um
 * título quitado volta com a face cheia — sondado em produção (2026-09-08): doc 9320, face USD
 * 83.476,12, aberto 0.
 *
 * Saída para a analista: RE-ALOCAR o par (a re-alocação cunha chave nova e libera um novo
 * lançamento). Por isso `retryable = false` — repetir o mesmo POST daria o mesmo 422.
 *
 * Ver `business-rules/fin010-write-contract.md` (I-Write-8a) e ADR-0044.
 */
export default class AlocacaoSemCoberturaError extends Error implements HandlerError {
    public readonly code = 'ALOCACAO_SEM_COBERTURA';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    constructor(params: {
        adiantamentoDocCod: number | string;
        invoiceDocCod: number | string;
        /** Σ do em-aberto DERIVADO dos títulos ativos, em moeda negociada. */
        cobertura: number;
        valorAlocado: number;
    }) {
        const deficit = Math.round((params.valorAlocado - params.cobertura) * 100) / 100;
        super(
            `allocation exceeds open coverage: adto=${params.adiantamentoDocCod} ` +
                `invoice=${params.invoiceDocCod} allocated=${params.valorAlocado} ` +
                `coverage=${params.cobertura} deficit=${deficit}`,
        );
        this.name = 'AlocacaoSemCoberturaError';
        this.userMessage =
            `Os títulos em aberto da invoice ${params.invoiceDocCod} não cobrem o valor alocado ` +
            `(em aberto: ${params.cobertura.toFixed(2)}; alocado: ${params.valorAlocado.toFixed(2)}; ` +
            `faltam ${deficit.toFixed(2)}). Nada foi baixado no Conexos. Re-aloque o par com o ` +
            'valor que cabe — ou aloque o restante contra outra invoice.';
        this.details = {
            adiantamentoDocCod: String(params.adiantamentoDocCod),
            invoiceDocCod: String(params.invoiceDocCod),
            cobertura: params.cobertura,
            valorAlocado: params.valorAlocado,
            deficit,
        };
    }
}

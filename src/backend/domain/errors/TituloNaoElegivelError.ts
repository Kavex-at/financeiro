import type { SituacaoPagamento } from '../interface/sispag/SituacaoPagamento.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Lançado ao tentar incluir num lote um título que NÃO está elegível — não
 * `liberado` (alçada), já `pago` ou com a situação de pagamento BLOQUEADA (I2, ADR-0075). Reprovação de regra de negócio, não
 * falha de sistema. Rota → HTTP 422. Ver business-rules/elegibilidade-titulo-lote.md.
 */
export default class TituloNaoElegivelError extends Error implements HandlerError {
    public readonly code = 'TITULO_NAO_ELEGIVEL';
    public readonly userMessage: string;
    public readonly retryable = false;
    public readonly statusCode = 422;
    public readonly details?: unknown;

    constructor(params: {
        docCod: string;
        titCod: string;
        motivo: 'nao-liberado' | 'ja-pago' | 'nao-encontrado' | 'situacao-pagamento';
        /** Obrigatória com `motivo: 'situacao-pagamento'`. */
        situacao?: SituacaoPagamento;
    }) {
        super(`titulo ${params.docCod}/${params.titCod} not eligible: ${params.motivo}`);
        this.name = 'TituloNaoElegivelError';
        this.userMessage =
            params.motivo === 'situacao-pagamento' && params.situacao
                ? TituloNaoElegivelError.mensagemDaSituacao(params.situacao)
                : params.motivo === 'ja-pago'
                  ? 'Este título já está pago — não pode entrar no lote.'
                  : params.motivo === 'nao-encontrado'
                    ? 'Título não encontrado no Conexos (pode ter mudado). Recarregue o painel.'
                    : 'Este título não está liberado para pagamento (alçada) — não pode entrar no lote.';
        this.details = {
            docCod: params.docCod,
            titCod: params.titCod,
            motivo: params.motivo,
            ...(params.situacao
                ? {
                      motivoPagamento: params.situacao.principal,
                      motivosPagamento: params.situacao.motivos,
                      dono: params.situacao.dono,
                      acao: params.situacao.acao,
                  }
                : {}),
        };
    }

    /** "Aguardando aprovação (…): resolve o aprovador. Abra no Conexos." — sem repetir a regra. */
    private static mensagemDaSituacao = (situacao: SituacaoPagamento): string => {
        const detalhe = situacao.detalhe ? ` (${situacao.detalhe})` : '';
        return `Este título não pode entrar no lote: ${situacao.rotulo ?? 'bloqueado'}${detalhe}.`;
    };
}

import type { FonteSituacao, SituacaoPagamento } from '../interface/sispag/SituacaoPagamento.js';
import type { HandlerError } from '../libs/handler/HandlerError.js';

/**
 * Lançado ao tentar incluir num lote um título que NÃO está elegível — não
 * `liberado` (alçada), já `pago` ou com a situação de pagamento BLOQUEADA (I2, ADR-0075). Reprovação de regra de negócio, não
 * falha de sistema. Rota → HTTP 422. Ver business-rules/elegibilidade-titulo-lote.md.
 *
 * I19s: também quando a situação NÃO pôde ser avaliada — título fora da carteira persistida
 * (`fora-da-carteira`) ou leitura/fonte de contexto indisponível (`situacao-indisponivel`). A
 * inclusão é fail-closed: título que a regra não avaliou não entra.
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
        motivo:
            | 'nao-liberado'
            | 'ja-pago'
            | 'nao-encontrado'
            | 'situacao-pagamento'
            | 'fora-da-carteira'
            | 'situacao-indisponivel';
        /** Obrigatória com `motivo: 'situacao-pagamento'`. */
        situacao?: SituacaoPagamento;
        /** Com `motivo: 'situacao-indisponivel'`: as fontes de contexto que falharam. */
        fontesIndisponiveis?: FonteSituacao[];
    }) {
        super(`titulo ${params.docCod}/${params.titCod} not eligible: ${params.motivo}`);
        this.name = 'TituloNaoElegivelError';
        this.userMessage = TituloNaoElegivelError.mensagemDe(params);
        this.details = {
            docCod: params.docCod,
            titCod: params.titCod,
            motivo: params.motivo,
            ...(params.fontesIndisponiveis?.length
                ? { fontesIndisponiveis: params.fontesIndisponiveis }
                : {}),
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

    private static mensagemDe = (
        params: ConstructorParameters<typeof TituloNaoElegivelError>[0],
    ): string => {
        switch (params.motivo) {
            case 'situacao-pagamento':
                return params.situacao
                    ? TituloNaoElegivelError.mensagemDaSituacao(params.situacao)
                    : 'Este título está bloqueado para pagamento — não pode entrar no lote.';
            case 'ja-pago':
                return 'Este título já está pago — não pode entrar no lote.';
            case 'nao-encontrado':
                return 'Título não encontrado no Conexos (pode ter mudado). Recarregue o painel.';
            case 'fora-da-carteira':
                return 'Este título ainda não está na carteira do SISPAG (pode ter sido criado ou alterado no Conexos depois da última atualização), então a situação de pagamento dele não foi conferida. Recarregue o painel e tente de novo.';
            case 'situacao-indisponivel':
                return TituloNaoElegivelError.mensagemIndisponivel(params.fontesIndisponiveis);
            case 'nao-liberado':
                return 'Este título não está liberado para pagamento (alçada) — não pode entrar no lote.';
        }
    };

    private static readonly NOME_FONTE: Readonly<Record<FonteSituacao, string>> = {
        DUPLICIDADE: 'duplicidade',
        AJUSTE_CENTAVOS: 'ajuste de centavos',
        BOLETO: 'sugestão de boleto',
    };

    /** "…agora (sem a consulta de duplicidade). Tente de novo em instantes." */
    private static mensagemIndisponivel = (fontes?: FonteSituacao[]): string => {
        const quais = fontes?.length
            ? ` (sem a consulta de ${fontes.map((f) => TituloNaoElegivelError.NOME_FONTE[f]).join(', ')})`
            : '';
        return `Não foi possível conferir a situação de pagamento deste título agora${quais}, então ele não entrou no lote. Tente de novo em instantes.`;
    };

    /** "Aguardando aprovação (…): resolve o aprovador. Abra no Conexos." — sem repetir a regra. */
    private static mensagemDaSituacao = (situacao: SituacaoPagamento): string => {
        const detalhe = situacao.detalhe ? ` (${situacao.detalhe})` : '';
        return `Este título não pode entrar no lote: ${situacao.rotulo ?? 'bloqueado'}${detalhe}.`;
    };
}

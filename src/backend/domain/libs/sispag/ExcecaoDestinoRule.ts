import { inject, injectable } from 'tsyringe';
import DocumentoFavorecidoIndisponivelError from '../../errors/DocumentoFavorecidoIndisponivelError.js';
import ExcecaoAprovacaoProprioCadastranteError from '../../errors/ExcecaoAprovacaoProprioCadastranteError.js';
import ExcecaoEstadoInvalidoError from '../../errors/ExcecaoEstadoInvalidoError.js';
import ExcecaoSemPermissaoError from '../../errors/ExcecaoSemPermissaoError.js';
import ExcecaoTitularidadeError, {
    EXCECAO_TITULARIDADE_MOTIVO,
} from '../../errors/ExcecaoTitularidadeError.js';
import {
    CHAVE_PIX_TIPO,
    DESTINO_MANUAL_TIPO,
    type DestinoManual,
    EXCECAO_ESTADO,
    type ExcecaoEstado,
} from '../../interface/sispag/SispagInterface.js';
import DestinoManualValidator from './DestinoManualValidator.js';

/** Ações que mudam o estado de uma exceção (cada transição é uma ação nomeada, P3). */
export const EXCECAO_ACAO = {
    APROVAR: 'aprovar',
    REJEITAR: 'rejeitar',
    REVOGAR: 'revogar',
    SUBSTITUIR: 'substituir',
} as const;

export type ExcecaoAcao = (typeof EXCECAO_ACAO)[keyof typeof EXCECAO_ACAO];

/** Para onde cada ação leva, e de que estado ela parte. */
const TRANSICAO: Readonly<Record<ExcecaoAcao, { de: ExcecaoEstado; para: ExcecaoEstado }>> = {
    [EXCECAO_ACAO.APROVAR]: { de: EXCECAO_ESTADO.PENDENTE, para: EXCECAO_ESTADO.APROVADA },
    [EXCECAO_ACAO.REJEITAR]: { de: EXCECAO_ESTADO.PENDENTE, para: EXCECAO_ESTADO.REJEITADA },
    [EXCECAO_ACAO.REVOGAR]: { de: EXCECAO_ESTADO.APROVADA, para: EXCECAO_ESTADO.REVOGADA },
    [EXCECAO_ACAO.SUBSTITUIR]: { de: EXCECAO_ESTADO.APROVADA, para: EXCECAO_ESTADO.SUBSTITUIDA },
};

const TERMINAIS: readonly ExcecaoEstado[] = [
    EXCECAO_ESTADO.REJEITADA,
    EXCECAO_ESTADO.SUBSTITUIDA,
    EXCECAO_ESTADO.REVOGADA,
];

/** Valor que `ator(req)` devolve sem usuário autenticado: nunca é uma pessoa. */
const ATOR_DESCONHECIDO = 'unknown';

const soDigitos = (v: string): string => v.replace(/\D/g, '');

/**
 * ExcecaoDestinoRule — as regras PURAS da exceção de destino (ADR-0061, I12). Sem I/O.
 *
 * - **I12b, dupla validação:** `aprovadoPor ≠ cadastradoPor`, comparados como identidade
 *   normalizada (sem caixa nem espaço). FALHA FECHADA: id ausente, vazio ou o "unknown" do ator
 *   não autenticado nunca conta como "diferente". Vale para TED e PIX (sem a isenção do PIX da
 *   ADR-0054 D11).
 * - **Máquina de estados** (`state-machines/excecao-destino.md`): `PENDENTE → APROVADA | REJEITADA`;
 *   `APROVADA → REVOGADA | SUBSTITUIDA`; o resto é inválido e os terminais não saem. Quem cadastrou
 *   PODE rejeitar a própria pendente e revogar a aprovada (reduz risco); só APROVAR é vedado.
 * - **I12i/I10i, titularidade:** o titular tem de ser o documento do favorecido; PIX só com chave
 *   CPF/CNPJ igual a esse documento. Compara documentos normalizados (só dígitos) e nunca os
 *   carrega em erro ou log (I10h).
 *
 * O FORMATO do destino (DV de CPF/CNPJ, e-mail, telefone) segue sendo do `DestinoManualValidator`.
 */
@injectable()
export default class ExcecaoDestinoRule {
    public constructor(
        @inject(DestinoManualValidator) private readonly validator: DestinoManualValidator,
    ) {}

    /** TED e PIX exigem aprovação de segunda pessoa — sem isenção. */
    public exigeAprovacao = (_destino: DestinoManual): boolean => true;

    public exigirPermissao = (temPermissao: boolean): void => {
        if (!temPermissao) throw new ExcecaoSemPermissaoError();
    };

    public exigirAprovadorDiferente = (params: {
        cadastradoPor?: string;
        aprovadoPor?: string;
        excecaoId?: string;
    }): void => {
        const cadastrante = this.identidade(params.cadastradoPor);
        const aprovador = this.identidade(params.aprovadoPor);
        if (cadastrante === undefined || aprovador === undefined || cadastrante === aprovador) {
            throw new ExcecaoAprovacaoProprioCadastranteError(
                params.excecaoId ? { excecaoId: params.excecaoId } : {},
            );
        }
    };

    /**
     * Resolve a transição pedida: devolve o estado novo ou lança. Cobre a regra de quem pode
     * (aprovar ≠ cadastrante) e a de quando (estado de partida).
     */
    public decidir = (
        acao: ExcecaoAcao,
        ctx: { estado: ExcecaoEstado; cadastradoPor?: string; ator?: string; excecaoId?: string },
    ): ExcecaoEstado => {
        const t = TRANSICAO[acao];
        if (ctx.estado !== t.de) {
            throw new ExcecaoEstadoInvalidoError({
                ...(ctx.excecaoId ? { excecaoId: ctx.excecaoId } : {}),
                estadoAtual: ctx.estado,
                acao,
            });
        }
        if (acao === EXCECAO_ACAO.APROVAR) {
            this.exigirAprovadorDiferente({
                cadastradoPor: ctx.cadastradoPor,
                aprovadoPor: ctx.ator,
                ...(ctx.excecaoId ? { excecaoId: ctx.excecaoId } : {}),
            });
        }
        return t.para;
    };

    public ehTerminal = (estado: ExcecaoEstado): boolean => TERMINAIS.includes(estado);

    /**
     * I10i/I12i. `documentoFavorecido` é o `pdcDocFederal` lido ao vivo (pode vir com pontuação).
     * Ausente ou inválido = FALHA FECHADA (`DocumentoFavorecidoIndisponivelError`).
     */
    public conferirTitularidade = (
        destino: DestinoManual,
        documentoFavorecido: string | undefined,
    ): void => {
        const documento = documentoFavorecido === undefined ? '' : soDigitos(documentoFavorecido);
        if (!this.validator.documentoValido(documento)) {
            throw new DocumentoFavorecidoIndisponivelError();
        }
        if (soDigitos(destino.titularDocumento) !== documento) {
            throw new ExcecaoTitularidadeError({
                motivo: EXCECAO_TITULARIDADE_MOTIVO.TITULAR_DIVERGENTE,
            });
        }
        if (destino.tipo !== DESTINO_MANUAL_TIPO.CHAVE_PIX) return;
        if (destino.chavePixTipo !== CHAVE_PIX_TIPO.CPF_CNPJ) {
            throw new ExcecaoTitularidadeError({
                motivo: EXCECAO_TITULARIDADE_MOTIVO.CHAVE_NAO_CPF_CNPJ,
            });
        }
        if (soDigitos(destino.chavePix) !== documento) {
            throw new ExcecaoTitularidadeError({
                motivo: EXCECAO_TITULARIDADE_MOTIVO.CHAVE_DIVERGENTE,
            });
        }
    };

    /** Identidade normalizada, ou `undefined` quando não é uma pessoa identificável. */
    private identidade = (id: string | undefined): string | undefined => {
        const normalizada = id?.trim().toLowerCase();
        if (!normalizada || normalizada === ATOR_DESCONHECIDO) return undefined;
        return normalizada;
    };
}

import { injectable } from 'tsyringe';
import SelfConferenceError from '../../errors/SelfConferenceError.js';
import { type LotePagamento, MODALIDADE } from '../../interface/sispag/SispagInterface.js';

/** Valor que `ator(req)` devolve sem usuário autenticado: nunca é uma pessoa. */
const ATOR_DESCONHECIDO = 'unknown';

/** Papel de quem fica impedido de conferir (I13l). Constantes tipadas — nunca string crua. */
export const CONFERENCIA_IMPEDIMENTO = {
    FINALIZOU: 'FINALIZOU',
    INCLUIU_ITEM: 'INCLUIU_ITEM',
    CRIOU_LOTE_MANUAL: 'CRIOU_LOTE_MANUAL',
    NAO_IDENTIFICADO: 'NAO_IDENTIFICADO',
} as const;

export type ConferenciaImpedimento =
    (typeof CONFERENCIA_IMPEDIMENTO)[keyof typeof CONFERENCIA_IMPEDIMENTO];

/**
 * ConferenciaLoteRule — as regras PURAS da conferência por 2ª pessoa (ADR-0063, I13l). Sem I/O.
 *
 * - `exigeConferencia`: o lote tem ≥1 item TED ou PIX (derivado; lote só de boleto não exige).
 * - Segregação de funções: o conferente NÃO é `finalizadoPor`, nem `incluidoPor` de nenhum item,
 *   nem `criadoPor` de lote MANUAL (o automático é criado pelo cron). Comparação pelo username
 *   canônico normalizado (sem caixa nem espaço), espelho de I12b. FALHA FECHADA: ator vazio ou o
 *   "unknown" do não autenticado nunca conta como "outra pessoa".
 */
@injectable()
export default class ConferenciaLoteRule {
    public exigeConferencia = (lote: Pick<LotePagamento, 'itens'>): boolean =>
        lote.itens.some((i) => i.modalidade === MODALIDADE.TED || i.modalidade === MODALIDADE.PIX);

    /** O motivo pelo qual `ator` não pode conferir/devolver o lote, ou `undefined` se pode. */
    public impedimento = (
        lote: Pick<LotePagamento, 'finalizadoPor' | 'criadoPor' | 'automatico' | 'itens'>,
        ator: string | undefined,
    ): ConferenciaImpedimento | undefined => {
        const quem = this.identidade(ator);
        if (quem === undefined) return CONFERENCIA_IMPEDIMENTO.NAO_IDENTIFICADO;
        if (this.identidade(lote.finalizadoPor) === quem) return CONFERENCIA_IMPEDIMENTO.FINALIZOU;
        if (lote.itens.some((i) => this.identidade(i.incluidoPor) === quem)) {
            return CONFERENCIA_IMPEDIMENTO.INCLUIU_ITEM;
        }
        if (lote.automatico !== true && this.identidade(lote.criadoPor) === quem) {
            return CONFERENCIA_IMPEDIMENTO.CRIOU_LOTE_MANUAL;
        }
        return undefined;
    };

    /** Lança `SelfConferenceError` (403) quando o ator está impedido. */
    public exigirOutraPessoa = (
        lote: Pick<LotePagamento, 'id' | 'finalizadoPor' | 'criadoPor' | 'automatico' | 'itens'>,
        ator: string | undefined,
    ): void => {
        const impedimento = this.impedimento(lote, ator);
        if (impedimento) throw new SelfConferenceError({ loteId: lote.id, impedimento });
    };

    private identidade = (id: string | undefined): string | undefined => {
        const normalizada = id?.trim().toLowerCase();
        if (!normalizada || normalizada === ATOR_DESCONHECIDO) return undefined;
        return normalizada;
    };
}

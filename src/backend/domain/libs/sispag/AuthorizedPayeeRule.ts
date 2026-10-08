import { injectable } from 'tsyringe';
import AuthorizedPayeeActiveExistsError from '../../errors/AuthorizedPayeeActiveExistsError.js';
import AuthorizedPayeeStateError from '../../errors/AuthorizedPayeeStateError.js';
import PayeeApprovalBySolicitorError from '../../errors/PayeeApprovalBySolicitorError.js';
import PayeeDecisionReasonRequiredError from '../../errors/PayeeDecisionReasonRequiredError.js';
import PayeeDestinationChangedSinceShownError from '../../errors/PayeeDestinationChangedSinceShownError.js';
import PayeeReapprovalNotConfirmedError from '../../errors/PayeeReapprovalNotConfirmedError.js';
import PayeeWithoutPaymentDataError from '../../errors/PayeeWithoutPaymentDataError.js';
import {
    AUTHORIZED_PAYEE_STATE,
    type AuthorizedPayee,
    type AuthorizedPayeeState,
    PAYEE_CHECK_RESULT,
    type PayeeCheckResult,
    type PayeeDestinationReading,
} from '../../interface/sispag/AuthorizedPayeeInterface.js';

/** O que `solicitar` faz: F1 cria um registro novo; F5 confirma a reaprovação aberta. */
export type PayeeRequestAction = 'CRIAR' | 'CONFIRMAR';

const TERMINAIS: ReadonlySet<AuthorizedPayeeState> = new Set([
    AUTHORIZED_PAYEE_STATE.REJEITADO,
    AUTHORIZED_PAYEE_STATE.REVOGADO,
]);

/**
 * AuthorizedPayeeRule — a state machine `favorecido-autorizado` (ADR-0065, F1–F7) e a precedência
 * do resultado da verificação (I14d), PURAS: sem I/O, sem relógio, sem valor de destino (só a
 * impressão). Quem lê o cadastro e grava é o `AuthorizedPayeeService`.
 */
@injectable()
export default class AuthorizedPayeeRule {
    /**
     * F1/F5. Sem registro vigente (ou só terminal) → criar PENDENTE (nunca AUTORIZADO). Reaprovação
     * aberta pelo sistema → confirmar o pedido (grava o solicitante). PENDENTE/AUTORIZADO → 409.
     */
    public solicitar = (vigente: AuthorizedPayee | null): PayeeRequestAction => {
        if (!vigente || TERMINAIS.has(vigente.estado)) return 'CRIAR';
        if (vigente.estado === AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE) return 'CONFIRMAR';
        throw new AuthorizedPayeeActiveExistsError({
            pesCod: vigente.pesCod,
            modalidade: vigente.modalidade,
            estado: vigente.estado,
        });
    };

    /**
     * F2/F6. Ordem das guardas: estado → reaprovação confirmada → aprovador ≠ solicitante → leitura
     * do cadastro → destino igual ao mostrado. Devolve o estado de destino (`AUTORIZADO`).
     */
    public aprovar = (
        atual: AuthorizedPayee,
        params: { ator: string; leitura: PayeeDestinationReading; fingerprintMostrado: string },
    ): AuthorizedPayeeState => {
        if (
            atual.estado !== AUTHORIZED_PAYEE_STATE.PENDENTE &&
            atual.estado !== AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE
        ) {
            throw new AuthorizedPayeeStateError({
                id: atual.id,
                estado: atual.estado,
                acao: 'aprovada',
            });
        }
        if (!atual.solicitadoPor) {
            throw new PayeeReapprovalNotConfirmedError({ id: atual.id });
        }
        if (atual.solicitadoPor === params.ator) {
            throw new PayeeApprovalBySolicitorError({ id: atual.id });
        }
        const { leitura } = params;
        if (leitura.status === 'FALHA_LEITURA') {
            // Falha fechada (I14f): sem leitura não há o que comparar. Mesmo erro de "mudou": a tela
            // recarrega e o aprovador tenta de novo.
            throw new PayeeDestinationChangedSinceShownError({ id: atual.id });
        }
        if (leitura.status === 'SEM_DADO') {
            throw new PayeeWithoutPaymentDataError({ id: atual.id, modalidade: atual.modalidade });
        }
        if (leitura.fingerprint !== params.fingerprintMostrado) {
            throw new PayeeDestinationChangedSinceShownError({ id: atual.id });
        }
        return AUTHORIZED_PAYEE_STATE.AUTORIZADO;
    };

    /** F3. Só de PENDENTE, com motivo. */
    public rejeitar = (atual: AuthorizedPayee, motivo: string): AuthorizedPayeeState => {
        if (atual.estado !== AUTHORIZED_PAYEE_STATE.PENDENTE) {
            throw new AuthorizedPayeeStateError({
                id: atual.id,
                estado: atual.estado,
                acao: 'rejeitada',
            });
        }
        this.exigirMotivo(atual.id, motivo, 'rejeitar');
        return AUTHORIZED_PAYEE_STATE.REJEITADO;
    };

    /** F7. De AUTORIZADO ou REAPROVACAO_PENDENTE, com motivo. */
    public revogar = (atual: AuthorizedPayee, motivo: string): AuthorizedPayeeState => {
        if (
            atual.estado !== AUTHORIZED_PAYEE_STATE.AUTORIZADO &&
            atual.estado !== AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE
        ) {
            throw new AuthorizedPayeeStateError({
                id: atual.id,
                estado: atual.estado,
                acao: 'revogada',
            });
        }
        this.exigirMotivo(atual.id, motivo, 'revogar');
        return AUTHORIZED_PAYEE_STATE.REVOGADO;
    };

    /**
     * F4 (sistema). Só AUTORIZADO, só com leitura bem-sucedida, só na MESMA versão do segredo e só
     * com impressão diferente. Falha de leitura e cadastro sem dado nunca abrem (I14d, I14f).
     */
    public abreReaprovacao = (atual: AuthorizedPayee, leitura: PayeeDestinationReading): boolean =>
        atual.estado === AUTHORIZED_PAYEE_STATE.AUTORIZADO &&
        leitura.status === 'OK' &&
        leitura.keyId === atual.fingerprintChaveId &&
        leitura.fingerprint !== atual.fingerprint;

    /**
     * I14d — resultado da verificação de um (favorecido, modalidade), com a precedência
     * FALHA_LEITURA > SEM_DADO_PAGAMENTO > FAVORECIDO_NAO_AUTORIZADO > DESTINO_ALTERADO.
     *
     * Reaprovação aberta conta como DESTINO_ALTERADO (é o que aconteceu). Autorização feita com outra
     * versão do segredo não é comparável: FAVORECIDO_NAO_AUTORIZADO, sem abrir reaprovação.
     */
    public classificar = (
        vigente: AuthorizedPayee | null,
        leitura: PayeeDestinationReading,
    ): PayeeCheckResult => {
        if (leitura.status === 'FALHA_LEITURA') return PAYEE_CHECK_RESULT.FALHA_LEITURA;
        if (leitura.status === 'SEM_DADO') return PAYEE_CHECK_RESULT.SEM_DADO_PAGAMENTO;
        if (vigente?.estado === AUTHORIZED_PAYEE_STATE.REAPROVACAO_PENDENTE) {
            return PAYEE_CHECK_RESULT.DESTINO_ALTERADO;
        }
        if (
            vigente?.estado !== AUTHORIZED_PAYEE_STATE.AUTORIZADO ||
            vigente.fingerprintChaveId !== leitura.keyId
        ) {
            return PAYEE_CHECK_RESULT.FAVORECIDO_NAO_AUTORIZADO;
        }
        return vigente.fingerprint === leitura.fingerprint
            ? PAYEE_CHECK_RESULT.OK
            : PAYEE_CHECK_RESULT.DESTINO_ALTERADO;
    };

    private exigirMotivo = (id: string, motivo: string, acao: string): void => {
        if (motivo.trim().length === 0) throw new PayeeDecisionReasonRequiredError({ id, acao });
    };
}

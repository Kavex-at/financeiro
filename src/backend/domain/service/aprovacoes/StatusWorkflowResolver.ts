import { injectable } from 'tsyringe';
import { ETAPA_STATUS, STATUS_WORKFLOW } from '../../interface/aprovacoes/constants.js';
import type { EtapaStatus, StatusWorkflow } from '../../interface/aprovacoes/constants.js';

/**
 * StatusWorkflowResolver — deriva o status agregado do título a partir das suas etapas.
 *
 * O status **não é armazenado como verdade própria**: é recalculado a cada ingestão a partir das
 * etapas ativas. A Frente V é read-only no ERP — o que "transiciona" é a leitura.
 *
 * Regra de derivação em `ontology/state-machines/aprovacao-titulo.md`, aplicada **na ordem**;
 * a primeira condição que casar vence.
 */
@injectable()
export default class StatusWorkflowResolver {
    /**
     * | # | Condição                    | Estado          |
     * |---|-----------------------------|-----------------|
     * | 1 | nenhuma etapa ativa         | `SEM_WORKFLOW`  |
     * | 2 | alguma `INDETERMINADO`      | `INDETERMINADO` |
     * | 3 | alguma `REJEITADA`          | `REJEITADO`     |
     * | 4 | alguma `PENDENTE`           | `AGUARDANDO`    |
     * | 5 | todas `CONCLUIDA`           | `APROVADO`      |
     *
     * **Por que `INDETERMINADO` precede tudo:** as regras 3, 4 e 5 afirmam algo sobre o título.
     * Havendo uma etapa ilegível, qualquer afirmação pode estar errada — e "aprovado" é justamente
     * a afirmação mais cara de errar num painel de contas a pagar. O estado honesto é "não sei".
     *
     * `SEM_WORKFLOW` não é erro nem ausência de dado: cerca de **metade** dos títulos da filial 2
     * está nesse estado, e isso é informação de diagnóstico que o cliente quer ver.
     */
    public resolver = (statusDasEtapas: EtapaStatus[]): StatusWorkflow => {
        if (statusDasEtapas.length === 0) return STATUS_WORKFLOW.SEM_WORKFLOW;
        if (statusDasEtapas.includes(ETAPA_STATUS.INDETERMINADO)) {
            return STATUS_WORKFLOW.INDETERMINADO;
        }
        if (statusDasEtapas.includes(ETAPA_STATUS.REJEITADA)) return STATUS_WORKFLOW.REJEITADO;
        if (statusDasEtapas.includes(ETAPA_STATUS.PENDENTE)) return STATUS_WORKFLOW.AGUARDANDO;
        return STATUS_WORKFLOW.APROVADO;
    };
}

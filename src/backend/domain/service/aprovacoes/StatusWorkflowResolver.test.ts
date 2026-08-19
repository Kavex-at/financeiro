import 'reflect-metadata';
import { ETAPA_STATUS, STATUS_WORKFLOW } from '../../interface/aprovacoes/constants.js';
import StatusWorkflowResolver from './StatusWorkflowResolver.js';

describe('StatusWorkflowResolver', () => {
    const resolver = new StatusWorkflowResolver();

    it('sem etapas é SEM_WORKFLOW — informação, não ausência de dado', () => {
        // ~metade dos títulos da filial 2 está aqui; saber quais é parte do diagnóstico.
        expect(resolver.resolver([])).toBe(STATUS_WORKFLOW.SEM_WORKFLOW);
    });

    it('todas concluídas → APROVADO', () => {
        expect(resolver.resolver([ETAPA_STATUS.CONCLUIDA, ETAPA_STATUS.CONCLUIDA])).toBe(
            STATUS_WORKFLOW.APROVADO,
        );
    });

    it('alguma pendente → AGUARDANDO', () => {
        expect(resolver.resolver([ETAPA_STATUS.CONCLUIDA, ETAPA_STATUS.PENDENTE])).toBe(
            STATUS_WORKFLOW.AGUARDANDO,
        );
    });

    it('rejeição domina aprovações parciais', () => {
        expect(resolver.resolver([ETAPA_STATUS.CONCLUIDA, ETAPA_STATUS.REJEITADA])).toBe(
            STATUS_WORKFLOW.REJEITADO,
        );
    });

    describe('precedência do INDETERMINADO (invariante I4)', () => {
        it('vence APROVADO — não afirmamos aprovação com etapa ilegível', () => {
            expect(resolver.resolver([ETAPA_STATUS.CONCLUIDA, ETAPA_STATUS.INDETERMINADO])).toBe(
                STATUS_WORKFLOW.INDETERMINADO,
            );
        });

        it('vence AGUARDANDO', () => {
            expect(resolver.resolver([ETAPA_STATUS.PENDENTE, ETAPA_STATUS.INDETERMINADO])).toBe(
                STATUS_WORKFLOW.INDETERMINADO,
            );
        });

        it('vence REJEITADO', () => {
            expect(resolver.resolver([ETAPA_STATUS.REJEITADA, ETAPA_STATUS.INDETERMINADO])).toBe(
                STATUS_WORKFLOW.INDETERMINADO,
            );
        });
    });
});

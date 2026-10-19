/**
 * Etapas do ledger `sispag_ajuste_centavos_execucao` (I18h, ADR-0073). Os valores são os do CHECK
 * da migration 0087.
 */
export const ETAPA_AJUSTE = {
    PENDENTE: 'pendente',
    RENEGOCIACAO_CRIADA: 'renegociacao_criada',
    TITULO_INCLUIDO: 'titulo_incluido',
    COMPOSICAO_GRAVADA: 'composicao_gravada',
    AJUSTE_APLICADO: 'ajuste_aplicado',
    FINALIZADA: 'finalizada',
    LIBERADA: 'liberada',
    SEM_BLOQUEIO: 'sem_bloqueio',
    RECHAVEADA: 'rechaveada',
    CONCLUIDO: 'concluido',
    CONCLUIDO_SEM_DECISAO: 'concluido_sem_decisao',
    AGUARDANDO_APROVACAO_MANUAL: 'aguardando_aprovacao_manual',
    CANCELADO: 'cancelado',
    RECUSADO: 'recusado',
    INDETERMINADO: 'indeterminado',
    SIMULADO: 'simulado',
} as const;
export type EtapaAjuste = (typeof ETAPA_AJUSTE)[keyof typeof ETAPA_AJUSTE];

/** Contrato (Task 4): implementado na Task 5. */
export default class EtapaAjusteCentavos {
    public static podeTransicionar = (_de: EtapaAjuste, _para: EtapaAjuste): boolean => {
        throw new Error('não implementado');
    };

    public static transicionar = (_de: EtapaAjuste, _para: EtapaAjuste): EtapaAjuste => {
        throw new Error('não implementado');
    };

    public static ehTerminal = (_etapa: EtapaAjuste): boolean => {
        throw new Error('não implementado');
    };

    public static antesDoFinalizar = (_etapa: EtapaAjuste): boolean => {
        throw new Error('não implementado');
    };
}

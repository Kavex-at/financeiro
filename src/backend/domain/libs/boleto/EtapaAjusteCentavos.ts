/**
 * Etapas do ledger `sispag_ajuste_centavos_execucao` (I18h, ADR-0074). Os valores são os do CHECK
 * da migration 0088.
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

const E = ETAPA_AJUSTE;

/** Antes do `finalizar`: falha ⇒ cancelar a renegociação (compensação). */
const ANTES_DO_FINALIZAR: ReadonlySet<EtapaAjuste> = new Set<EtapaAjuste>([
    E.PENDENTE,
    E.RENEGOCIACAO_CRIADA,
    E.TITULO_INCLUIDO,
    E.COMPOSICAO_GRAVADA,
    E.AJUSTE_APLICADO,
]);

const TERMINAIS: ReadonlySet<EtapaAjuste> = new Set<EtapaAjuste>([
    E.CONCLUIDO,
    E.CONCLUIDO_SEM_DECISAO,
    E.AGUARDANDO_APROVACAO_MANUAL,
    E.CANCELADO,
    E.RECUSADO,
    E.INDETERMINADO,
    E.SIMULADO,
]);

/**
 * Grafo de transições. Antes do `finalizar` toda etapa pode ir a `cancelado` (compensação) ou
 * `indeterminado` (o cancelamento falhou). Depois, só para a frente (`indeterminado` = alerta).
 *
 * Aprovação manual (I18e): o título novo já existe e a decisão TEM de segui-lo, então
 * `finalizada → rechaveada` direto; depois do rechaveamento o ledger termina em
 * `aguardando_aprovacao_manual` (terminal, ação de outra pessoa no Conexos).
 */
const TRANSICOES: Readonly<Record<EtapaAjuste, ReadonlySet<EtapaAjuste>>> = {
    [E.PENDENTE]: new Set([
        E.RENEGOCIACAO_CRIADA,
        E.RECUSADO,
        E.SIMULADO,
        E.CANCELADO,
        E.INDETERMINADO,
    ]),
    [E.RENEGOCIACAO_CRIADA]: new Set([E.TITULO_INCLUIDO, E.CANCELADO, E.INDETERMINADO]),
    [E.TITULO_INCLUIDO]: new Set([E.COMPOSICAO_GRAVADA, E.CANCELADO, E.INDETERMINADO]),
    [E.COMPOSICAO_GRAVADA]: new Set([E.AJUSTE_APLICADO, E.CANCELADO, E.INDETERMINADO]),
    [E.AJUSTE_APLICADO]: new Set([E.FINALIZADA, E.CANCELADO, E.INDETERMINADO]),
    [E.FINALIZADA]: new Set([E.LIBERADA, E.SEM_BLOQUEIO, E.RECHAVEADA, E.INDETERMINADO]),
    [E.LIBERADA]: new Set([E.RECHAVEADA, E.INDETERMINADO]),
    [E.SEM_BLOQUEIO]: new Set([E.RECHAVEADA, E.INDETERMINADO]),
    [E.RECHAVEADA]: new Set([E.CONCLUIDO, E.CONCLUIDO_SEM_DECISAO, E.AGUARDANDO_APROVACAO_MANUAL]),
    [E.CONCLUIDO]: new Set(),
    [E.CONCLUIDO_SEM_DECISAO]: new Set(),
    [E.AGUARDANDO_APROVACAO_MANUAL]: new Set(),
    [E.CANCELADO]: new Set(),
    [E.RECUSADO]: new Set(),
    [E.INDETERMINADO]: new Set(),
    [E.SIMULADO]: new Set(),
};

/** Máquina de estados PURA do ledger do ajuste de centavos (I18h). */
export default class EtapaAjusteCentavos {
    public static podeTransicionar = (de: EtapaAjuste, para: EtapaAjuste): boolean =>
        TRANSICOES[de]?.has(para) === true;

    /** Devolve `para` ou lança — transição inválida é bug, nunca estado a gravar. */
    public static transicionar = (de: EtapaAjuste, para: EtapaAjuste): EtapaAjuste => {
        if (!EtapaAjusteCentavos.podeTransicionar(de, para)) {
            throw new Error(`transição inválida do ajuste de centavos: ${de} → ${para}`);
        }
        return para;
    };

    public static ehTerminal = (etapa: EtapaAjuste): boolean => TERMINAIS.has(etapa);

    public static antesDoFinalizar = (etapa: EtapaAjuste): boolean => ANTES_DO_FINALIZAR.has(etapa);
}

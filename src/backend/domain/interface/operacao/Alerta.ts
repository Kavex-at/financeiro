/**
 * `Alerta` — incidente operacional detectado pelo sistema, PERSISTIDO antes de ser notificado.
 * Ver `ontology/entities/alerta.md` e ADR-0042.
 */

export const ALERTA_TIPO = {
    JOB_FALHOU: 'job-falhou',
    JOB_PARCIAL: 'job-parcial',
    JOB_PARADO: 'job-parado',
    CONFIG_AUSENTE: 'config-ausente',
} as const;

export type AlertaTipo = (typeof ALERTA_TIPO)[keyof typeof ALERTA_TIPO];

export const ALERTA_SEVERIDADE = { AVISO: 'aviso', ERRO: 'erro' } as const;
export type AlertaSeveridade = (typeof ALERTA_SEVERIDADE)[keyof typeof ALERTA_SEVERIDADE];

/** Resultado de UM sink. Falha não propaga (I5), mas fica registrada. */
export interface SinkResultado {
    sink: string;
    ok: boolean;
    erro?: string;
}

/** Um alerta a ser emitido — o que o detector produz, antes da dedup. */
export interface AlertaNovo {
    tipo: AlertaTipo;
    alvo: string;
    severidade: AlertaSeveridade;
    /**
     * Início da janela de dedup. Mesmo `(tipo, alvo, janela)` → nenhum alerta novo.
     * Janela nova → alerta novo, porque um pipeline parado há dois dias merece ser dito de novo.
     */
    janelaInicio: Date;
    /** Contexto legível. **NUNCA** valor de secret (I3). */
    detalhe: Record<string, unknown>;
}

/** Um alerta já persistido. */
export interface Alerta extends AlertaNovo {
    id: number;
    dedupKey: string;
    sinkResultados: SinkResultado[];
    criadoEm: string;
    notificadoEm?: string;
    reconhecidoEm?: string;
    reconhecidoPor?: string;
}

/**
 * Chave de dedup. A janela é truncada ao minuto: detectores disparados com segundos de diferença
 * (cron atrasado sobrepondo o seguinte) descrevem o MESMO incidente e devem colidir de propósito.
 */
export const dedupKeyDe = (a: AlertaNovo): string => {
    const janela = new Date(a.janelaInicio);
    janela.setUTCSeconds(0, 0);
    return `${a.tipo}:${a.alvo}:${janela.toISOString()}`;
};

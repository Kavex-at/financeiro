/**
 * Prazo efetivo do título pelo boleto sugerido (I19t, ADR-0078). DERIVADO, nunca persistido
 * (I19n): calculado a cada leitura da carteira, como o desfecho de boleto (I15m).
 *
 * CONTRATO com o frontend (`src/frontend/lib/sispag.ts`). Datas civis `YYYY-MM-DD` (dia civil BRT,
 * ADR-0070) — a tela compara strings e nunca reconverte instante.
 */
export const ORIGEM_PRAZO = {
    /** O prazo é o vencimento do título (sem candidato acionável, ou a barra vence depois dele). */
    TITULO: 'TITULO',
    /** O prazo final do boleto sugerido vence ANTES do título e puxa o prazo. */
    BOLETO_SUGERIDO: 'BOLETO_SUGERIDO',
} as const;
export type OrigemPrazo = (typeof ORIGEM_PRAZO)[keyof typeof ORIGEM_PRAZO];

export interface PrazoBoleto {
    /** `min(vencimento do título, prazo final do candidato acionável)`. */
    prazoEfetivo: string;
    origem: OrigemPrazo;
    vencimentoTitulo: string;
    /** Vencimento da barra do candidato que puxou o prazo (só com `BOLETO_SUGERIDO`). */
    vencimentoBoleto?: string;
    /** Candidatos acionáveis quando há mais de um (ambíguos seguros: prevalece o mais cedo). */
    totalCandidatos?: number;
    /**
     * O prazo final do candidato acionável já passou (`< hoje`): o boleto está perdido, resolver no
     * portal do banco. NÃO é o motivo `VENCIDO` (I19e) e não entra em "vencem hoje".
     */
    perdido: boolean;
}

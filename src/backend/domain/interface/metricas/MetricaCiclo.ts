/**
 * `MetricaCiclo` — uma linha de `metricas.vw_metricas_ciclo` (ADR-0045).
 *
 * Os campos espelham o contrato da view, em snake_case e com os MESMOS nomes, porque o
 * `kavex-report-ciclo` lê a resposta da API pela forma: renomear aqui quebraria o report em silêncio.
 * `metrica` é chave de série e nunca muda de nome.
 *
 * Datas são texto `YYYY-MM-DDTHH:MM:SS` em horário de São Paulo, SEM fuso — a janela é sexta 18:00
 * local, e convertê-la para UTC faria a tela e o report mostrarem 21:00.
 */
export interface MetricaCiclo {
    frente: string;
    metrica: string;
    rotulo: string;
    valor: number;
    unidade: string;
    janela_inicio: string;
    janela_fim: string;
    /** `null` quando não existe medição do processo manual — nunca estimado. */
    baseline: number | null;
    baseline_desc: string;
    /**
     * Além do contrato da view: `true` na semana em curso, ainda não fechada. O número vale até
     * `apurado_ate` e muda até sexta 18:00. Quem mostra uma linha parcial mostra o horário junto.
     */
    parcial: boolean;
    /** Até quando a linha foi apurada: o fim da janela, ou o momento da leitura se parcial. */
    apurado_ate: string;
}

export interface MetricasCicloFiltro {
    /** Limite inferior de `janela_inicio`, `YYYY-MM-DDTHH:MM:SS` local. */
    inicio?: string;
    /** Limite superior de `janela_fim`, `YYYY-MM-DDTHH:MM:SS` local. */
    fim?: string;
    /**
     * Recua o piso da série de `metricas.serie_inicio()` (ciclo 6, 2026-09-11) para
     * `metricas.historico_inicio()` (2026-08-07) — ADR-0048.
     *
     * **Opt-in de propósito.** Sem isto a leitura é byte a byte a de antes da ADR-0048, que é o que
     * o `kavex-report-ciclo` continua recebendo. Quem recua é a tela.
     */
    historico?: boolean;
}

export interface MetricasCicloLeitura {
    /**
     * Piso da série EM VIGOR nesta leitura — `metricas.serie_inicio()`, ou
     * `metricas.historico_inicio()` quando `historico`. A tela escreve "série iniciada em".
     *
     * É o piso usado, não o da série oficial: devolver 2026-09-11 ao lado de semanas de agosto
     * marcaria as recuperadas sem dizer que as está marcando, o oposto da ADR-0048 D4.
     */
    serieInicio: string;
    metricas: MetricaCiclo[];
}

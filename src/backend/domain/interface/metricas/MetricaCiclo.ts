/**
 * `MetricaCiclo` — uma linha de `metricas.vw_metricas_ciclo` (ADR-0045).
 *
 * Os campos espelham o contrato da view, em snake_case e com os MESMOS nomes, porque o
 * `kavex-report-ciclo` lê a resposta da API pela forma: renomear aqui quebraria o report em silêncio.
 * `metrica` é chave de série e nunca muda de nome.
 *
 * Datas são texto `YYYY-MM-DDTHH:MM:SS` em horário de São Paulo, SEM fuso — a janela é sexta 20:00
 * local, e convertê-la para UTC faria a tela e o report mostrarem 23:00.
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
     * `apurado_ate` e muda até sexta 20:00. Quem mostra uma linha parcial mostra o horário junto.
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
}

export interface MetricasCicloLeitura {
    /** Início da série (`metricas.serie_inicio()`) — a tela escreve "série iniciada em". */
    serieInicio: string;
    metricas: MetricaCiclo[];
}

import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { MetricaCiclo, MetricasCicloFiltro } from '../../interface/metricas/MetricaCiclo.js';

/** `numeric` chega como texto do driver; `baseline` é NULL por contrato quando não há fonte. */
const linhaSchema = z.object({
    frente: z.string(),
    metrica: z.string(),
    rotulo: z.string(),
    valor: z.coerce.number(),
    unidade: z.string(),
    janela_inicio: z.string(),
    janela_fim: z.string(),
    baseline: z.coerce.number().nullable(),
    baseline_desc: z.string(),
    parcial: z.boolean(),
    apurado_ate: z.string(),
});

const serieSchema = z.object({ serie_inicio: z.string() });

/** Formato das datas na resposta: horário de São Paulo, sem fuso (ver `MetricaCiclo`). */
const FORMATO_DATA = `'YYYY-MM-DD"T"HH24:MI:SS'`;

/**
 * Os dois pisos da série (ADR-0048). NÃO são parâmetro de consulta: são duas chamadas de função
 * FIXAS, escolhidas por um booleano já validado no boundary. Nada vindo da requisição chega perto
 * desta string — a alternativa (receber a data e interpolá-la no SQL) seria injeção com outro nome.
 */
const PISO = {
    /** Série oficial do ciclo 6 — o que a view usa e o que o `kavex-report-ciclo` lê. */
    serie: 'metricas.serie_inicio()',
    /** Piso do histórico da tela, seis semanas atrás. */
    historico: 'metricas.historico_inicio()',
} as const;

/**
 * MetricasCicloRepository — leitura das métricas do ciclo (ADR-0045, ADR-0048).
 *
 * Lê a FUNÇÃO `metricas.metricas_ciclo`, não a view: a view só tem semanas fechadas, e a API precisa
 * também da semana em curso — o report é feito na sexta à tarde, antes do fechamento das 18:00. A
 * linha da semana em curso vem com `parcial = true` e o horário de corte em `apurado_ate`.
 *
 * O PISO da série é escolhido pela chamada (ADR-0048): sem `historico`, é `metricas.serie_inicio()`
 * e a leitura é byte a byte a de antes — é o que o report continua recebendo. Com `historico`, é
 * `metricas.historico_inicio()`, e a tela ganha as seis semanas. As duas datas são sexta 18:00 e
 * distam 35 dias, então a grade de janelas é a MESMA: nenhuma semana fechada muda de fronteira.
 *
 * Somente leitura, SQL parametrizado. **Não toca o ERP**: os valores são o que os ledgers gravaram no
 * momento do fato. A regra de cada métrica mora nas migrations 0058/0060, não aqui.
 */
@injectable()
export default class MetricasCicloRepository {
    public constructor(
        @inject(PostgreeDatabaseClient)
        private readonly databaseClient: PostgreeDatabaseClient,
    ) {}

    public listar = async (filtro: MetricasCicloFiltro): Promise<MetricaCiclo[]> => {
        const rows = await this.databaseClient.selectMany(
            `SELECT frente, metrica, rotulo, valor::text AS valor, unidade,
                    to_char(janela_inicio, ${FORMATO_DATA}) AS janela_inicio,
                    to_char(janela_fim, ${FORMATO_DATA}) AS janela_fim,
                    baseline::text AS baseline, baseline_desc,
                    parcial,
                    to_char(apurado_ate, ${FORMATO_DATA}) AS apurado_ate
               FROM metricas.metricas_ciclo(
                        ${this.piso(filtro.historico)},
                        (now() AT TIME ZONE 'America/Sao_Paulo')
                    )
              WHERE ($inicio::timestamp IS NULL OR janela_inicio >= $inicio::timestamp)
                AND ($fim::timestamp IS NULL OR janela_fim <= $fim::timestamp)
              ORDER BY janela_inicio DESC, frente, metrica`,
            { inicio: filtro.inicio ?? null, fim: filtro.fim ?? null },
        );
        return rows.map((r) => linhaSchema.parse(r));
    };

    /**
     * O piso EM VIGOR nesta leitura, não o da série oficial. A tela escreve "série iniciada em" com
     * ele, e um rodapé dizendo 11/09 sobre uma tabela que começa em 07/08 marcaria as semanas
     * recuperadas sem dizer que as está marcando (ADR-0048, D4).
     */
    public serieInicio = async (historico?: boolean): Promise<string> => {
        const row = await this.databaseClient.selectFirst(
            `SELECT to_char(${this.piso(historico)}, ${FORMATO_DATA}) AS serie_inicio`,
        );
        return serieSchema.parse(row).serie_inicio;
    };

    private piso = (historico?: boolean): string => (historico ? PISO.historico : PISO.serie);
}

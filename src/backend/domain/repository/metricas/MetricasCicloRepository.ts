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
 * MetricasCicloRepository — leitura das métricas do ciclo (ADR-0045).
 *
 * Lê a FUNÇÃO `metricas.metricas_ciclo`, não a view: a view só tem semanas fechadas, e a API precisa
 * também da semana em curso — o report é feito na sexta à tarde, antes do fechamento das 20:00. A
 * linha da semana em curso vem com `parcial = true` e o horário de corte em `apurado_ate`.
 *
 * Somente leitura, SQL parametrizado. **Não toca o ERP**: os valores são o que os ledgers gravaram no
 * momento do fato. A regra de cada métrica mora na migration 0058, não aqui.
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
                        metricas.serie_inicio(),
                        (now() AT TIME ZONE 'America/Sao_Paulo')
                    )
              WHERE ($inicio::timestamp IS NULL OR janela_inicio >= $inicio::timestamp)
                AND ($fim::timestamp IS NULL OR janela_fim <= $fim::timestamp)
              ORDER BY janela_inicio DESC, frente, metrica`,
            { inicio: filtro.inicio ?? null, fim: filtro.fim ?? null },
        );
        return rows.map((r) => linhaSchema.parse(r));
    };

    public serieInicio = async (): Promise<string> => {
        const row = await this.databaseClient.selectFirst(
            `SELECT to_char(metricas.serie_inicio(), ${FORMATO_DATA}) AS serie_inicio`,
        );
        return serieSchema.parse(row).serie_inicio;
    };
}

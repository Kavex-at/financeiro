import 'dotenv/config';
import 'reflect-metadata';

import { Client } from 'pg';

/** Verificação dos três achados que contradizem o relatório v1. Read-only. */

const CONSULTAS: ReadonlyArray<{ readonly nome: string; readonly sql: string }> = [
    {
        nome: 'bloqueadas_tendencia_por_motivo',
        sql: `
            WITH runs AS (
                SELECT id, finished_at,
                       ROW_NUMBER() OVER (ORDER BY finished_at) AS n,
                       COUNT(*) OVER ()                          AS total
                  FROM permuta_eleicao_run
                 WHERE status = 'success' AND finished_at IS NOT NULL
            )
            SELECT DATE(r.finished_at) AS dia,
                   s.motivo_bloqueio,
                   COUNT(*) AS qtd
              FROM runs r
              JOIN permuta_candidata_snapshot s ON s.run_id = r.id
             WHERE s.status = 'bloqueada'
               AND (r.n = 1 OR r.n = r.total)
             GROUP BY DATE(r.finished_at), s.motivo_bloqueio
             ORDER BY dia, COUNT(*) DESC
        `,
    },
    {
        nome: 'contas_falhas_por_dia',
        sql: `
            SELECT DATE(started_at)          AS dia,
                   COUNT(*)                  AS runs,
                   SUM(total_contas_falhas)  AS contas_falhas,
                   SUM(total_lidas)          AS lidas
              FROM recebimento_ingestao_run
             GROUP BY DATE(started_at)
             HAVING SUM(total_contas_falhas) > 0
             ORDER BY dia
        `,
    },
    {
        nome: 'ingestao_ultimos_dias',
        sql: `
            SELECT DATE(started_at) AS dia, COUNT(*) AS runs, SUM(total_inseridas) AS inseridas
              FROM recebimento_ingestao_run
             GROUP BY DATE(started_at)
             ORDER BY dia DESC
             LIMIT 10
        `,
    },
    {
        nome: 'transacoes_por_dia_importacao',
        sql: `
            SELECT DATE(importado_em) AS dia, COUNT(*) AS qtd
              FROM transacao_bancaria
             GROUP BY DATE(importado_em)
             ORDER BY dia
        `,
    },
    {
        nome: 'execucoes_com_data_e_valor',
        sql: `
            SELECT id, status, etapa, fil_cod, pri_cod,
                   DATE(criado_em) AS dia,
                   executado_por,
                   LEFT(COALESCE(erro_mensagem, ''), 70) AS erro
              FROM solicitacao_numerario_execucao
             WHERE dry_run = FALSE
             ORDER BY criado_em
        `,
    },
];

const main = async (): Promise<void> => {
    const connectionString = process.env.databaseConnectionString;

    if (connectionString === undefined || connectionString === '') {
        throw new Error('databaseConnectionString is required');
    }

    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();

    try {
        await client.query('BEGIN TRANSACTION READ ONLY');

        for (const consulta of CONSULTAS) {
            await client.query('SAVEPOINT c');

            try {
                const { rows } = await client.query(consulta.sql);
                await client.query('RELEASE SAVEPOINT c');
                console.log(`\n### ${consulta.nome} (${rows.length})`);
                console.table(rows);
            } catch (error) {
                await client.query('ROLLBACK TO SAVEPOINT c');
                console.log(
                    `\n### ${consulta.nome} — FALHOU: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }

        await client.query('ROLLBACK');
    } finally {
        await client.end();
    }
};

void main();

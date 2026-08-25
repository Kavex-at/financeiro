import 'dotenv/config';
import 'reflect-metadata';

import { Client } from 'pg';

/**
 * Probe read-only para a 2ª versão do relatório de impacto: motivos de bloqueio
 * das permutas (com valor e idade), denominador do dedup de recebimentos e
 * cobertura de automação por modalidade.
 *
 * Descartável, como os demais `probe-impacto-*`. Não usa `bootstrapAppContainer`
 * de propósito: nada de migrations na Supabase compartilhada.
 */

interface Consulta {
    readonly nome: string;
    readonly sql: string;
}

const CONSULTAS: readonly Consulta[] = [
    {
        nome: 'permutas_bloqueadas_por_motivo',
        sql: `
            SELECT motivo_bloqueio,
                   moeda,
                   COUNT(*)                                                    AS qtd,
                   SUM(valor)                                                  AS valor_total,
                   ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY aging_days)::numeric, 0) AS aging_mediana,
                   MAX(aging_days)                                             AS aging_max
              FROM permuta_adiantamento
             WHERE NOT stale
               AND estado_elegibilidade = 'bloqueada'
             GROUP BY motivo_bloqueio, moeda
             ORDER BY COUNT(*) DESC
        `,
    },
    {
        nome: 'permutas_estado_atual',
        sql: `
            SELECT estado_elegibilidade,
                   moeda,
                   COUNT(*)   AS qtd,
                   SUM(valor) AS valor_total
              FROM permuta_adiantamento
             WHERE NOT stale
             GROUP BY estado_elegibilidade, moeda
             ORDER BY estado_elegibilidade, COUNT(*) DESC
        `,
    },
    {
        nome: 'permutas_alocacoes_por_status',
        sql: `
            SELECT status, COUNT(*) AS qtd
              FROM permuta_alocacao_execucao
             GROUP BY status
             ORDER BY COUNT(*) DESC
        `,
    },
    {
        nome: 'recebimentos_ingestao_totais',
        sql: `
            SELECT COUNT(*)                  AS runs,
                   SUM(total_lidas)          AS lidas,
                   SUM(total_inseridas)      AS inseridas,
                   SUM(total_deduplicadas)   AS deduplicadas,
                   SUM(total_contas_falhas)  AS contas_falhas
              FROM recebimento_ingestao_run
        `,
    },
    {
        nome: 'transacoes_unicas',
        sql: `
            SELECT COUNT(*)                        AS transacoes,
                   COUNT(DISTINCT natural_key)     AS natural_keys_distintas
              FROM transacao_bancaria
        `,
    },
    {
        nome: 'recebimentos_execucoes_detalhe',
        sql: `
            SELECT status, etapa, COUNT(*) AS qtd
              FROM solicitacao_numerario_execucao
             WHERE COALESCE(dry_run, FALSE) = FALSE
             GROUP BY status, etapa
             ORDER BY status, COUNT(*) DESC
        `,
    },
];

const main = async (): Promise<void> => {
    const connectionString = process.env.databaseConnectionString;

    if (connectionString === undefined || connectionString === '') {
        throw new Error('databaseConnectionString is required');
    }

    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    const saida: Record<string, unknown> = {};

    try {
        await client.query('BEGIN TRANSACTION READ ONLY');

        for (const consulta of CONSULTAS) {
            await client.query('SAVEPOINT consulta');

            try {
                const { rows } = await client.query(consulta.sql);
                await client.query('RELEASE SAVEPOINT consulta');
                saida[consulta.nome] = rows;
                console.log(`\n### ${consulta.nome} (${rows.length})`);
                console.table(rows);
            } catch (error) {
                await client.query('ROLLBACK TO SAVEPOINT consulta');
                const mensagem = error instanceof Error ? error.message : String(error);
                saida[consulta.nome] = { erro: mensagem };
                console.log(`\n### ${consulta.nome} — FALHOU: ${mensagem}`);
            }
        }

        await client.query('ROLLBACK');
    } finally {
        await client.end();
    }

    console.log(`\n--- JSON ---\n${JSON.stringify(saida, null, 2)}`);
};

void main();

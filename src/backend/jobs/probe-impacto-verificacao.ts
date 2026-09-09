import 'dotenv/config';
import 'reflect-metadata';

import { Client } from 'pg';

/**
 * Verificação dos três achados que contradizem o relatório v1. READ-ONLY.
 *
 * ATENÇÃO À SÉRIE HISTÓRICA (migration 0054 / ADR-0043): `status` do snapshot
 * deixou de ser binário. Antes da 0054, `status='bloqueada'` continha TRÊS
 * estados achatados (`casamento-manual`, `permuta-manual` e `ja-permutado`) além
 * do passivo externo real. Depois da 0054, `bloqueada` significa SÓ passivo
 * dependente de terceiro ou de leitura — a série cai de 64.893 para 51.459 no
 * agregado por RECLASSIFICAÇÃO, não por melhora operacional. Por isso a consulta
 * abaixo quebra por ESTADO em vez de somar tudo num balde só.
 */

/** Ressalva impressa junto do resultado — ver `docs/impacto/CORRECOES-2026-08-24.md` §1. */
const AVISO_SERIE = [
    '',
    'RESSALVA OBRIGATÓRIA (ADR-0043 / migration 0054): a série de "bloqueadas" MUDOU DE',
    'SIGNIFICADO. Até a 0054 o snapshot achatava casamento-manual, permuta-manual e',
    'ja-permutado dentro de "bloqueada"; depois dela, "bloqueada" é só passivo de',
    'terceiro/leitura. Comparar antes × depois sem dizer isto repete — com o sinal',
    'invertido — o erro do relatório de impacto v1.',
    '',
].join('\n');

const CONSULTAS: ReadonlyArray<{ readonly nome: string; readonly sql: string }> = [
    {
        // Quebra por ESTADO e motivo. `bloqueada` aqui é o sentido NOVO (estrito);
        // os estados que saíram do balde aparecem em linhas próprias, para que a
        // queda no total não seja lida como melhora operacional.
        nome: 'candidatas_tendencia_por_estado_e_motivo',
        sql: `
            WITH runs AS (
                SELECT id, finished_at,
                       ROW_NUMBER() OVER (ORDER BY finished_at) AS n,
                       COUNT(*) OVER ()                          AS total
                  FROM permuta_eleicao_run
                 WHERE status = 'success' AND finished_at IS NOT NULL
            )
            SELECT DATE(r.finished_at) AS dia,
                   s.status,
                   s.motivo_bloqueio,
                   COUNT(*) AS qtd
              FROM runs r
              JOIN permuta_candidata_snapshot s ON s.run_id = r.id
             WHERE s.status <> 'elegivel'
               AND (r.n = 1 OR r.n = r.total)
             GROUP BY DATE(r.finished_at), s.status, s.motivo_bloqueio
             ORDER BY dia, s.status, COUNT(*) DESC
        `,
    },
    {
        // O header da run, com os 5 buckets — confere a convergência I5 de olho.
        nome: 'header_runs_por_bucket',
        sql: `
            SELECT DATE(finished_at) AS dia,
                   SUM(total_candidatas)       AS candidatas,
                   SUM(total_elegiveis)        AS elegiveis,
                   SUM(total_bloqueadas)       AS bloqueadas_estrito,
                   SUM(total_casamento_manual) AS casamento_manual,
                   SUM(total_permuta_manual)   AS permuta_manual,
                   SUM(total_ja_permutado)     AS ja_permutado
              FROM permuta_eleicao_run
             WHERE kind = 'eleicao'
             GROUP BY DATE(finished_at)
             ORDER BY dia DESC
             LIMIT 10
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

    console.log(AVISO_SERIE);
};

void main();

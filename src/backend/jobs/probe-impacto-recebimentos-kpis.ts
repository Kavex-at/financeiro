import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

/**
 * H0 — Indicadores de impacto da Frente IV (Recebimentos / "Gestão de Adiantamentos").
 *
 * READ-ONLY por construção: tudo roda dentro de `BEGIN TRANSACTION READ ONLY`, então
 * o próprio Postgres rejeita qualquer escrita. NÃO usa `bootstrapAppContainer()` de
 * propósito — aquele caminho roda migrations e aquece o client do Conexos (que neste
 * .env aponta para PRD com WRITE_ENABLED=true). Aqui só tocamos o nosso Postgres.
 *
 * Descartável. Saída: docs/impacto/dados/h0-recebimentos-kpis.json
 */

dotenv.config({ path: resolve(process.cwd(), '.env') });

type Consulta = { nome: string; descricao: string; sql: string };

// Piso de ingestão (ADR): crédito anterior pertence ao processo manual antigo.
const PISO_GO_LIVE = '2026-08-03';

// Mesma definição do painel (domain/interface/recebimentos/constants.ts):
// 206 RESGATE DE APLICAÇÃO | 210 AÇÕES | 213 TRANSFERÊNCIA ENTRE CONTAS | 207 EMPRÉSTIMO.
const CATEGORIAS_TESOURARIA = ['206', '210', '213', '207'];

const CONSULTAS: Consulta[] = [
    {
        nome: 'janela_de_dados',
        descricao: 'Cobertura real da base — define o que é honesto afirmar',
        sql: `SELECT COUNT(*)::int AS total_transacoes,
                     MIN(data_movimento)::date AS primeiro_movimento,
                     MAX(data_movimento)::date AS ultimo_movimento,
                     MAX(importado_em)::date  AS ultima_ingestao,
                     COUNT(*) FILTER (WHERE arquivada_em IS NOT NULL)::int AS arquivadas,
                     COUNT(*) FILTER (WHERE tipo = 'CREDITO')::int AS creditos,
                     COUNT(*) FILTER (WHERE transferencia_interna)::int AS transf_internas,
                     COUNT(*) FILTER (WHERE fil_cod IS NULL)::int AS conta_corporativa
              FROM transacao_bancaria`,
    },
    {
        nome: 'categoria_distribuicao',
        descricao: 'Ruído de tesouraria vs. crédito de cliente — o denominador honesto',
        sql: `SELECT COALESCE(categoria, '(null)') AS categoria,
                     COALESCE(categoria_desc, '(sem descricao)') AS descricao,
                     CASE WHEN categoria = ANY($1::text[]) THEN 'tesouraria (oculta)'
                          WHEN transferencia_interna THEN 'transferencia interna (oculta)'
                          ELSE 'carteira de cliente' END AS classificacao,
                     COUNT(*)::int AS qtd,
                     ROUND(SUM(valor)::numeric, 2) AS valor_total
              FROM transacao_bancaria
              WHERE arquivada_em IS NULL AND tipo = 'CREDITO'
              GROUP BY 1, 2, 3 ORDER BY qtd DESC`,
    },
    {
        nome: 'carteira_cliente_por_status',
        descricao:
            'O número real: status dos créditos DE CLIENTE (exclui tesouraria, regra do painel)',
        sql: `SELECT status, COUNT(*)::int AS qtd,
                     ROUND(SUM(valor)::numeric, 2) AS valor_total
              FROM transacao_bancaria
              WHERE arquivada_em IS NULL
                AND tipo = 'CREDITO'
                AND transferencia_interna = FALSE
                AND (categoria IS NULL OR NOT (categoria = ANY($1::text[])))
              GROUP BY status ORDER BY qtd DESC`,
    },
    {
        nome: 'maiores_creditos_cliente_nao_aplicados',
        descricao:
            'Dinheiro de cliente parado — é aqui que o R$ 6,69M deveria aparecer, se existir',
        sql: `SELECT fil_cod, data_movimento::date AS data_movimento,
                     ROUND(valor::numeric, 2) AS valor, status,
                     COALESCE(categoria, '(null)') AS categoria,
                     LEFT(COALESCE(contraparte, ''), 50) AS contraparte,
                     (CURRENT_DATE - data_movimento::date) AS dias_parado
              FROM transacao_bancaria
              WHERE arquivada_em IS NULL
                AND tipo = 'CREDITO'
                AND transferencia_interna = FALSE
                AND (categoria IS NULL OR NOT (categoria = ANY($1::text[])))
                AND status IN ('importada', 'parcial', 'erro')
              ORDER BY valor DESC LIMIT 20`,
    },
    {
        nome: 'aging_credito_cliente',
        descricao:
            'Há quantos dias o crédito de cliente está sem aplicação (proxy do custo de carrego)',
        sql: `SELECT CASE WHEN CURRENT_DATE - data_movimento::date <= 2  THEN '0-2 dias'
                          WHEN CURRENT_DATE - data_movimento::date <= 7  THEN '3-7 dias'
                          WHEN CURRENT_DATE - data_movimento::date <= 14 THEN '8-14 dias'
                          ELSE '15+ dias' END AS faixa,
                     COUNT(*)::int AS qtd,
                     ROUND(SUM(valor)::numeric, 2) AS valor_total
              FROM transacao_bancaria
              WHERE arquivada_em IS NULL
                AND tipo = 'CREDITO'
                AND transferencia_interna = FALSE
                AND (categoria IS NULL OR NOT (categoria = ANY($1::text[])))
                AND status IN ('importada', 'parcial', 'erro')
              GROUP BY 1 ORDER BY 1`,
    },
    {
        nome: 'spine_recebimento_populada',
        descricao: 'A tabela `recebimento` (classificacao_match) está sendo usada em produção?',
        sql: `SELECT (SELECT COUNT(*) FROM recebimento)::int AS linhas_recebimento,
                     (SELECT COUNT(*) FROM recebimento_regra_aplicada)::int AS linhas_regra_aplicada,
                     (SELECT COUNT(*) FROM regra_recebimento)::int AS regras_cadastradas`,
    },
    {
        nome: 'execucao_por_status',
        descricao: 'Ledger real da SN (com299) — o caminho de produção, excluindo dry-run',
        sql: `SELECT status, COUNT(*)::int AS qtd,
                     ROUND(SUM(valor)::numeric, 2) AS valor_total
              FROM solicitacao_numerario_execucao
              WHERE dry_run = false
              GROUP BY status ORDER BY qtd DESC`,
    },
    {
        nome: 'onde_falha_etapa',
        descricao: 'Etapa das execuções com erro — onde o processo trava',
        sql: `SELECT COALESCE(etapa, '(sem etapa)') AS etapa, COUNT(*)::int AS qtd,
                     ROUND(SUM(valor)::numeric, 2) AS valor_total,
                     LEFT(COALESCE(MIN(erro_mensagem), ''), 120) AS exemplo_erro
              FROM solicitacao_numerario_execucao
              WHERE dry_run = false AND status = 'error'
              GROUP BY etapa ORDER BY qtd DESC`,
    },
    {
        nome: 'qualidade_fiscal',
        descricao: 'Revisão humana exigida, NDe autorizada pela SEFAZ, NDe dispensada',
        sql: `SELECT COUNT(*)::int AS execucoes_reais,
                     COUNT(*) FILTER (WHERE revisao_humana)::int AS com_revisao_humana,
                     COUNT(*) FILTER (WHERE nde_autorizado)::int AS nde_autorizada,
                     COUNT(*) FILTER (WHERE COALESCE(nde_dispensada, false))::int AS nde_dispensada,
                     COUNT(DISTINCT executado_por)::int AS operadores
              FROM solicitacao_numerario_execucao
              WHERE dry_run = false`,
    },
    {
        nome: 'lead_time_credito_ate_alocacao',
        descricao: 'Horas entre importar o crédito e o analista alocá-lo (ciclo de decisão)',
        sql: `SELECT COUNT(*)::int AS pares,
                     ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
                         ORDER BY EXTRACT(EPOCH FROM (e.criado_em - t.importado_em)) / 3600.0))::numeric, 1) AS horas_mediana,
                     ROUND((PERCENTILE_CONT(0.9) WITHIN GROUP (
                         ORDER BY EXTRACT(EPOCH FROM (e.criado_em - t.importado_em)) / 3600.0))::numeric, 1) AS horas_p90
              FROM solicitacao_numerario_execucao e
              JOIN transacao_bancaria t ON t.id = e.txn_id
              WHERE e.dry_run = false AND e.txn_id IS NOT NULL`,
    },
    {
        nome: 'ingestao_runs',
        descricao: 'Saúde da ingestão + dedup (o processo manual não tinha chave de deduplicação)',
        sql: `SELECT status, COUNT(*)::int AS runs,
                     SUM(total_lidas)::int AS lidas,
                     SUM(total_inseridas)::int AS inseridas,
                     SUM(total_deduplicadas)::int AS deduplicadas,
                     SUM(total_contas_falhas)::int AS contas_falhas
              FROM recebimento_ingestao_run
              GROUP BY status ORDER BY runs DESC`,
    },
    {
        nome: 'nde_emissao',
        descricao: 'NDe — artefato terminal, com carimbo externo da SEFAZ',
        sql: `SELECT status_emissao, COUNT(*)::int AS qtd,
                     ROUND(SUM(valor)::numeric, 2) AS valor_total
              FROM nota_debito_eletronica
              GROUP BY status_emissao ORDER BY qtd DESC`,
    },
    {
        nome: 'carteira_cliente_por_dia',
        descricao: 'Série diária da carteira de cliente (sem tesouraria) — cadência real',
        sql: `SELECT data_movimento::date AS dia,
                     COUNT(*)::int AS creditos,
                     ROUND(SUM(valor)::numeric, 2) AS valor,
                     COUNT(*) FILTER (WHERE status = 'processada')::int AS processados
              FROM transacao_bancaria
              WHERE arquivada_em IS NULL
                AND tipo = 'CREDITO'
                AND transferencia_interna = FALSE
                AND (categoria IS NULL OR NOT (categoria = ANY($1::text[])))
              GROUP BY 1 ORDER BY 1`,
    },
];

async function main(): Promise<void> {
    const connectionString = process.env.databaseConnectionString;
    if (!connectionString) throw new Error('databaseConnectionString ausente no .env');

    const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 15000 });
    const client = await pool.connect();
    const resultados: Record<string, unknown> = {};

    try {
        // Trava real: o Postgres recusa qualquer escrita nesta transação.
        await client.query('BEGIN TRANSACTION READ ONLY');

        for (const consulta of CONSULTAS) {
            // SAVEPOINT por consulta: uma falha isolada não aborta as demais.
            await client.query('SAVEPOINT consulta');
            try {
                const params = consulta.sql.includes('$1') ? [CATEGORIAS_TESOURARIA] : undefined;
                const { rows } = await client.query(consulta.sql, params);
                await client.query('RELEASE SAVEPOINT consulta');
                resultados[consulta.nome] = { descricao: consulta.descricao, linhas: rows };
                console.log(`\n=== ${consulta.nome} — ${consulta.descricao}`);
                console.table(rows);
            } catch (error) {
                await client.query('ROLLBACK TO SAVEPOINT consulta');
                const mensagem = error instanceof Error ? error.message : String(error);
                resultados[consulta.nome] = { descricao: consulta.descricao, erro: mensagem };
                console.warn(`\n=== ${consulta.nome} — FALHOU: ${mensagem}`);
            }
        }

        await client.query('COMMIT');
    } finally {
        client.release();
        await pool.end();
    }

    const destino = resolve(process.cwd(), '../../docs/impacto/dados');
    mkdirSync(destino, { recursive: true });
    const arquivo = resolve(destino, 'h0-recebimentos-kpis.json');
    writeFileSync(
        arquivo,
        `${JSON.stringify(
            { gerado_em: new Date().toISOString(), piso_go_live: PISO_GO_LIVE, resultados },
            null,
            2,
        )}\n`,
    );
    console.log(`\nJSON salvo em ${arquivo}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Pool, type PoolClient } from 'pg';
import type { AgregadosAtividade } from '../domain/interface/perfil/AtividadeUsuarioInterface.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import SqlBuilder from '../domain/libs/sql/SqlBuilder.js';
import AtividadeUsuarioRepository from '../domain/repository/perfil/AtividadeUsuarioRepository.js';

/**
 * GATE SUBSTITUTO DE GROUND TRUTH — perfil-usuario (ADR-0058). READ-ONLY por construção.
 *
 * Os KPIs pessoais somam valores JÁ GRAVADOS nos nossos ledgers (SEM_GROUND_TRUTH contra o ERP, como
 * o `metricas-ciclo`). O que se valida aqui é a EQUIVALÊNCIA com o que já está em produção:
 *
 *   1. Para cada semana FECHADA da série (`metricas.serie_inicio()` até a última sexta 18:00) e cada
 *      `executado_por` distinto, roda as consultas de agregados do `AtividadeUsuarioRepository` e
 *      confere, com TOLERÂNCIA ZERO (centavo), Σ usuários (+ o balde de ator NULL, que a métrica
 *      conta e nenhum usuário vê) = a linha de `metricas.metricas_ciclo()` da semana para: Permutas
 *      concluídas (do rótulo `%s de %s`) e `permutas_valor_baixado`; Recebimentos concluídas
 *      (rótulo) e `recebimentos_valor_alocado`; SISPAG `sispag_valor_aceito` (= Σ R$ agendado).
 *   2. Para os 3 usuários com mais execuções, compara TODOS os KPIs do repositório com consultas
 *      independentes escritas à parte (JOIN em vez de EXISTS, ROW_NUMBER em vez de LATERAL,
 *      contagem por status agrupada), por semana, tolerância zero.
 *
 * Saída: tabela por semana/frente com OK/DIVERGE; exit code ≠ 0 em divergência.
 * `--historico` recua o piso para `metricas.historico_inicio()` (07/08, mesma grade).
 * `--explain` imprime também o EXPLAIN (ANALYZE, BUFFERS) das duas consultas do perfil.
 *
 * ── SEGURANÇA ───────────────────────────────────────────────────────────────────────────
 * - Tudo dentro de `BEGIN TRANSACTION READ ONLY` e terminado em `ROLLBACK`: o próprio Postgres
 *   recusa qualquer escrita.
 * - `pg.Pool` direto. NÃO usa `bootstrapAppContainer()` nem nenhum client do Conexos: aquele caminho
 *   roda migrations e pode gravar a sessão de outro usuário no slot do robô (`columbia-default`).
 * - Lê do arquivo .env SÓ `databaseConnectionString`, e nunca o imprime.
 *
 * Run:
 *   cd src/backend
 *   PERFIL_ENV_FILE=/caminho/para/.env tsx jobs/validate-perfil-usuario-v1.ts [--explain]
 */

const TOL_CENTAVOS = 0;

const lerConexao = (): string => {
    const arquivo = process.env.PERFIL_ENV_FILE ?? resolve(process.cwd(), '.env');
    const valor = dotenv.parse(readFileSync(arquivo, 'utf8')).databaseConnectionString;
    if (!valor) throw new Error(`databaseConnectionString ausente em ${arquivo}`);
    return valor;
};

interface Semana {
    rotuloLocal: string;
    inicio: string;
    fim: string;
}

interface Linha {
    semana: string;
    frente: string;
    kpi: string;
    esperado: number;
    obtido: number;
    ok: boolean;
}

const centavos = (v: number): number => Math.round(v * 100);
const igual = (a: number, b: number): boolean =>
    Math.abs(centavos(a) - centavos(b)) <= TOL_CENTAVOS;

/** Adaptador mínimo `selectMany/selectFirst` sobre o client da transação read-only. */
class LeitorReadOnly {
    private readonly builder = new SqlBuilder();
    public planos: string[] = [];
    public explicar = false;

    public constructor(private readonly client: PoolClient) {}

    public selectMany = async (q: string, p: Record<string, unknown> = {}): Promise<unknown[]> => {
        const b = this.builder.build(q, p);
        if (this.explicar) {
            const plano = await this.client.query(
                `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${b.query}`,
                b.params,
            );
            this.planos.push(plano.rows.map((r) => r['QUERY PLAN']).join('\n'));
        }
        return (await this.client.query(b.query, b.params)).rows;
    };

    public selectFirst = async (q: string, p: Record<string, unknown> = {}): Promise<unknown> =>
        (await this.selectMany(q, p))[0] ?? null;
}

/** Consultas INDEPENDENTES do repositório (formulação diferente de propósito). */
class ConsultaIndependente {
    public constructor(private readonly client: PoolClient) {}

    public agregados = async (
        username: string,
        inicio: string,
        fim: string,
    ): Promise<AgregadosAtividade> => {
        const p = await this.client.query<{ status: string; fin: boolean; n: string; v: string }>(
            `SELECT x.status, (b.bor_cod IS NOT NULL) AS fin, COUNT(*)::text AS n,
                    COALESCE(SUM(x.valor_baixado), 0)::text AS v
               FROM permuta_alocacao_execucao x
               LEFT JOIN permuta_bordero b
                 ON b.fil_cod = x.fil_cod AND b.bor_cod = x.bor_cod
                AND b.bor_vld_finalizado = 1 AND b.bor_cod_estornado IS NULL
              WHERE x.executado_por = $1 AND NOT x.dry_run
                AND COALESCE(x.encerrado_em, x.criado_em) >= $2::timestamptz
                AND COALESCE(x.encerrado_em, x.criado_em) < $3::timestamptz
              GROUP BY 1, 2`,
            [username, inicio, fim],
        );
        const pg = (status: string[], fin?: boolean) =>
            p.rows.filter((r) => status.includes(r.status) && (fin === undefined || r.fin === fin));
        const n = (rows: { n: string }[]) => rows.reduce((s, r) => s + Number(r.n), 0);
        const v = (rows: { v: string }[]) => rows.reduce((s, r) => s + Number(r.v), 0);

        const s = await this.client.query<{
            lotes: string;
            valor: string;
            ag: string;
            pago: string;
        }>(
            `WITH primeira AS (
                 SELECT lote_id, executado_por, COALESCE(encerrado_em, criado_em) AS em,
                        ROW_NUMBER() OVER (PARTITION BY lote_id
                                           ORDER BY COALESCE(encerrado_em, criado_em), id) AS rn
                   FROM remessa_execucao
                  WHERE status = 'settled' AND NOT dry_run
             ), meus AS (
                 SELECT pr.lote_id
                   FROM primeira pr JOIN lote_pagamento l ON l.id = pr.lote_id
                  WHERE pr.rn = 1 AND l.status <> 'CANCELADO' AND pr.executado_por = $1
                    AND pr.em >= $2::timestamptz AND pr.em < $3::timestamptz
             )
             SELECT (SELECT COUNT(*) FROM meus)::text AS lotes,
                    COALESCE(SUM(i.valor), 0)::text AS valor,
                    COALESCE(SUM(CASE WHEN i.situacao IN ('AGENDADO', 'PAGO') THEN i.valor END), 0)::text AS ag,
                    COALESCE(SUM(CASE WHEN i.situacao = 'PAGO' THEN i.valor END), 0)::text AS pago
               FROM lote_pagamento_item i WHERE i.lote_id IN (SELECT lote_id FROM meus)`,
            [username, inicio, fim],
        );
        const contar = async (sql: string, extra: unknown[] = []): Promise<number> =>
            Number(
                (await this.client.query<{ n: string }>(sql, [username, inicio, fim, ...extra]))
                    .rows[0]?.n,
            );
        const lotesFinalizados = await contar(
            `SELECT COUNT(*)::text AS n FROM lote_pagamento WHERE finalizado_por = $1
               AND finalizado_em >= $2::timestamptz AND finalizado_em < $3::timestamptz
               AND status <> 'CANCELADO'`,
        );
        const concPorStatus = async (status: string) =>
            contar(
                `SELECT COUNT(*)::text AS n FROM conciliacao_execucao WHERE executado_por = $1
                   AND NOT dry_run AND status = $4
                   AND atualizado_em >= $2::timestamptz AND atualizado_em < $3::timestamptz`,
                [status],
            );
        const remErro = await contar(
            `SELECT COUNT(*)::text AS n FROM remessa_execucao WHERE executado_por = $1
               AND NOT dry_run AND status = 'error'
               AND COALESCE(encerrado_em, criado_em) >= $2::timestamptz
               AND COALESCE(encerrado_em, criado_em) < $3::timestamptz`,
        );
        const r = await this.client.query<{ status: string; n: string; v: string }>(
            `SELECT status, COUNT(*)::text AS n, COALESCE(SUM(valor), 0)::text AS v
               FROM solicitacao_numerario_execucao
              WHERE executado_por = $1 AND NOT dry_run
                AND COALESCE(encerrado_em, criado_em) >= $2::timestamptz
                AND COALESCE(encerrado_em, criado_em) < $3::timestamptz
              GROUP BY status`,
            [username, inicio, fim],
        );
        const rs = (status: string) => r.rows.find((x) => x.status === status);
        const sp = s.rows[0];
        return {
            permutas: {
                concluidas: n(pg(['settled'], true)),
                parciais: n(pg(['parcial'], true)),
                valorBaixado: v(pg(['settled', 'parcial'], true)),
                aguardandoBordero: n(pg(['settled', 'parcial'], false)),
                comErro: n(pg(['error'])),
            },
            sispag: {
                lotesFinalizados,
                remessasGeradas: Number(sp?.lotes ?? 0),
                valorRemessado: Number(sp?.valor ?? 0),
                valorAgendado: Number(sp?.ag ?? 0),
                valorPagoConfirmado: Number(sp?.pago ?? 0),
                retornosConciliados: await concPorStatus('settled'),
                comErro: remErro + (await concPorStatus('error')),
            },
            recebimentos: {
                concluidas: Number(rs('settled')?.n ?? 0),
                valor: Number(rs('settled')?.v ?? 0),
                comErro: Number(rs('error')?.n ?? 0),
            },
        };
    };

    /** O que a métrica conta e nenhum usuário vê: execuções com `executado_por` NULL. */
    public baldeSemAtor = async (inicio: string, fim: string) => {
        const { rows } = await this.client.query<{
            pc: string;
            pv: string;
            rc: string;
            rv: string;
            sa: string;
        }>(
            `SELECT
               (SELECT COUNT(*) FROM permuta_alocacao_execucao x
                  JOIN permuta_bordero b ON b.fil_cod = x.fil_cod AND b.bor_cod = x.bor_cod
                   AND b.bor_vld_finalizado = 1 AND b.bor_cod_estornado IS NULL
                 WHERE x.executado_por IS NULL AND NOT x.dry_run AND x.status = 'settled'
                   AND COALESCE(x.encerrado_em, x.criado_em) >= $1::timestamptz
                   AND COALESCE(x.encerrado_em, x.criado_em) < $2::timestamptz)::text AS pc,
               (SELECT COALESCE(SUM(x.valor_baixado), 0) FROM permuta_alocacao_execucao x
                  JOIN permuta_bordero b ON b.fil_cod = x.fil_cod AND b.bor_cod = x.bor_cod
                   AND b.bor_vld_finalizado = 1 AND b.bor_cod_estornado IS NULL
                 WHERE x.executado_por IS NULL AND NOT x.dry_run AND x.status IN ('settled', 'parcial')
                   AND COALESCE(x.encerrado_em, x.criado_em) >= $1::timestamptz
                   AND COALESCE(x.encerrado_em, x.criado_em) < $2::timestamptz)::text AS pv,
               (SELECT COUNT(*) FROM solicitacao_numerario_execucao s
                 WHERE s.executado_por IS NULL AND NOT s.dry_run AND s.status = 'settled'
                   AND COALESCE(s.encerrado_em, s.criado_em) >= $1::timestamptz
                   AND COALESCE(s.encerrado_em, s.criado_em) < $2::timestamptz)::text AS rc,
               (SELECT COALESCE(SUM(s.valor), 0) FROM solicitacao_numerario_execucao s
                 WHERE s.executado_por IS NULL AND NOT s.dry_run AND s.status = 'settled'
                   AND COALESCE(s.encerrado_em, s.criado_em) >= $1::timestamptz
                   AND COALESCE(s.encerrado_em, s.criado_em) < $2::timestamptz)::text AS rv,
               (SELECT COALESCE(SUM(i.valor) FILTER (WHERE i.situacao IN ('AGENDADO', 'PAGO')), 0)
                  FROM lote_pagamento_item i
                  JOIN lote_pagamento l ON l.id = i.lote_id AND l.status <> 'CANCELADO'
                  JOIN LATERAL (
                      SELECT r.executado_por, COALESCE(r.encerrado_em, r.criado_em) AS em
                        FROM remessa_execucao r
                       WHERE r.lote_id = i.lote_id AND NOT r.dry_run AND r.status = 'settled'
                       ORDER BY COALESCE(r.encerrado_em, r.criado_em), r.id LIMIT 1
                  ) p ON true
                 WHERE p.executado_por IS NULL AND p.em >= $1::timestamptz AND p.em < $2::timestamptz)::text AS sa`,
            [inicio, fim],
        );
        const b = rows[0];
        return {
            pc: Number(b?.pc ?? 0),
            pv: Number(b?.pv ?? 0),
            rc: Number(b?.rc ?? 0),
            rv: Number(b?.rv ?? 0),
            sa: Number(b?.sa ?? 0),
        };
    };
}

const somar = (lista: AgregadosAtividade[]) =>
    lista.reduce(
        (acc, a) => ({
            pc: acc.pc + a.permutas.concluidas,
            pv: acc.pv + a.permutas.valorBaixado,
            rc: acc.rc + a.recebimentos.concluidas,
            rv: acc.rv + a.recebimentos.valor,
            sa: acc.sa + a.sispag.valorAgendado,
        }),
        { pc: 0, pv: 0, rc: 0, rv: 0, sa: 0 },
    );

const achatar = (a: AgregadosAtividade): Array<[string, string, number]> => [
    ...Object.entries(a.permutas).map(([k, v]) => ['permutas', k, v] as [string, string, number]),
    ...Object.entries(a.sispag).map(([k, v]) => ['sispag', k, v] as [string, string, number]),
    ...Object.entries(a.recebimentos).map(
        ([k, v]) => ['recebimentos', k, v] as [string, string, number],
    ),
];

const main = async (): Promise<number> => {
    const explicar = process.argv.includes('--explain');
    // `--historico`: recua o piso para `metricas.historico_inicio()` (07/08), mesma grade de sextas.
    const historico = process.argv.includes('--historico');
    const pool = new Pool({ connectionString: lerConexao(), max: 1 });
    const client = await pool.connect();
    const linhas: Linha[] = [];
    try {
        await client.query('BEGIN TRANSACTION READ ONLY');
        const leitor = new LeitorReadOnly(client);
        const repo = new AtividadeUsuarioRepository(leitor as never);
        const indep = new ConsultaIndependente(client);

        const semanasRes = await client.query<
            Semana & { metrica: string; rotulo: string; valor: string }
        >(
            `SELECT to_char(janela_inicio, 'YYYY-MM-DD HH24:MI') AS "rotuloLocal",
                    to_char((janela_inicio AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS inicio,
                    to_char((janela_fim AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fim,
                    metrica, rotulo, valor::text AS valor
               FROM metricas.metricas_ciclo(
                        CASE WHEN $1::boolean THEN metricas.historico_inicio()
                             ELSE metricas.serie_inicio() END,
                        (now() AT TIME ZONE 'America/Sao_Paulo'))
              WHERE NOT parcial
              ORDER BY janela_inicio`,
            [historico],
        );
        const atores = (
            await client.query<{ ator: string; n: string }>(
                `SELECT ator, COUNT(*)::text AS n FROM (
                     SELECT executado_por AS ator FROM permuta_alocacao_execucao WHERE NOT dry_run
                     UNION ALL SELECT executado_por FROM solicitacao_numerario_execucao WHERE NOT dry_run
                     UNION ALL SELECT executado_por FROM remessa_execucao WHERE NOT dry_run
                     UNION ALL SELECT executado_por FROM conciliacao_execucao WHERE NOT dry_run
                 ) t WHERE ator IS NOT NULL GROUP BY ator ORDER BY COUNT(*) DESC, ator`,
            )
        ).rows;
        const semanas = new Map<
            string,
            { s: Semana; m: Map<string, { rotulo: string; valor: string }> }
        >();
        for (const r of semanasRes.rows) {
            const atual = semanas.get(r.inicio) ?? {
                s: { rotuloLocal: r.rotuloLocal, inicio: r.inicio, fim: r.fim },
                m: new Map(),
            };
            atual.m.set(r.metrica, { rotulo: r.rotulo, valor: r.valor });
            semanas.set(r.inicio, atual);
        }
        console.log(`semanas fechadas: ${semanas.size} | atores distintos: ${atores.length}`);

        const deRotulo = (rotulo?: string): number =>
            Number(/— (\d+) de \d+/.exec(rotulo ?? '')?.[1] ?? 0);

        for (const { s, m } of semanas.values()) {
            // Sequencial: uma sessão só, e o pg não aceita consultas sobrepostas no mesmo client.
            const porAtor: AgregadosAtividade[] = [];
            for (const a of atores) {
                porAtor.push(
                    await repo.agregados({ username: a.ator, inicio: s.inicio, fim: s.fim }),
                );
            }
            const soma = somar(porAtor);
            const nulo = await indep.baldeSemAtor(s.inicio, s.fim);
            const checks: Array<[string, string, number, number]> = [
                [
                    'permutas',
                    'concluidas',
                    deRotulo(m.get('permutas_baixas_concluidas_pct')?.rotulo),
                    soma.pc + nulo.pc,
                ],
                [
                    'permutas',
                    'valor_baixado',
                    Number(m.get('permutas_valor_baixado')?.valor ?? 0),
                    soma.pv + nulo.pv,
                ],
                [
                    'recebimentos',
                    'concluidas',
                    deRotulo(m.get('recebimentos_alocacoes_concluidas_pct')?.rotulo),
                    soma.rc + nulo.rc,
                ],
                [
                    'recebimentos',
                    'valor',
                    Number(m.get('recebimentos_valor_alocado')?.valor ?? 0),
                    soma.rv + nulo.rv,
                ],
                [
                    'sispag',
                    'valor_aceito',
                    Number(m.get('sispag_valor_aceito')?.valor ?? 0),
                    soma.sa + nulo.sa,
                ],
            ];
            for (const [frente, kpi, esperado, obtido] of checks) {
                linhas.push({
                    semana: s.rotuloLocal,
                    frente: `Σ ${frente}`,
                    kpi:
                        nulo.pc + nulo.rc + nulo.pv + nulo.rv + nulo.sa > 0
                            ? `${kpi} (+ator NULL)`
                            : kpi,
                    esperado,
                    obtido,
                    ok: igual(esperado, obtido),
                });
            }

            for (const ator of atores.slice(0, 3)) {
                const doRepo = porAtor[atores.indexOf(ator)];
                if (!doRepo) continue;
                const independente = await indep.agregados(ator.ator, s.inicio, s.fim);
                const esperados = achatar(independente);
                for (const [frente, kpi, obtido] of achatar(doRepo)) {
                    const esperado =
                        esperados.find((e) => e[0] === frente && e[1] === kpi)?.[2] ?? Number.NaN;
                    linhas.push({
                        semana: s.rotuloLocal,
                        frente: `usuario#${atores.indexOf(ator) + 1} ${frente}`,
                        kpi,
                        esperado,
                        obtido,
                        ok: igual(esperado, obtido),
                    });
                }
            }
        }

        if (explicar && atores[0]) {
            const ultima = [...semanas.values()].pop()?.s;
            // `--sem-seqscan`: só para provar que os índices da 0072 SERVEM ao plano num banco
            // pequeno (onde o planner prefere Seq Scan, e com razão). Vale só nesta transação.
            if (process.argv.includes('--sem-seqscan')) {
                await client.query('SET LOCAL enable_seqscan = off');
            }
            leitor.explicar = true;
            const fim = new Date().toISOString();
            const inicio = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
            await repo.historico({
                userId: 0,
                username: atores[0].ator,
                inicio,
                fim,
                limit: 26,
            });
            if (ultima) await repo.agregados({ username: atores[0].ator, ...ultima });
            leitor.explicar = false;
            console.log('\n=== EXPLAIN historico (30 dias, 1º ator) ===\n');
            console.log(leitor.planos[0] ?? '(sem plano)');
            console.log('\n=== EXPLAIN agregados (última semana fechada, 1º ator) ===\n');
            console.log(leitor.planos[1] ?? '(sem plano)');
        }
    } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
        await pool.end();
    }

    const divergentes = linhas.filter((l) => !l.ok);
    console.log(
        '\nsemana            | frente                     | kpi                       | esperado        | obtido          | ',
    );
    for (const l of linhas) {
        console.log(
            `${l.semana.padEnd(17)} | ${l.frente.padEnd(26)} | ${l.kpi.padEnd(25)} | ${String(l.esperado).padStart(15)} | ${String(l.obtido).padStart(15)} | ${l.ok ? 'OK' : 'DIVERGE'}`,
        );
    }
    console.log(
        `\n${linhas.length} comparações, ${divergentes.length} divergência(s), tolerância ${TOL_CENTAVOS} centavo(s).`,
    );
    return divergentes.length === 0 ? 0 : 1;
};

main()
    .then((codigo) => process.exit(codigo))
    .catch((erro: unknown) => {
        console.error(
            `validate-perfil-usuario-v1 falhou: ${redactErrorMessage((erro as Error).message)}`,
        );
        process.exit(2);
    });

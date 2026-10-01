import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import type { AgregadosAtividade } from '../domain/interface/perfil/AtividadeUsuarioInterface.js';
import SqlBuilder from '../domain/libs/sql/SqlBuilder.js';
import AtividadeUsuarioRepository from '../domain/repository/perfil/AtividadeUsuarioRepository.js';

/**
 * AtividadeUsuario (ADR-0058) contra um Postgres DE VERDADE.
 *
 * Aplica 0001..0072 num banco novo (e a 0072 uma segunda vez — idempotência), semeia as 9 fontes
 * para três usuários e prova, com o SQL real do `AtividadeUsuarioRepository`:
 * - as regras de KPI (borderô finalizado em Permutas; 1ª remessa por lote no SISPAG; CANCELADO
 *   fora; dry_run e em voo fora);
 * - Σ usuários = `metricas.metricas_ciclo()` na mesma semana (I7: números batem com /metricas);
 * - isolamento: o histórico de A tem exatamente as linhas em que A é ator (ou alvo, no evento de
 *   acesso), conferidas contra consultas independentes por tabela;
 * - o keyset devolve a mesma sequência do que uma página única, sem repetir nem pular.
 *
 * Não roda no `npm test`. Roda no CI (job `backend-sql`) e localmente com o mesmo DSN do
 * `vwMetricasCiclo.integration.test.ts`:
 *
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error('METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql precisa de banco');
}
const BANCO = 'atividade_usuario_it';

/** Semana sex 25/09 18:00 → sex 02/10 18:00 (SP), fechada no AGORA da métrica. */
const SEMANA = { inicio: '2026-09-25T21:00:00.000Z', fim: '2026-10-02T21:00:00.000Z' };
const SERIE = '2026-09-11 18:00:00';
const AGORA_LOCAL = '2026-10-03 10:00:00';

const L1 = '00000000-0000-4000-8000-000000000001';
const L2 = '00000000-0000-4000-8000-000000000002';
const L3 = '00000000-0000-4000-8000-000000000003';

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('AtividadeUsuario — integração', () => {
    let admin: Client;
    let repo: AtividadeUsuarioRepository;
    const ids: Record<string, number> = {};

    beforeAll(async () => {
        const dsn = ADMIN_DSN ?? '';
        const host = new URL(dsn).hostname;
        if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
            throw new Error(`METRICAS_CICLO_TEST_DSN precisa ser local; recebido host "${host}"`);
        }
        const raiz = new Client({ connectionString: dsn });
        await raiz.connect();
        await raiz.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
        await raiz.query(`CREATE DATABASE ${BANCO}`);
        await raiz.end();

        admin = new Client({ connectionString: dsnPara(dsn, BANCO) });
        await admin.connect();

        const migrations = readdirSync(__dirname)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort();
        expect(migrations).toContain('0072_idx_atividade_usuario.sql');
        for (const arquivo of migrations) {
            await admin.query(readFileSync(path.join(__dirname, arquivo), 'utf8'));
        }
        // Idempotência: a 0072 de novo, sem erro.
        await admin.query(
            readFileSync(path.join(__dirname, '0072_idx_atividade_usuario.sql'), 'utf8'),
        );

        const builder = new SqlBuilder();
        const db = {
            selectMany: async (q: string, p: Record<string, unknown> = {}) => {
                const b = builder.build(q, p);
                return (await admin.query(b.query, b.params)).rows;
            },
            selectFirst: async (q: string, p: Record<string, unknown> = {}) => {
                const b = builder.build(q, p);
                return (await admin.query(b.query, b.params)).rows[0] ?? null;
            },
        };
        repo = new AtividadeUsuarioRepository(db as never);

        const usuarios = await admin.query<{ id: number; username: string }>(`
            INSERT INTO app_user (username, password_hash, role_id)
            SELECT u, 'x', (SELECT id FROM app_role ORDER BY id LIMIT 1)
              FROM unnest(ARRAY['ana', 'bruno', 'carla']) AS u
            RETURNING id, username`);
        for (const u of usuarios.rows) ids[u.username] = u.id;

        await admin.query(`
            INSERT INTO permuta_bordero (bor_cod, fil_cod, bor_vld_finalizado, bor_cod_estornado) VALUES
                (100, 1, 1, NULL), (300, 1, 0, 901), (400, 1, 0, NULL)`);

        await admin.query(`
            INSERT INTO permuta_alocacao_execucao
                (idempotency_key, adiantamento_doc_cod, invoice_doc_cod, fil_cod, status, dry_run,
                 bor_cod, valor_baixado, executado_por, criado_em, encerrado_em)
            VALUES
                ('a-ok1',  'A1', 'I1', 1, 'settled', false, 100, 1000, 'ana',   '2026-09-28 10:00-03', NULL),
                ('a-ok2',  'A2', 'I2', 1, 'settled', false, 100,  500, 'ana',   '2026-09-20 10:00-03', '2026-09-29 10:00-03'),
                ('a-parc', 'A3', 'I3', 1, 'parcial', false, 100,  300, 'ana',   '2026-09-29 11:00-03', NULL),
                ('a-cad',  'A4', 'I4', 1, 'settled', false, 400,  250, 'ana',   '2026-09-29 12:00-03', NULL),
                ('a-est',  'A5', 'I5', 1, 'settled', false, 300,  400, 'ana',   '2026-09-29 13:00-03', NULL),
                ('a-err',  'A6', 'I6', 1, 'error',   false, NULL, NULL, 'ana',  '2026-09-30 10:00-03', NULL),
                ('a-pend', 'A7', 'I7', 1, 'pending', false, NULL, NULL, 'ana',  '2026-09-30 11:00-03', NULL),
                ('a-dry',  'A8', 'I8', 1, 'settled', true,  100, 9999, 'ana',   '2026-09-30 12:00-03', NULL),
                ('a-fora', 'A9', 'I9', 1, 'settled', false, 100,   77, 'ana',   '2026-10-02 18:00-03', NULL),
                ('b-ok',   'B1', 'J1', 1, 'settled', false, 100, 2000, 'bruno', '2026-09-28 10:00-03', NULL)`);

        await admin.query(`
            INSERT INTO solicitacao_numerario_execucao
                (idempotency_key, fil_cod, pri_cod, status, dry_run, valor, executado_por, criado_em)
            VALUES
                ('s-a',     2, 10, 'settled', false,  200, 'ana',   '2026-09-28 09:00-03'),
                ('s-a-err', 2, 11, 'error',   false,  100, 'ana',   '2026-09-28 10:00-03'),
                ('s-a-dry', 2, 12, 'settled', true,  5000, 'ana',   '2026-09-28 11:00-03'),
                ('s-b',     2, 13, 'settled', false,  300, 'bruno', '2026-09-28 12:00-03')`);

        await admin.query(`
            INSERT INTO lote_pagamento (id, fil_cod, status, criado_por, criado_em, finalizado_por, finalizado_em) VALUES
                ('${L1}', 1, 'REMESSA_GERADA', 'ana',   '2026-09-26 10:00-03', 'ana',   '2026-09-27 10:00-03'),
                ('${L2}', 1, 'CANCELADO',      'ana',   '2026-09-26 11:00-03', 'ana',   '2026-09-27 11:00-03'),
                ('${L3}', 1, 'FINALIZADO',     'bruno', '2026-09-26 12:00-03', 'bruno', '2026-09-28 12:00-03')`);
        await admin.query(`
            INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, valor, incluido_por, situacao) VALUES
                ('${L1}', 1, 'D1', 'T1', 100, 'ana', 'AGENDADO'),
                ('${L1}', 1, 'D2', 'T2',  50, 'ana', 'PAGO'),
                ('${L1}', 1, 'D3', 'T3',  25, 'ana', NULL),
                ('${L2}', 1, 'D4', 'T4', 999, 'ana', 'AGENDADO'),
                ('${L3}', 1, 'D5', 'T5',  70, 'bruno', 'AGENDADO')`);
        await admin.query(`
            INSERT INTO remessa_execucao
                (idempotency_key, lote_id, fil_cod, bnc_cod, status, dry_run, executado_por, criado_em, encerrado_em)
            VALUES
                ('r1-ana',    '${L1}', 1, 1, 'settled', false, 'ana',   '2026-09-28 10:00-03', '2026-09-28 10:00-03'),
                ('r1-bruno',  '${L1}', 1, 1, 'settled', false, 'bruno', '2026-09-29 10:00-03', '2026-09-29 10:00-03'),
                ('r2-ana',    '${L2}', 1, 1, 'settled', false, 'ana',   '2026-09-28 11:00-03', '2026-09-28 11:00-03'),
                ('r3-dry',    '${L3}', 1, 1, 'settled', true,  'ana',   '2026-09-29 09:00-03', '2026-09-29 09:00-03'),
                ('r3-err',    '${L3}', 1, 1, 'error',   false, 'ana',   '2026-09-30 10:00-03', '2026-09-30 10:00-03'),
                ('r3-bruno',  '${L3}', 1, 1, 'settled', false, 'bruno', '2026-09-30 11:00-03', '2026-09-30 11:00-03')`);

        await admin.query(`
            INSERT INTO conciliacao_execucao
                (idempotency_key, fil_cod, bnc_cod, gtb_cod_seq, gar_cod_seq, status, dry_run,
                 varredura_incompleta, executado_por, criado_em, atualizado_em)
            VALUES
                ('c-a',   1, 1, 1, 1, 'settled', false, true,  'ana',   '2026-09-30 09:00-03', '2026-09-30 09:05-03'),
                ('c-a-e', 1, 1, 1, 2, 'error',   false, false, 'ana',   '2026-09-30 10:00-03', '2026-09-30 10:05-03'),
                ('c-b',   1, 1, 1, 3, 'settled', false, false, 'bruno', '2026-09-30 11:00-03', '2026-09-30 11:05-03')`);

        await admin.query(`
            INSERT INTO permuta_excecao_manual
                (adiantamento_doc_cod, justificativa, criado_por, criado_em, removido_por, removido_em)
            VALUES
                ('X1', 'justificativa longa 1', 'ana',   '2026-09-28 10:00-03', 'bruno', '2026-09-29 10:00-03'),
                ('X2', 'justificativa longa 2', 'bruno', '2026-09-29 11:00-03', 'ana',   '2026-09-30 10:00-03')`);

        await admin.query(`
            INSERT INTO lote_pagamento_item_destino_audit
                (id, lote_id, fil_cod, doc_cod, tit_cod, alterado_por, alterado_em, evento, aprova_audit_id)
            VALUES
                ('00000000-0000-4000-8000-0000000000a1', '${L1}', 1, 'D1', 'T1', 'ana',   '2026-09-28 10:00-03', 'GRAVACAO', NULL),
                ('00000000-0000-4000-8000-0000000000a2', '${L1}', 1, 'D1', 'T1', 'bruno', '2026-09-28 11:00-03', 'APROVACAO', '00000000-0000-4000-8000-0000000000a1')`);

        await admin.query(`
            INSERT INTO alerta (tipo, alvo, dedup_key, janela_inicio, reconhecido_por, reconhecido_em) VALUES
                ('job-falhou', 'ingest-permutas', 'k1', '2026-09-30 00:00-03', 'ana',   '2026-09-30 10:00-03'),
                ('job-falhou', 'ingest-extratos', 'k2', '2026-09-30 00:00-03', 'bruno', '2026-09-30 11:00-03')`);

        await admin.query(
            `INSERT INTO app_user_access_event (ator, alvo_user_id, tipo, antes, depois, em) VALUES
                ('bruno', $1, 'papel',   NULL, NULL, '2026-09-28 10:00-03'),
                ('ana',   $2, 'excecao', NULL, NULL, '2026-09-29 10:00-03'),
                ('bruno', $3, 'ativo',   NULL, NULL, '2026-09-29 11:00-03'),
                ('ana',   $1, 'papel',   NULL, NULL, '2026-09-30 10:00-03')`,
            [ids.ana, ids.bruno, ids.carla],
        );
    });

    afterAll(async () => {
        await admin?.end();
    });

    const agregados = (username: string): Promise<AgregadosAtividade> =>
        repo.agregados({ username, ...SEMANA });

    it('a 0072 criou os 11 índices e reaplicá-la não falhou', async () => {
        const { rows } = await admin.query<{ indexname: string }>(
            `SELECT indexname FROM pg_indexes WHERE indexname = ANY($1::text[])`,
            [
                [
                    'idx_permuta_alocacao_execucao_ator_em',
                    'idx_solicitacao_numerario_execucao_ator_em',
                    'idx_remessa_execucao_ator_em',
                    'idx_conciliacao_execucao_ator_em',
                    'idx_lote_pagamento_criado_por_em',
                    'idx_lote_pagamento_finalizado_por_em',
                    'idx_permuta_excecao_manual_criado_por_em',
                    'idx_permuta_excecao_manual_removido_por_em',
                    'idx_destino_audit_alterado_por_em',
                    'idx_alerta_reconhecido_por_em',
                    'idx_app_user_access_event_ator_em',
                ],
            ],
        );
        expect(rows).toHaveLength(11);
    });

    it('Permutas: principal = settled finalizada; R$ = settled+parcial finalizadas; secundários', async () => {
        expect((await agregados('ana')).permutas).toEqual({
            concluidas: 2, // a-ok1 + a-ok2 (datada pelo encerramento)
            parciais: 1, // a-parc: no R$, não no principal
            valorBaixado: 1800,
            aguardandoBordero: 2, // a-cad (borderô em cadastro) + a-est (estornado)
            comErro: 1, // a-err; a-pend em voo e a-dry não contam; a-fora cai no fim exclusivo
        });
        expect((await agregados('bruno')).permutas).toMatchObject({
            concluidas: 1,
            valorBaixado: 2000,
        });
    });

    it('SISPAG: 1ª remessa settled não-dry por lote ENTRE todos; CANCELADO fora; vocabulário I4', async () => {
        expect((await agregados('ana')).sispag).toEqual({
            lotesFinalizados: 1, // L1; L2 é CANCELADO
            remessasGeradas: 1, // L1 (a 2ª settled do L1, do bruno, não conta para ninguém)
            valorRemessado: 175,
            valorAgendado: 150, // AGENDADO + PAGO
            valorPagoConfirmado: 50,
            retornosConciliados: 1,
            comErro: 2, // remessa r3-err + conciliação c-a-e
        });
        // L3: a remessa dry-run da ana não conta; a 1ª settled real é do bruno.
        expect((await agregados('bruno')).sispag).toMatchObject({
            lotesFinalizados: 1,
            remessasGeradas: 1,
            valorRemessado: 70,
            valorAgendado: 70,
            valorPagoConfirmado: 0,
        });
    });

    it('Recebimentos: settled não-dry, SUM(valor); error em "com erro"', async () => {
        expect((await agregados('ana')).recebimentos).toEqual({
            concluidas: 1,
            valor: 200,
            comErro: 1,
        });
    });

    it('Σ usuários = metricas.metricas_ciclo() na mesma semana (I7)', async () => {
        const { rows } = await admin.query<{ metrica: string; rotulo: string; valor: string }>(
            `SELECT metrica, rotulo, valor::text AS valor
               FROM metricas.metricas_ciclo($1::timestamp, $2::timestamp)
              WHERE janela_inicio = '2026-09-25 18:00:00'::timestamp`,
            [SERIE, AGORA_LOCAL],
        );
        const linha = (m: string) => rows.find((r) => r.metrica === m);
        const soma = { concluidas: 0, valorBaixado: 0, recConcl: 0, recValor: 0, aceito: 0 };
        for (const u of ['ana', 'bruno', 'carla']) {
            const a = await agregados(u);
            soma.concluidas += a.permutas.concluidas;
            soma.valorBaixado += a.permutas.valorBaixado;
            soma.recConcl += a.recebimentos.concluidas;
            soma.recValor += a.recebimentos.valor;
            soma.aceito += a.sispag.valorAgendado;
        }
        const concluidasMetrica = Number(
            /— (\d+) de \d+ tentativas/.exec(
                linha('permutas_baixas_concluidas_pct')?.rotulo ?? '',
            )?.[1],
        );
        expect(soma.concluidas).toBe(concluidasMetrica);
        expect(soma.valorBaixado).toBe(Number(linha('permutas_valor_baixado')?.valor));
        expect(soma.recConcl).toBe(
            Number(
                /— (\d+) de \d+ tentativas/.exec(
                    linha('recebimentos_alocacoes_concluidas_pct')?.rotulo ?? '',
                )?.[1],
            ),
        );
        expect(soma.recValor).toBe(Number(linha('recebimentos_valor_alocado')?.valor));
        expect(soma.aceito).toBe(Number(linha('sispag_valor_aceito')?.valor));
    });

    it('isolamento: o histórico de A tem exatamente as linhas em que A é ator (ou alvo do acesso)', async () => {
        const linhas = await repo.historico({
            userId: ids.ana,
            username: 'ana',
            ...SEMANA,
            limit: 1000,
        });
        const obtido = linhas.map((l) => `${l.fonte}:${l.fonteId}`).sort();

        // Consultas independentes, uma por tabela, escritas à parte do repositório.
        const q = async (sql: string, params: unknown[] = []) =>
            (await admin.query<{ k: string }>(sql, params)).rows.map((r) => r.k);
        const esperado = [
            ...(await q(
                `SELECT 'permuta_execucao:' || id AS k FROM permuta_alocacao_execucao
                  WHERE executado_por = 'ana' AND NOT dry_run
                    AND COALESCE(encerrado_em, criado_em) >= $1
                    AND COALESCE(encerrado_em, criado_em) < $2`,
                [SEMANA.inicio, SEMANA.fim],
            )),
            ...(await q(
                `SELECT 'excecao_criada:' || id AS k FROM permuta_excecao_manual WHERE criado_por = 'ana'`,
            )),
            ...(await q(
                `SELECT 'excecao_removida:' || id AS k FROM permuta_excecao_manual WHERE removido_por = 'ana'`,
            )),
            ...(await q(
                `SELECT 'lote_criado:' || id AS k FROM lote_pagamento WHERE criado_por = 'ana'`,
            )),
            ...(await q(
                `SELECT 'lote_finalizado:' || id AS k FROM lote_pagamento WHERE finalizado_por = 'ana'`,
            )),
            ...(await q(
                `SELECT 'destino_audit:' || id AS k FROM lote_pagamento_item_destino_audit WHERE alterado_por = 'ana'`,
            )),
            ...(await q(
                `SELECT 'remessa:' || id AS k FROM remessa_execucao WHERE executado_por = 'ana' AND NOT dry_run`,
            )),
            ...(await q(
                `SELECT 'conciliacao:' || id AS k FROM conciliacao_execucao WHERE executado_por = 'ana' AND NOT dry_run`,
            )),
            ...(await q(
                `SELECT 'sn_execucao:' || id AS k FROM solicitacao_numerario_execucao WHERE executado_por = 'ana' AND NOT dry_run`,
            )),
            ...(await q(
                `SELECT 'alerta_reconhecido:' || id AS k FROM alerta WHERE reconhecido_por = 'ana'`,
            )),
            ...(await q(
                `SELECT 'acesso_evento:' || id AS k FROM app_user_access_event WHERE ator = 'ana' OR alvo_user_id = $1`,
                [ids.ana],
            )),
        ].sort();

        expect(obtido).toEqual(esperado);
        expect(new Set(linhas.map((l) => l.fonte)).size).toBe(11);
        // A trilha de outro par (bruno → carla) nunca aparece; o autoajuste (ana → ana) aparece uma vez.
        const acessos = linhas.filter((l) => l.fonte === 'acesso_evento');
        expect(acessos.map((l) => [l.acao, l.detalhe.outroUsername]).sort()).toEqual(
            [
                ['acesso_alterado', 'ana'],
                ['acesso_alterado', 'bruno'],
                ['acesso_recebido', 'bruno'],
            ].sort(),
        );
        // Nenhuma coluna de credencial chega à linha.
        expect(JSON.stringify(linhas)).not.toMatch(/password|auth_user_id/);
    });

    it('keyset: páginas de 4 reproduzem a página única, na ordem (em DESC, fonte, fonte_id DESC)', async () => {
        const base = { userId: ids.ana, username: 'ana', ...SEMANA };
        const tudo = await repo.historico({ ...base, limit: 1000 });
        const andando: typeof tudo = [];
        let cursor:
            | { em: string; fonte: (typeof tudo)[number]['fonte']; fonteId: string }
            | undefined;
        for (let i = 0; i < 50; i += 1) {
            const pagina = await repo.historico({
                ...base,
                limit: 4,
                ...(cursor ? { cursor } : {}),
            });
            andando.push(...pagina);
            const ultima = pagina[pagina.length - 1];
            if (pagina.length < 4 || !ultima) break;
            cursor = { em: ultima.em, fonte: ultima.fonte, fonteId: ultima.fonteId };
        }
        expect(andando.map((l) => `${l.fonte}:${l.fonteId}`)).toEqual(
            tudo.map((l) => `${l.fonte}:${l.fonteId}`),
        );
        // Instantes com microssegundos, ISO UTC.
        expect(tudo[0]?.em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    });

    it('filtro de status erro: só as linhas de erro, de qualquer fonte', async () => {
        const linhas = await repo.historico({
            userId: ids.ana,
            username: 'ana',
            ...SEMANA,
            status: 'erro',
            limit: 100,
        });
        expect(linhas.map((l) => l.fonte).sort()).toEqual(
            ['conciliacao', 'permuta_execucao', 'remessa', 'sn_execucao'].sort(),
        );
        expect(linhas.every((l) => l.statusBruto === 'error')).toBe(true);
    });
});

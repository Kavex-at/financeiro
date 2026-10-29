import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import ValorAbertoLiquido from '../../libs/boleto/ValorAbertoLiquido.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
import F from './__fixtures__/grupoBoleto.js';
import AncoraOrdemDps from './AncoraOrdemDps.js';
import BoletoSuggestionService from './BoletoSuggestionService.js';
import GrupoBoletoService from './GrupoBoletoService.js';
import MotorGrupoBoleto from './MotorGrupoBoleto.js';
import MotorSugestaoBoleto from './MotorSugestaoBoleto.js';
import RegraGrupoBoleto from './RegraGrupoBoleto.js';
import RegraIrmaosConjunto from './RegraIrmaosConjunto.js';
import RegraSugestaoBoleto from './RegraSugestaoBoleto.js';
import SugestaoBoletoCache from './SugestaoBoletoCache.js';

/**
 * GrupoBoletoService (ADR-0077, Tasks 9 e 10) contra um Postgres DE VERDADE: corrida de
 * confirmações (advisory lock + índices parciais), anulação que retira os N itens do lote
 * `RASCUNHO` na mesma transação, corrida grupo × decisão 1:1 sob o MESMO lock (I15q) e a cascata
 * da revogação do par (rollback desfaz a anulação). O `fin064` é um dublê (régua líquida = valor da carteira). Roda no `npm run test:sql`
 * com DSN LOCAL (apaga e recria `sispag_grupo_boleto_service_it`).
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_grupo_boleto_service_it';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const LOTE = '00000000-0000-0000-0000-00000000cc11';
const HOJE = new Date('2026-10-20T15:00:00Z');

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('GrupoBoletoService (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let service: GrupoBoletoService;
    let sugestao1a1: BoletoSuggestionService;
    let sugestoesRepo: SugestaoBoletoRepository;
    let carteira: TituloAPagarRepository;

    const boleto = (ditCod: number, valor: number) =>
        F.boleto({ ddcCod: 900, ditCod, numero: String(ditCod), valor, vencimento: '2026-10-21' });

    const inserirTitulo = (doc: string, pesCod = '9001', valor = 525) =>
        db.query(
            `INSERT INTO titulo_a_pagar (fil_cod, doc_cod, tit_cod, credor, pes_cod, valor,
                vencimento, aprovado, pago, banco, tem_boleto, doc_esp_numero,
                forma_pagamento_conexos, ativo)
             VALUES (2, $1, '1', 'PEDRONI', $2, $3, $4, TRUE, FALSE, '341', FALSE, $1, 6, TRUE)`,
            [doc, pesCod, valor, new Date(Date.UTC(2026, 9, 21))],
        );

    const inserirBoleto = (ditCod: number, valor: number) => {
        const b = boleto(ditCod, valor);
        return db.query(
            `INSERT INTO boleto_dda (ddc_cod, dit_cod, numero, valor, vencimento, codbar)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [b.ddcCod, b.ditCod, b.numero, b.valor, b.vencimento, b.codbar],
        );
    };

    const contar = async (sql: string, params: unknown[] = []): Promise<number> =>
        Number((await db.query(sql, params)).rows[0]?.n ?? 0);

    const chaves = (docs: string[]) => docs.map((docCod) => ({ filCod: 2, docCod, titCod: '1' }));

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
        const dsnBanco = dsnPara(dsn, BANCO);
        db = new Client({ connectionString: dsnBanco });
        await db.connect();
        for (const arquivo of readdirSync(MIGRATIONS)
            .filter((f) => /^\d{4}_.*\.sql$/.test(f))
            .sort()) {
            await db.query(readFileSync(path.join(MIGRATIONS, arquivo), 'utf8'));
        }
        await db.query(
            `INSERT INTO boleto_dda_arquivo (ddc_cod, nome, importado_em, cancelado_em, status, total_itens)
             VALUES (900, 'DDA_2026-10-20.RET', now(), NULL, 1, 4)`,
        );
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        const eventos = new VerificacaoEventoRepository(pool);
        const bloqueios = new BloqueioDuplicidadeRepository(pool, eventos);
        carteira = new TituloAPagarRepository(pool);
        const codigoBarras = new CodigoBarrasBoleto();
        const calendar = BankingCalendar.withClock(() => HOJE);
        const regra = new RegraGrupoBoleto(codigoBarras);
        const sispag = {
            // Dublê do fin064: líquido = valor da carteira (sem juros/desconto/pagamento).
            lerValoresAberto: async (filCod: number, docCod: string, titCod: string) => {
                const t = await carteira.buscarPorChave({ filCod, docCod, titCod });
                const valores = ValorAbertoLiquido.semAcrescimos(t?.valor);
                return valores ? { legivel: true, valores } : { legivel: false, motivo: 'x' };
            },
        };
        const grupoRepo = new GrupoBoletoRepository(pool);
        const boletoRepo = new BoletoDdaRepository(pool);
        const loteRepo = new LotePagamentoRepository(pool, eventos, bloqueios);
        const silencioso = { info: async () => undefined, warn: async () => undefined } as never;
        sugestoesRepo = new SugestaoBoletoRepository(pool);
        service = new GrupoBoletoService(
            grupoRepo,
            new GrupoBoletoExecucaoRepository(pool),
            carteira,
            boletoRepo,
            sugestoesRepo,
            bloqueios,
            loteRepo,
            sispag as never,
            new MotorGrupoBoleto(codigoBarras, calendar, regra),
            regra,
            codigoBarras,
            calendar,
            pool,
            silencioso,
            { invalidar: () => undefined } as never,
        );
        const regra1a1 = new RegraSugestaoBoleto();
        sugestao1a1 = new BoletoSuggestionService(
            sugestoesRepo,
            carteira,
            boletoRepo,
            loteRepo,
            new MotorSugestaoBoleto(codigoBarras, calendar, regra1a1, new AncoraOrdemDps()),
            regra1a1,
            codigoBarras,
            calendar,
            pool,
            silencioso,
            SugestaoBoletoCache.withClock(() => HOJE.getTime()),
            { listarLidos: async () => [] } as never,
            { agendarAposConfirmar: () => undefined } as never,
            grupoRepo,
            service,
            new RegraIrmaosConjunto(codigoBarras),
            new MotorGrupoBoleto(codigoBarras, calendar, regra),
            bloqueios,
        );
        for (const doc of ['38883', '38884', '38885']) await inserirTitulo(doc);
        // Outro credor: fora do conjunto fechado do PEDRONI (I21e).
        for (const doc of ['40001', '40002']) await inserirTitulo(doc, '9002');
        // Task 10: corrida grupo × 1:1 (credor 9003) e cascata do par (credor 9004).
        for (const doc of ['50001', '50002']) await inserirTitulo(doc, '9003', 100);
        for (const doc of ['60001', '60002']) await inserirTitulo(doc, '9004', 300);
        await inserirBoleto(332841, 1575);
        await inserirBoleto(332900, 1050);
        await inserirBoleto(333001, 100);
        await inserirBoleto(333002, 200);
        await inserirBoleto(334001, 600);
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('PEDRONI: duas confirmações concorrentes do mesmo conjunto ⇒ UM grupo, a outra recebe o existente', async () => {
        const pedido = {
            origem: 'SUGERIDO' as const,
            ddcCod: 900,
            ditCod: 332841,
            titulos: chaves(['38883', '38884', '38885']),
        };
        const [a, b] = await Promise.all([
            service.confirmar({ ...pedido, ator: 'ana' }),
            service.confirmar({ ...pedido, ator: 'bia' }),
        ]);
        expect([a.criado, b.criado].sort()).toEqual([false, true]);
        expect(a.grupo.id).toBe(b.grupo.id);
        expect(
            await contar(
                `SELECT count(*) AS n FROM sispag_grupo_boleto WHERE ddc_cod = 900 AND dit_cod = 332841`,
            ),
        ).toBe(1);
        expect(
            await contar(
                `SELECT count(*) AS n FROM sispag_grupo_boleto_evento WHERE tipo = 'GRUPO_CONFIRMADO'`,
            ),
        ).toBe(1);
        // O par nasceu VIGENTE no mesmo ato (e só um).
        expect(
            await contar(
                `SELECT count(*) AS n FROM sispag_confirmacao_emissor_boleto
                  WHERE pes_cod = '9001' AND estado = 'VIGENTE'`,
            ),
        ).toBe(1);
        expect(a.grupo.titulos.map((t) => t.valorLiquidoCentavos)).toEqual([52500, 52500, 52500]);
    });

    it('anular em lote RASCUNHO retira os N itens e anula grupo e títulos numa transação', async () => {
        const g = await service.confirmar({
            origem: 'MANUAL',
            ddcCod: 900,
            ditCod: 332900,
            titulos: chaves(['40001', '40002']),
            ator: 'ana',
        });
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 2, 'RASCUNHO', 'ana')`,
            [LOTE],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, modalidade,
                incluido_por, grupo_boleto_id)
             VALUES ($1, 2, '40001', '1', 'BOLETO', 'ana', $2), ($1, 2, '40002', '1', 'BOLETO', 'ana', $2)`,
            [LOTE, g.grupo.id],
        );
        const r = await service.anular({
            grupoId: g.grupo.id,
            motivo: 'boleto pago à mão pelo financeiro',
            ator: 'ana',
        });
        expect(r).toMatchObject({ anulado: true, retiradoDoLoteId: LOTE });
        expect(
            await contar(`SELECT count(*) AS n FROM lote_pagamento_item WHERE lote_id = $1`, [
                LOTE,
            ]),
        ).toBe(0);
        expect(
            await contar(
                `SELECT count(*) AS n FROM sispag_grupo_boleto_titulo
                  WHERE grupo_id = $1 AND estado = 'ANULADO'`,
                [g.grupo.id],
            ),
        ).toBe(2);
        // Os títulos estão livres de novo: o mesmo conjunto pode ser confirmado outra vez.
        const de_novo = await service.confirmar({
            origem: 'MANUAL',
            ddcCod: 900,
            ditCod: 332900,
            titulos: chaves(['40001', '40002']),
            ator: 'ana',
        });
        expect(de_novo.criado).toBe(true);
        expect(de_novo.grupo.id).not.toBe(g.grupo.id);
    });

    it('corrida grupo × decisão 1:1 sobre o MESMO título ⇒ só uma vence (advisory lock, I15q)', async () => {
        const [umPraUm, grupo] = await Promise.allSettled([
            sugestao1a1.confirmar({
                filCod: 2,
                docCod: '50001',
                titCod: '1',
                ddcCod: 900,
                ditCod: 333001,
                ator: 'ana',
            }),
            service.confirmar({
                origem: 'MANUAL',
                ddcCod: 900,
                ditCod: 333002,
                titulos: chaves(['50001', '50002']),
                ator: 'bia',
            }),
        ]);
        expect([umPraUm.status, grupo.status].sort()).toEqual(['fulfilled', 'rejected']);
        const decisoes = await contar(
            `SELECT count(*) AS n FROM sispag_decisao_sugestao_boleto
              WHERE doc_cod = '50001' AND decisao = 'CONFIRMADA'`,
        );
        const emGrupo = await contar(
            `SELECT count(*) AS n FROM sispag_grupo_boleto_titulo
              WHERE doc_cod = '50001' AND estado = 'CONFIRMADO'`,
        );
        expect(decisoes + emGrupo).toBe(1);
        const perdedor = [umPraUm, grupo].find((r) => r.status === 'rejected');
        expect((perdedor as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });
    });

    it('revogar o par anula os grupos dele na mesma transação; rollback da revogação desfaz a anulação', async () => {
        const g = await service.confirmar({
            origem: 'MANUAL',
            ddcCod: 900,
            ditCod: 334001,
            titulos: chaves(['60001', '60002']),
            ator: 'ana',
        });
        const parId = g.grupo.confirmacaoEmissorId ?? '';
        const estado = async () =>
            (
                await db.query(
                    `SELECT estado, anulado_por, tipo_anulacao FROM sispag_grupo_boleto WHERE id = $1`,
                    [g.grupo.id],
                )
            ).rows[0];

        // A trilha do PAR_REVOGADO falha DEPOIS da cascata ⇒ a transação inteira volta.
        const original = sugestoesRepo.inserirEvento;
        const espiao = jest
            .spyOn(sugestoesRepo, 'inserirEvento')
            .mockImplementation(async (e, tx) => {
                if (e.tipo === 'PAR_REVOGADO') throw new Error('trilha indisponível');
                return original(e, tx);
            });
        await expect(
            sugestao1a1.revogarPar({ id: parId, motivo: 'emissor errado', ator: 'ana' }),
        ).rejects.toThrow('trilha indisponível');
        espiao.mockRestore();
        expect(await estado()).toMatchObject({ estado: 'CONFIRMADO', anulado_por: null });

        await sugestao1a1.revogarPar({ id: parId, motivo: 'emissor errado', ator: 'ana' });
        expect(await estado()).toMatchObject({
            estado: 'ANULADO',
            anulado_por: 'sistema',
            tipo_anulacao: 'PAR_REVOGADO',
        });
        expect(
            await contar(
                `SELECT count(*) AS n FROM sispag_grupo_boleto_titulo
                  WHERE grupo_id = $1 AND estado = 'ANULADO'`,
                [g.grupo.id],
            ),
        ).toBe(2);
    });
});

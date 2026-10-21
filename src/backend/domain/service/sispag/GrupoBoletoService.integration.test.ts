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
import GrupoBoletoService from './GrupoBoletoService.js';
import MotorGrupoBoleto from './MotorGrupoBoleto.js';
import RegraGrupoBoleto from './RegraGrupoBoleto.js';

/**
 * GrupoBoletoService (ADR-0077, Task 9) contra um Postgres DE VERDADE: corrida de confirmações
 * (advisory lock + índices parciais), anulação que retira os N itens do lote `RASCUNHO` na mesma
 * transação. O `fin064` é um dublê (régua líquida = valor da carteira). Roda no `npm run test:sql`
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
        service = new GrupoBoletoService(
            new GrupoBoletoRepository(pool),
            new GrupoBoletoExecucaoRepository(pool),
            carteira,
            new BoletoDdaRepository(pool),
            new SugestaoBoletoRepository(pool),
            bloqueios,
            new LotePagamentoRepository(pool, eventos, bloqueios),
            sispag as never,
            new MotorGrupoBoleto(codigoBarras, calendar, regra),
            regra,
            codigoBarras,
            calendar,
            pool,
            { info: async () => undefined, warn: async () => undefined } as never,
            { invalidar: () => undefined } as never,
        );
        for (const doc of ['38883', '38884', '38885']) await inserirTitulo(doc);
        // Outro credor: fora do conjunto fechado do PEDRONI (I21e).
        for (const doc of ['40001', '40002']) await inserirTitulo(doc, '9002');
        await inserirBoleto(332841, 1575);
        await inserirBoleto(332900, 1050);
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
});

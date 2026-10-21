import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import GroupedBoletoAlreadyGroupedError from '../../errors/GroupedBoletoAlreadyGroupedError.js';
import GroupedBoletoTitleIneligibleError from '../../errors/GroupedBoletoTitleIneligibleError.js';
import type { NovoGrupoBoleto } from '../../interface/sispag/GrupoBoletoInterface.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import GrupoBoletoRepository from './GrupoBoletoRepository.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * Grupo de boleto (ADR-0077, I21i/I21t/I21r) contra um Postgres DE VERDADE: confirmação
 * idempotente sob advisory lock, conflitos tipados, anulação e pagamento com os títulos, trilha,
 * marcas `GRUPO_BOLETO` e as consultas da formação automática. Roda no `npm run test:sql` com DSN
 * LOCAL (apaga e recria `sispag_grupo_boleto_repo_it`).
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_grupo_boleto_repo_it';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const PAR = '00000000-0000-0000-0000-00000000bb01';
const LOTE = '00000000-0000-0000-0000-00000000bb11';
const MASCARA = '34191…8200';
const HOJE = new Date(Date.UTC(2026, 9, 20));

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

const titulos = (docs: string[], valor = 52500, vencimento = '2026-10-21') =>
    docs.map((docCod) => ({
        filCod: 2,
        docCod,
        titCod: '1',
        valorLiquidoCentavos: valor,
        vencimento,
    }));

const novo = (
    ddcCod: number,
    docs: string[],
    over: Partial<NovoGrupoBoleto> = {},
): NovoGrupoBoleto => {
    const ts = titulos(docs);
    return {
        filCod: 2,
        pesCod: '7001',
        credor: 'PEDRONI',
        emissorChave: '341:1:1',
        ddcCod,
        ditCod: 1,
        codbarMascarado: MASCARA,
        valorBoletoCentavos: ts.reduce((s, t) => s + t.valorLiquidoCentavos, 0),
        vencimentoBoleto: '2026-10-21',
        titulos: ts,
        origem: 'SUGERIDO',
        intercambiavel: false,
        avisosReconhecidos: [],
        confirmacaoEmissorId: PAR,
        confirmadoPor: 'ana',
        ...over,
    };
};

describeComBanco('GrupoBoletoRepository (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: GrupoBoletoRepository;
    let bloqueios: BloqueioDuplicidadeRepository;
    let carteira: TituloAPagarRepository;

    const titulo = (doc: string, venc = Date.UTC(2026, 9, 21)) =>
        db.query(
            `INSERT INTO titulo_a_pagar (fil_cod, doc_cod, tit_cod, credor, pes_cod, valor,
                vencimento, aprovado, pago, banco, tem_boleto, doc_esp_numero)
             VALUES (2, $1, '1', 'PEDRONI', '7001', 525.00, $2, TRUE, FALSE, '341', FALSE, $1)`,
            [doc, new Date(venc)],
        );

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
            `INSERT INTO sispag_confirmacao_emissor_boleto
                (id, pes_cod, emissor_chave, layout_emissor, banco_emissor, emissor_mascarado,
                 confirmado_por)
             VALUES ($1, '7001', '341:1:1', 'GENERICO', '341', '341 / 1 / ***1', 'ana')`,
            [PAR],
        );
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 2, 'RASCUNHO', 'ana')`,
            [LOTE],
        );
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        repo = new GrupoBoletoRepository(pool);
        bloqueios = new BloqueioDuplicidadeRepository(pool, new VerificacaoEventoRepository(pool));
        carteira = new TituloAPagarRepository(pool);
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('PEDRONI: grupo + 3 títulos + evento GRUPO_CONFIRMADO; confirmar de novo devolve o existente sem evento', async () => {
        const a = await repo.inserirConfirmado(novo(332841, ['38883', '38884', '38885']));
        expect(a.criado).toBe(true);
        expect(a.grupo).toMatchObject({
            estado: 'CONFIRMADO',
            valorBoletoCentavos: 157500,
            somaTitulosCentavos: 157500,
            vencimentoBoleto: '2026-10-21',
            codbarMascarado: MASCARA,
            versao: 1,
        });
        expect(a.grupo.titulos.map((t) => t.docCod)).toEqual(['38883', '38884', '38885']);
        const b = await repo.inserirConfirmado(novo(332841, ['38885', '38884', '38883']));
        expect(b).toEqual({ criado: false, grupo: a.grupo });
        const eventos = await repo.listarEventos(a.grupo.id);
        expect(eventos.map((e) => e.tipo)).toEqual(['GRUPO_CONFIRMADO']);
        expect(eventos[0]).toMatchObject({ ator: 'ana', codigoMascarado: MASCARA, ddcCod: 332841 });
    });

    it('mesmo boleto com outros títulos ⇒ GroupedBoletoAlreadyGroupedError; título em outro grupo ⇒ EM_OUTRO_GRUPO', async () => {
        await expect(
            repo.inserirConfirmado(novo(332841, ['38883', '38884', '99999'])),
        ).rejects.toBeInstanceOf(GroupedBoletoAlreadyGroupedError);
        const e = await repo.inserirConfirmado(novo(500, ['38883', '50001'])).catch((x) => x);
        expect(e).toBeInstanceOf(GroupedBoletoTitleIneligibleError);
        expect(e.details.titulos).toEqual([
            { filCod: 2, docCod: '38883', titCod: '1', motivo: 'EM_OUTRO_GRUPO' },
        ]);
        // Nada ficou gravado pelas tentativas recusadas.
        const { rows } = await db.query(
            `SELECT count(*)::int AS n FROM sispag_grupo_boleto WHERE ddc_cod = 500`,
        );
        expect(rows[0].n).toBe(0);
    });

    it('corrida de duas confirmações do mesmo conjunto ⇒ um grupo; a outra recebe o existente', async () => {
        const entrada = novo(600, ['60001', '60002']);
        const [x, y] = await Promise.all([
            repo.inserirConfirmado(entrada),
            repo.inserirConfirmado(entrada),
        ]);
        expect([x.criado, y.criado].sort()).toEqual([false, true]);
        expect(x.grupo.id).toBe(y.grupo.id);
        const { rows } = await db.query(
            `SELECT count(*)::int AS n FROM sispag_grupo_boleto WHERE ddc_cod = 600`,
        );
        expect(rows[0].n).toBe(1);
    });

    it('corrida de dois boletos disputando o mesmo título ⇒ um vence, o outro recebe erro tipado', async () => {
        const r = await Promise.allSettled([
            repo.inserirConfirmado(novo(700, ['70001', '70002'])),
            repo.inserirConfirmado(novo(701, ['70001', '70003'])),
        ]);
        const ok = r.filter((x) => x.status === 'fulfilled');
        const falhou = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
        expect(ok).toHaveLength(1);
        expect(falhou).toHaveLength(1);
        expect(falhou[0]?.reason).toBeInstanceOf(GroupedBoletoTitleIneligibleError);
    });

    it('anular: grupo e títulos ANULADO, versao + 1, evento; de novo ⇒ JA_APLICADO; títulos e boleto voltam a ser agrupáveis', async () => {
        const { grupo } = await repo.inserirConfirmado(novo(800, ['80001', '80002']));
        const r = await repo.anular({
            grupoId: grupo.id,
            motivo: 'boleto errado, a analista corrigiu',
            tipoAnulacao: 'MANUAL',
            ator: 'bia',
        });
        expect(r.resultado).toBe('APLICADO');
        expect(r.grupo).toMatchObject({
            estado: 'ANULADO',
            anuladoPor: 'bia',
            tipoAnulacao: 'MANUAL',
            versao: 2,
        });
        const { rows } = await db.query(
            `SELECT DISTINCT estado FROM sispag_grupo_boleto_titulo WHERE grupo_id = $1`,
            [grupo.id],
        );
        expect(rows).toEqual([{ estado: 'ANULADO' }]);
        const de_novo = await repo.anular({
            grupoId: grupo.id,
            motivo: 'segunda tentativa de anular',
            tipoAnulacao: 'MANUAL',
            ator: 'bia',
        });
        expect(de_novo.resultado).toBe('JA_APLICADO');
        expect((await repo.listarEventos(grupo.id)).map((e) => e.tipo)).toEqual([
            'GRUPO_CONFIRMADO',
            'GRUPO_ANULADO',
        ]);
        expect((await repo.inserirConfirmado(novo(800, ['80001', '80002']))).criado).toBe(true);
    });

    it('anulação pela cascata do par: ator sistema com PAR_REVOGADO', async () => {
        const { grupo } = await repo.inserirConfirmado(novo(850, ['85001', '85002']));
        const r = await repo.anular({
            grupoId: grupo.id,
            motivo: 'par emissor revogado pela analista',
            tipoAnulacao: 'PAR_REVOGADO',
            ator: 'sistema',
        });
        expect(r.resultado).toBe('APLICADO');
    });

    it('marcarPago: CONFIRMADO ⇒ PAGO (idempotente); PAGO não se anula; inexistente ⇒ NAO_ENCONTRADO', async () => {
        const { grupo } = await repo.inserirConfirmado(novo(900, ['90001', '90002']));
        const em = new Date('2026-10-22T12:00:00Z');
        expect(
            (await repo.marcarPago({ grupoId: grupo.id, observadoEm: em, borCod: 253 })).resultado,
        ).toBe('APLICADO');
        expect((await repo.marcarPago({ grupoId: grupo.id, observadoEm: em })).resultado).toBe(
            'JA_APLICADO',
        );
        const pago = await repo.buscarPorId(grupo.id);
        expect(pago).toMatchObject({ estado: 'PAGO', pagoObservadoEm: em });
        expect(
            (
                await repo.anular({
                    grupoId: grupo.id,
                    motivo: 'tentando anular um grupo pago',
                    tipoAnulacao: 'MANUAL',
                    ator: 'ana',
                })
            ).resultado,
        ).toBe('RECUSADO');
        expect(
            (
                await repo.marcarPago({
                    grupoId: '00000000-0000-0000-0000-0000000000ff',
                    observadoEm: em,
                })
            ).resultado,
        ).toBe('NAO_ENCONTRADO');
    });

    it('buscarConfirmadoPorTitulo / PorBoleto e listarConfirmados por filial', async () => {
        const porTitulo = await repo.buscarConfirmadoPorTitulo({
            filCod: 2,
            docCod: '38884',
            titCod: '1',
        });
        expect(porTitulo?.ddcCod).toBe(332841);
        expect(
            await repo.buscarConfirmadoPorTitulo({ filCod: 2, docCod: '90001', titCod: '1' }),
        ).toBeNull();
        expect((await repo.buscarConfirmadoPorBoleto(332841, 1))?.id).toBe(porTitulo?.id);
        const filial2 = await repo.listarConfirmados({ filCod: 2 });
        expect(filial2.every((g) => g.estado === 'CONFIRMADO' && g.filCod === 2)).toBe(true);
        expect(await repo.listarConfirmados({ filCod: 9 })).toEqual([]);
    });

    it('marcas GRUPO_BOLETO: N numa transação; encerrarDoGrupo só encerra as de origem GRUPO_BOLETO', async () => {
        const { grupo } = await repo.inserirConfirmado(novo(1000, ['10001', '10002', '10003']));
        await db.query(
            `INSERT INTO titulo_bloqueio_duplicidade
                (id, fil_cod, doc_cod, tit_cod, motivo, estado, marcado_por, origem, codigo_mascarado,
                 lote_id_origem)
             VALUES ('00000000-0000-0000-0000-00000000cc01', 2, '10003', '1', 'repetido', 'ATIVO',
                     'sistema', 'CODIGO_BARRAS_REPETIDO', $1, $2)`,
            [MASCARA, LOTE],
        );
        const ids = await pool.withTransaction((tx) =>
            bloqueios.criarDoGrupo(
                {
                    grupoId: grupo.id,
                    titulos: grupo.titulos,
                    pesCod: '7001',
                    loteIdOrigem: LOTE,
                    motivo: 'grupo retirado da remessa',
                    ator: 'sistema',
                    codigoMascarado: MASCARA,
                },
                tx,
            ),
        );
        expect(ids).toHaveLength(3);
        const { rows } = await db.query(
            `SELECT doc_cod, origem FROM titulo_bloqueio_duplicidade
              WHERE estado = 'ATIVO' AND doc_cod IN ('10001','10002','10003') ORDER BY doc_cod`,
        );
        // O 10003 já tinha marca ATIVA de outra origem: ela vale (no máximo uma por título).
        expect(rows).toEqual([
            { doc_cod: '10001', origem: 'GRUPO_BOLETO' },
            { doc_cod: '10002', origem: 'GRUPO_BOLETO' },
            { doc_cod: '10003', origem: 'CODIGO_BARRAS_REPETIDO' },
        ]);
        const n = await bloqueios.encerrarDoGrupo({
            grupoId: grupo.id,
            motivo: 'grupo anulado',
            ator: 'ana',
        });
        expect(n).toBe(2);
        const { rows: ativas } = await db.query(
            `SELECT doc_cod FROM titulo_bloqueio_duplicidade
              WHERE estado = 'ATIVO' AND doc_cod IN ('10001','10002','10003')`,
        );
        expect(ativas).toEqual([{ doc_cod: '10003' }]);
    });

    it('marca GRUPO_BOLETO não se encerra pelos sinais de código de barras (lote de origem cancelado sem remessa)', async () => {
        const cancelado = '00000000-0000-0000-0000-00000000bb12';
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por) VALUES ($1, 2, 'CANCELADO', 'ana')`,
            [cancelado],
        );
        const { grupo } = await repo.inserirConfirmado(novo(1100, ['11001', '11002']));
        await pool.withTransaction((tx) =>
            bloqueios.criarDoGrupo(
                {
                    grupoId: grupo.id,
                    titulos: grupo.titulos,
                    loteIdOrigem: cancelado,
                    motivo: 'grupo retirado da remessa',
                    ator: 'sistema',
                },
                tx,
            ),
        );
        await bloqueios.encerrarPorSinaisDeCodigoDeBarras();
        const { rows } = await db.query(
            `SELECT count(*)::int AS n FROM titulo_bloqueio_duplicidade
              WHERE estado = 'ATIVO' AND origem = 'GRUPO_BOLETO' AND doc_cod IN ('11001', '11002')`,
        );
        expect(rows[0].n).toBe(2);
    });

    describe('formação automática', () => {
        beforeAll(async () => {
            for (const d of [
                '20001',
                '20002',
                '20003',
                '21001',
                '21002',
                '22001',
                '22002',
                '23001',
            ]) {
                await titulo(d);
            }
            // Grupo disponível: entra inteiro.
            await repo.inserirConfirmado(novo(2000, ['20001', '20002']));
            // Grupo com título retido: fora.
            const { grupo } = await repo.inserirConfirmado(novo(2100, ['21001', '21002']));
            await pool.withTransaction((tx) =>
                bloqueios.criarDoGrupo(
                    {
                        grupoId: grupo.id,
                        titulos: [grupo.titulos[0] as (typeof grupo.titulos)[number]],
                        loteIdOrigem: LOTE,
                        motivo: 'retido',
                        ator: 'sistema',
                    },
                    tx,
                ),
            );
            // Grupo com título num lote vivo: fora.
            await repo.inserirConfirmado(novo(2200, ['22001', '22002']));
            await db.query(
                `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por)
                 VALUES ($1, 2, '22001', '1', 'ana')`,
                [LOTE],
            );
        });

        it('título de grupo CONFIRMADO nunca é elegível avulso; o avulso do mesmo credor é', async () => {
            const docs = (await carteira.listElegiveisParaFormacao(7, HOJE)).map((t) => t.docCod);
            expect(docs).toContain('23001');
            for (const d of ['20001', '20002', '21001', '22002']) expect(docs).not.toContain(d);
        });

        it('listGruposParaFormacao: só o grupo disponível, com os títulos da carteira e o vencimento do boleto', async () => {
            const grupos = await carteira.listGruposParaFormacao(7, HOJE);
            expect(grupos.map((g) => g.titulos.map((t) => t.docCod))).toEqual([['20001', '20002']]);
            expect(grupos[0]).toMatchObject({
                filCod: 2,
                pesCod: '7001',
                valorBoletoCentavos: 105000,
                vencimentoBoleto: Date.UTC(2026, 9, 21),
            });
        });

        it('janela pelo boleto: fora de [hoje, hoje + maxDias] não entra', async () => {
            expect(
                await carteira.listGruposParaFormacao(7, new Date(Date.UTC(2026, 9, 22))),
            ).toEqual([]);
            expect(
                (await carteira.listGruposParaFormacao(0, new Date(Date.UTC(2026, 9, 21)))).length,
            ).toBe(1);
        });
    });
});

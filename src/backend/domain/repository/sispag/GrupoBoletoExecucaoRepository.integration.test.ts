import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import GrupoBoletoExecucaoRepository from './GrupoBoletoExecucaoRepository.js';
import GrupoBoletoRepository from './GrupoBoletoRepository.js';
import LotePagamentoRepository, { type ItemDoGrupo } from './LotePagamentoRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * Ledger do borderô do grupo (ADR-0076, I19l/I19s) e o grupo como unidade no lote (I19j, L6)
 * contra um Postgres DE VERDADE. Roda no `npm run test:sql` com DSN LOCAL (apaga e recria
 * `sispag_grupo_execucao_repo_it`).
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_grupo_execucao_repo_it';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const PAR = '00000000-0000-0000-0000-00000000dd01';
const LOTE_A = '00000000-0000-0000-0000-00000000dd11';
const LOTE_B = '00000000-0000-0000-0000-00000000dd12';
const MASCARA = '34191…8200';
const T_253 = 1792523939000;

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('GrupoBoletoExecucaoRepository e o grupo no lote (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let grupos: GrupoBoletoRepository;
    let execucoes: GrupoBoletoExecucaoRepository;
    let lotes: LotePagamentoRepository;
    let remessaId = 0;

    const grupo = async (ddc: number, docs: string[], vencimentoBoleto = '2026-10-21') => {
        const titulos = docs.map((docCod) => ({
            filCod: 2,
            docCod,
            titCod: '1',
            valorLiquidoCentavos: 34100,
            vencimento: '2026-10-19',
        }));
        const { grupo: g } = await grupos.inserirConfirmado({
            filCod: 2,
            pesCod: '1147',
            emissorChave: '341:1:1',
            ddcCod: ddc,
            ditCod: 1,
            codbarMascarado: MASCARA,
            valorBoletoCentavos: 34100 * docs.length,
            vencimentoBoleto,
            titulos,
            origem: 'MANUAL',
            intercambiavel: false,
            avisosReconhecidos: ['TITULO_VENCE_ANTES_DO_BOLETO'],
            confirmacaoEmissorId: PAR,
            confirmadoPor: 'ana',
        });
        return g;
    };

    const itens = (docs: string[], venc = Date.UTC(2026, 9, 19)): ItemDoGrupo[] =>
        docs.map((docCod) => ({
            filCod: 2,
            docCod,
            titCod: '1',
            credor: 'DHL',
            valor: 341,
            vencimento: venc,
        }));

    const versao = async (loteId: string): Promise<number> =>
        (await db.query(`SELECT versao FROM lote_pagamento WHERE id = $1`, [loteId])).rows[0]
            .versao;

    const docsDoLote = async (loteId: string): Promise<string[]> =>
        (
            await db.query(
                `SELECT doc_cod FROM lote_pagamento_item WHERE lote_id = $1 ORDER BY doc_cod`,
                [loteId],
            )
        ).rows.map((r) => r.doc_cod);

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
             VALUES ($1, '1147', '341:1:1', 'GENERICO', '341', '341 / 1 / ***1', 'ana')`,
            [PAR],
        );
        await db.query(
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por)
             VALUES ($1, 2, 'RASCUNHO', 'ana'), ($2, 2, 'RASCUNHO', 'ana')`,
            [LOTE_A, LOTE_B],
        );
        const { rows } = await db.query(
            `INSERT INTO remessa_execucao (idempotency_key, lote_id, fil_cod, bnc_cod, etapa)
             VALUES ('gb-exec-1', $1, 2, 4, 'preparar_bordero') RETURNING id`,
            [LOTE_A],
        );
        remessaId = Number(rows[0].id);
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        const eventos = new VerificacaoEventoRepository(pool);
        grupos = new GrupoBoletoRepository(pool);
        execucoes = new GrupoBoletoExecucaoRepository(pool);
        lotes = new LotePagamentoRepository(
            pool,
            eventos,
            new BloqueioDuplicidadeRepository(pool, eventos),
        );
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    describe('ledger do borderô', () => {
        let grupoId = '';
        let execId = '';
        const t0 = new Date('2026-10-21T13:00:00.000Z');

        beforeAll(async () => {
            grupoId = (await grupo(1, ['566', '577'])).id;
        });

        it('abrir grava t0 e a identidade Conexos; segunda abertura devolve a não terminal', async () => {
            const a = await execucoes.abrir({
                grupoId,
                loteId: LOTE_A,
                filCod: 2,
                remessaExecucaoId: remessaId,
                bncCod: 4,
                flpCod: 51,
                gerNum: 38,
                borDtaMvto: '2026-10-22',
                escritaIniciadaEm: t0,
                conexosUsername: 'MPS_FRANCINEI',
                conexosUsnCod: '97',
            });
            expect(a.criado).toBe(true);
            expect(a.execucao).toMatchObject({
                etapa: 'intencao_gravada',
                escritaIniciadaEm: t0,
                borDtaMvto: '2026-10-22',
                gerNum: 38,
                remessaExecucaoId: remessaId,
                conexosUsnCod: '97',
                baixas: [],
                tentativas: 1,
            });
            expect(a.execucao.escritaConcluidaEm).toBeUndefined();
            execId = a.execucao.id;
            const b = await execucoes.abrir({ grupoId, loteId: LOTE_A, filCod: 2 });
            expect(b).toMatchObject({ criado: false, execucao: { id: execId } });
        });

        it('registrarBordero grava borCod + borTimCad (epoch ms exato) com t1 ausente; outra identidade é recusada', async () => {
            expect(
                await execucoes.registrarBordero(execId, {
                    borCod: 253,
                    borTimCad: T_253,
                    usnCodCad: 97,
                }),
            ).toBe(true);
            // Idempotente com a MESMA identidade, agora com t1.
            const t1 = new Date('2026-10-21T13:00:02.000Z');
            expect(
                await execucoes.registrarBordero(execId, {
                    borCod: 253,
                    borTimCad: T_253,
                    escritaConcluidaEm: t1,
                }),
            ).toBe(true);
            // O ERP reusou o 253 para outra pessoa: nunca adotar.
            expect(
                await execucoes.registrarBordero(execId, {
                    borCod: 253,
                    borTimCad: T_253 + 170_000,
                }),
            ).toBe(false);
            expect(
                await execucoes.registrarBordero(execId, { borCod: 254, borTimCad: T_253 }),
            ).toBe(false);
            const e = await execucoes.buscarPorId(execId);
            expect(e).toMatchObject({
                borCod: 253,
                borTimCad: T_253,
                usnCodCad: 97,
                escritaIniciadaEm: t0,
                escritaConcluidaEm: t1,
            });
        });

        it('registrarBaixa acumula uma por título e substitui a repetida', async () => {
            await execucoes.registrarBaixa(execId, {
                docCod: '566',
                titCod: '1',
                bxaCodSeq: 1,
                valorCentavos: 34100,
            });
            await execucoes.registrarBaixa(execId, {
                docCod: '577',
                titCod: '1',
                bxaCodSeq: 1,
                valorCentavos: 34100,
            });
            await execucoes.registrarBaixa(execId, {
                docCod: '566',
                titCod: '1',
                bxaCodSeq: 2,
                valorCentavos: 34100,
            });
            const e = await execucoes.buscarPorId(execId);
            expect(e?.baixas).toEqual([
                { docCod: '577', titCod: '1', bxaCodSeq: 1, valorCentavos: 34100 },
                { docCod: '566', titCod: '1', bxaCodSeq: 2, valorCentavos: 34100 },
            ]);
        });

        it('registrarEtapa: lock otimista pela etapa de origem; inválida lança; motivo e itsCodSeq gravados', async () => {
            expect(
                await execucoes.registrarEtapa(execId, 'intencao_gravada', 'bordero_criado'),
            ).toBe(true);
            // Outro processo leu a etapa velha: nada muda.
            expect(
                await execucoes.registrarEtapa(execId, 'intencao_gravada', 'bordero_criado'),
            ).toBe(false);
            await expect(
                execucoes.registrarEtapa(execId, 'bordero_criado', 'concluido'),
            ).rejects.toThrow(/transição inválida/);
            for (const [de, para] of [
                ['bordero_criado', 'baixas_gravadas'],
                ['baixas_gravadas', 'bordero_conferido'],
            ] as const) {
                expect(await execucoes.registrarEtapa(execId, de, para)).toBe(true);
            }
            expect(
                await execucoes.registrarEtapa(execId, 'bordero_conferido', 'importado', {
                    itsCodSeq: 1,
                }),
            ).toBe(true);
            expect((await execucoes.buscarPorId(execId))?.itsCodSeq).toBe(1);
        });

        it('terminal libera nova execução; J rejeitado marca a execução e é achado como o "antigo" (I19s)', async () => {
            expect(await execucoes.registrarEtapa(execId, 'importado', 'codbar_vinculado')).toBe(
                true,
            );
            expect(await execucoes.registrarEtapa(execId, 'codbar_vinculado', 'concluido')).toBe(
                true,
            );
            const rej = new Date('2026-10-23T10:00:00Z');
            await execucoes.marcarJRejeitado(execId, rej);
            await execucoes.marcarJRejeitado(execId, new Date('2026-10-24T10:00:00Z'));
            expect((await execucoes.buscarPorId(execId))?.jRejeitadoEm).toEqual(rej);
            const nova = await execucoes.abrir({
                grupoId,
                loteId: LOTE_B,
                filCod: 2,
                borCodReaproveitadoDe: execId,
            });
            expect(nova.criado).toBe(true);
            expect(nova.execucao.borCodReaproveitadoDe).toBe(execId);
            expect((await execucoes.ultimaPorGrupo(grupoId))?.id).toBe(nova.execucao.id);
            expect((await execucoes.ultimaRejeitadaPorGrupo(grupoId))?.id).toBe(execId);
            expect((await execucoes.listarPorGrupo(grupoId)).map((x) => x.id)).toEqual([
                execId,
                nova.execucao.id,
            ]);
            expect((await execucoes.listarPorRemessa(remessaId)).map((x) => x.id)).toEqual([
                execId,
            ]);
            expect((await execucoes.listarPorLote(LOTE_B)).map((x) => x.id)).toEqual([
                nova.execucao.id,
            ]);
        });

        it('registrarInicioEscrita só vale enquanto não há borderô; registrarTentativa soma', async () => {
            const g = await grupo(2, ['600', '601']);
            const { execucao } = await execucoes.abrir({
                grupoId: g.id,
                loteId: LOTE_A,
                filCod: 2,
            });
            const t = new Date('2026-10-21T14:00:00Z');
            await execucoes.registrarInicioEscrita(execucao.id, t);
            await execucoes.registrarTentativa(execucao.id, { conexosUsername: 'MPS_FRANCINEI' });
            const e = await execucoes.buscarPorId(execucao.id);
            expect(e).toMatchObject({ escritaIniciadaEm: t, tentativas: 2 });
        });
    });

    describe('grupo como unidade no lote (I19j)', () => {
        let gId = '';

        beforeAll(async () => {
            gId = (await grupo(10, ['1001', '1002', '1003'])).id;
        });

        it('adicionarGrupo: N itens BOLETO com grupoBoletoId e versao + 1, numa transação', async () => {
            const v = await versao(LOTE_A);
            expect(
                await lotes.adicionarGrupo({
                    loteId: LOTE_A,
                    grupoId: gId,
                    itens: itens(['1001', '1002', '1003']),
                    incluidoPor: 'ana',
                    versaoEsperada: v,
                }),
            ).toBe('APLICADO');
            expect(await versao(LOTE_A)).toBe(v + 1);
            const lote = await lotes.getLoteComItens(LOTE_A);
            const doGrupo = lote?.itens.filter((i) => i.grupoBoletoId === gId) ?? [];
            expect(doGrupo.map((i) => [i.docCod, i.modalidade])).toEqual([
                ['1001', 'BOLETO'],
                ['1002', 'BOLETO'],
                ['1003', 'BOLETO'],
            ]);
        });

        it('falha no N-ésimo item desfaz os anteriores (nunca entra parte do grupo)', async () => {
            const g = await grupo(11, ['1101', '1102', '1103']);
            await db.query(
                `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por)
                 VALUES ($1, 2, '1103', '1', 'ana')`,
                [LOTE_B],
            );
            const v = await versao(LOTE_B);
            await expect(
                lotes.adicionarGrupo({
                    loteId: LOTE_B,
                    grupoId: g.id,
                    itens: itens(['1101', '1102', '1103']),
                    incluidoPor: 'ana',
                }),
            ).rejects.toThrow();
            expect(await docsDoLote(LOTE_B)).toEqual(['1103']);
            expect(await versao(LOTE_B)).toBe(v);
        });

        it('versão desatualizada ou lote fora de RASCUNHO ⇒ CONFLITO, nada gravado', async () => {
            const g = await grupo(12, ['1201', '1202']);
            expect(
                await lotes.adicionarGrupo({
                    loteId: LOTE_B,
                    grupoId: g.id,
                    itens: itens(['1201', '1202']),
                    incluidoPor: 'ana',
                    versaoEsperada: 999,
                }),
            ).toBe('CONFLITO');
            expect(await docsDoLote(LOTE_B)).toEqual(['1103']);
        });

        it('moverGrupo leva os N itens e bumpa as duas versões; mover de onde não está ⇒ AUSENTE', async () => {
            const va = await versao(LOTE_A);
            const vb = await versao(LOTE_B);
            expect(
                await lotes.moverGrupo({ origemId: LOTE_A, destinoId: LOTE_B, grupoId: gId }),
            ).toBe('APLICADO');
            expect(await docsDoLote(LOTE_B)).toEqual(['1001', '1002', '1003', '1103']);
            expect(await versao(LOTE_A)).toBe(va + 1);
            expect(await versao(LOTE_B)).toBe(vb + 1);
            expect(
                await lotes.moverGrupo({ origemId: LOTE_A, destinoId: LOTE_B, grupoId: gId }),
            ).toBe('AUSENTE');
        });

        it('removerGrupo retira os N itens com versao + 1; o avulso fica', async () => {
            const vb = await versao(LOTE_B);
            expect(await lotes.removerGrupo({ loteId: LOTE_B, grupoId: gId })).toBe('APLICADO');
            expect(await docsDoLote(LOTE_B)).toEqual(['1103']);
            expect(await versao(LOTE_B)).toBe(vb + 1);
            expect(await lotes.removerGrupo({ loteId: LOTE_B, grupoId: gId })).toBe('AUSENTE');
        });
    });

    describe('L6 pelo vencimento do boleto (PI-8)', () => {
        const loteAuto = async (id: string) =>
            db.query(
                `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por, automatico)
                 VALUES ($1, 2, 'RASCUNHO', 'sistema', TRUE)`,
                [id],
            );

        it('grupo manual com título vencido ontem e boleto amanhã NÃO desfaz o lote; boleto vencido desfaz', async () => {
            const hoje = new Date(Date.UTC(2026, 9, 21));
            const vivo = '00000000-0000-0000-0000-00000000de01';
            const vencido = '00000000-0000-0000-0000-00000000de02';
            await loteAuto(vivo);
            await loteAuto(vencido);
            const gAmanha = await grupo(20, ['2001', '2002'], '2026-10-22');
            const gOntem = await grupo(21, ['2101', '2102'], '2026-10-20');
            const ontem = Date.UTC(2026, 9, 20);
            await lotes.adicionarGrupo({
                loteId: vivo,
                grupoId: gAmanha.id,
                itens: itens(['2001', '2002'], ontem),
                incluidoPor: 'sistema',
            });
            await lotes.adicionarGrupo({
                loteId: vencido,
                grupoId: gOntem.id,
                itens: itens(['2101', '2102'], ontem),
                incluidoPor: 'sistema',
            });
            expect(await lotes.desfazerAutomaticosVencidos(hoje)).toBe(1);
            const { rows } = await db.query(`SELECT id FROM lote_pagamento WHERE id IN ($1, $2)`, [
                vivo,
                vencido,
            ]);
            expect(rows.map((r) => r.id)).toEqual([vivo]);
        });

        it('boleto que vence HOJE não desfaz (vencido é antes de hoje, dia civil)', async () => {
            const id = '00000000-0000-0000-0000-00000000de03';
            await loteAuto(id);
            const g = await grupo(22, ['2201', '2202'], '2026-10-21');
            await lotes.adicionarGrupo({
                loteId: id,
                grupoId: g.id,
                itens: itens(['2201', '2202'], Date.UTC(2026, 9, 19)),
                incluidoPor: 'sistema',
            });
            await lotes.desfazerAutomaticosVencidos(new Date(Date.UTC(2026, 9, 21)));
            const { rows } = await db.query(`SELECT 1 FROM lote_pagamento WHERE id = $1`, [id]);
            expect(rows).toHaveLength(1);
        });
    });
});

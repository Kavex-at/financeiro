import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import AlertaItemLoteRepository from './AlertaItemLoteRepository.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import PendenciaCadastroRepository from './PendenciaCadastroRepository.js';
import PerfilCanalFornecedorRepository from './PerfilCanalFornecedorRepository.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * Repositórios da verificação TED/PIX (ADR-0063) contra um Postgres DE VERDADE — o SQL que os
 * mocks não provam: `ON CONFLICT` com índice parcial, `DELETE ... USING`, `UPDATE ... FROM`,
 * `CASE` com parâmetro, trilha na mesma transação.
 *
 * Não roda no `npm test`. Roda no `npm run test:sql` com DSN LOCAL:
 *   METRICAS_CICLO_TEST_DSN=postgres://postgres:test@localhost:55432/postgres npm run test:sql
 * Apaga e recria o banco `sispag_verificacao_repos_it`.
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_verificacao_repos_it';
const LOTE = '00000000-0000-0000-0000-000000000063';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const CHAVE = { filCod: 4, docCod: '6173', titCod: '1' };

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('repositórios da verificação TED/PIX (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let eventos: VerificacaoEventoRepository;

    const contarEventos = async (evento: string): Promise<number> =>
        (
            await db.query(
                'SELECT count(*)::int AS n FROM sispag_verificacao_evento WHERE evento = $1',
                [evento],
            )
        ).rows[0].n;

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
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por, conta)
             VALUES ($1, 4, 'RASCUNHO', 'ana', '55795-4')`,
            [LOTE],
        );
        await db.query(
            `INSERT INTO lote_pagamento_item (lote_id, fil_cod, doc_cod, tit_cod, incluido_por, modalidade)
             VALUES ($1, 4, '6173', '1', 'ana', 'TED'), ($1, 4, '6174', '1', 'ana', 'PIX')`,
            [LOTE],
        );
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        eventos = new VerificacaoEventoRepository(pool);
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('alerta: criar, reconfirmar, resolver JUSTIFICADA e fechar OBSOLETA, com trilha', async () => {
        const repo = new AlertaItemLoteRepository(pool, eventos);
        const id = await repo.criar(
            {
                loteId: LOTE,
                chave: CHAVE,
                tipo: 'DUPLICIDADE_FORTE',
                contraparteFilCod: 4,
                contraparteDocCod: '6702',
                contraparteTitulos: [{ titCod: '1', valor: 10, pago: true }],
                evidencia: { numeroNota: '45871' },
            },
            'sistema',
        );
        await repo.confirmar(id, { evidencia: { numeroNota: '45871' } });
        const [viva] = await repo.listVivasDoItem(LOTE, CHAVE);
        expect(viva).toMatchObject({ id, estado: 'ABERTA', contraparteDocCod: '6702' });
        expect(viva?.contraparteTitulos).toEqual([{ titCod: '1', valor: 10, pago: true }]);

        await pool.withTransaction((tx) =>
            repo.resolver(
                {
                    alerta: viva as never,
                    resolucao: 'JUSTIFICADA',
                    justificativa: 'NF de serviço',
                    ator: 'ana',
                },
                tx,
            ),
        );
        const [resolvida] = await repo.listVivasDosLotes([LOTE]);
        expect(resolvida).toMatchObject({ estado: 'RESOLVIDA', justificativa: 'NF de serviço' });
        expect(await repo.fechar(resolvida as never, 'OBSOLETA', 'sistema')).toBe(true);
        expect(await repo.listVivasDosLotes([LOTE])).toEqual([]);
        expect(await contarEventos('ALERTA_CRIADA')).toBe(1);
        expect(await contarEventos('ALERTA_JUSTIFICADA')).toBe(1);
        expect(await contarEventos('ALERTA_OBSOLETA')).toBe(1);
    });

    it('lote: verificação do item, remoção pelo sistema, conferir e devolver', async () => {
        const repo = new LotePagamentoRepository(pool, eventos);
        await repo.marcarVerificacaoItem({
            loteId: LOTE,
            ...CHAVE,
            estado: 'OK',
            destinoOrigem: 'CADASTRO',
            destinoMascarado: '341 / ****-5',
        });
        await repo.marcarVerificacaoItem({ loteId: LOTE, ...CHAVE, estado: 'PENDENTE' });
        let lote = await repo.getLoteComItens(LOTE);
        // PENDENTE não apaga o destino visto antes.
        expect(lote?.itens.find((i) => i.docCod === '6173')).toMatchObject({
            verificacaoEstado: 'PENDENTE',
            destinoOrigem: 'CADASTRO',
            destinoMascarado: '341 / ****-5',
        });

        const versaoAntes = lote?.versao ?? 0;
        const removido = await pool.withTransaction((tx) =>
            repo.removerItemPeloSistema(
                { loteId: LOTE, filCod: 4, docCod: '6174', titCod: '1' },
                tx,
            ),
        );
        expect(removido).toBe(true);
        lote = await repo.getLoteComItens(LOTE);
        expect(lote?.itens.map((i) => i.docCod)).toEqual(['6173']);
        expect(lote?.versao).toBe(versaoAntes + 1);
        expect(await contarEventos('ITEM_REMOVIDO_SISTEMA')).toBe(1);

        const v = lote?.versao ?? 0;
        expect(
            await repo.transicionarStatus({
                id: LOTE,
                de: ['RASCUNHO'],
                para: 'FINALIZADO',
                versaoEsperada: v,
                finalizadoPor: 'ana',
            }),
        ).toBe(1);
        expect(await repo.conferir({ loteId: LOTE, versaoEsperada: v + 1, ator: 'bia' })).toBe(1);
        // Já conferido: segunda conferência não pega.
        expect(await repo.conferir({ loteId: LOTE, versaoEsperada: v + 2, ator: 'caio' })).toBe(0);
        lote = await repo.getLoteComItens(LOTE);
        expect(lote).toMatchObject({ status: 'FINALIZADO', conferidoPor: 'bia' });

        expect(
            await repo.devolver({
                loteId: LOTE,
                versaoEsperada: v + 2,
                ator: 'bia',
                motivo: 'confira a conta',
            }),
        ).toBe(1);
        lote = await repo.getLoteComItens(LOTE);
        expect(lote).toMatchObject({
            status: 'RASCUNHO',
            devolvidoPor: 'bia',
            motivoDevolucao: 'confira a conta',
        });
        expect(lote?.conferidoPor).toBeUndefined();
        expect(lote?.finalizadoPor).toBeUndefined();

        // Finalizar de novo apaga o motivo da devolução; reabrir limpa a conferência.
        await repo.transicionarStatus({
            id: LOTE,
            de: ['RASCUNHO'],
            para: 'FINALIZADO',
            versaoEsperada: v + 3,
            finalizadoPor: 'ana',
        });
        await repo.conferir({ loteId: LOTE, versaoEsperada: v + 4, ator: 'bia' });
        await repo.transicionarStatus({
            id: LOTE,
            de: ['FINALIZADO'],
            para: 'RASCUNHO',
            versaoEsperada: v + 5,
        });
        lote = await repo.getLoteComItens(LOTE);
        expect(lote?.conferidoPor).toBeUndefined();
        expect(lote?.motivoDevolucao).toBeUndefined();
    });

    it('bloqueio: criar (idempotente por título), formação ignora o título, ingestão encerra', async () => {
        const repo = new BloqueioDuplicidadeRepository(pool, eventos);
        await db.query(
            `INSERT INTO titulo_a_pagar (fil_cod, doc_cod, tit_cod, valor, vencimento, aprovado, pago, ativo)
             VALUES (4, '6702', '1', 10, now() + interval '2 days', TRUE, FALSE, TRUE)`,
        );
        const chave = { filCod: 4, docCod: '6702', titCod: '1' };
        const id1 = await pool.withTransaction((tx) =>
            repo.criar(
                { chave, alertaId: LOTE, loteIdOrigem: LOTE, motivo: 'duplicata', ator: 'ana' },
                tx,
            ),
        );
        const id2 = await pool.withTransaction((tx) =>
            repo.criar(
                { chave, alertaId: LOTE, loteIdOrigem: LOTE, motivo: 'de novo', ator: 'ana' },
                tx,
            ),
        );
        expect(id2).toBe(id1);
        expect(await contarEventos('BLOQUEIO_CRIADO')).toBe(1);

        const elegiveis = await new TituloAPagarRepository(pool).listElegiveisParaFormacao(7);
        expect(elegiveis.map((t) => t.docCod)).not.toContain('6702');

        await db.query(`UPDATE titulo_a_pagar SET ativo = FALSE WHERE doc_cod = '6702'`);
        expect(await repo.encerrarDeTitulosInativos()).toBe(1);
        expect(await repo.findAtivo(chave)).toBeNull();
        expect(await contarEventos('BLOQUEIO_ENCERRADO')).toBe(1);
        expect(await repo.desfazer({ chave, motivo: 'x', ator: 'ana' })).toBeNull();
    });

    it('pendência: abrir, acrescentar origem sem duplicar, resolver só pelo sistema', async () => {
        const repo = new PendenciaCadastroRepository(pool, eventos);
        const base = {
            pesCod: '90001',
            filCod: 4,
            tipo: 'CONTA' as const,
            loteId: LOTE,
            desfecho: 'RETIRADO' as const,
        };
        const a = await repo.abrirOuAcrescentar({ ...base, chave: CHAVE });
        const b = await repo.abrirOuAcrescentar({ ...base, chave: CHAVE });
        const c = await repo.abrirOuAcrescentar({
            ...base,
            chave: { filCod: 4, docCod: '7000', titCod: '1' },
        });
        expect(a.aberta).toBe(true);
        expect(b).toEqual({ pendenciaId: a.pendenciaId, aberta: false });
        expect(c.pendenciaId).toBe(a.pendenciaId);
        const [aberta] = await repo.listAbertas();
        expect(aberta?.origens.map((o) => o.docCod)).toEqual(['6173', '7000']);
        expect(await contarEventos('PENDENCIA_ABERTA')).toBe(1);
        expect(await contarEventos('PENDENCIA_ORIGEM_ACRESCENTADA')).toBe(1);
        expect(await repo.resolverDoFavorecido('90001', 'CONTA')).toBe(1);
        expect(await repo.listAbertas()).toEqual([]);
        // Ocorrência nova depois de resolvida abre outra pendência.
        expect((await repo.abrirOuAcrescentar({ ...base, chave: CHAVE })).aberta).toBe(true);
    });

    it('perfil: upsert da rodada substitui só o recalculado', async () => {
        const repo = new PerfilCanalFornecedorRepository(pool);
        const perfil = {
            pesCod: '90001',
            credor: 'F',
            contagens: { BOLETO: 5, TED_PIX: 0, OUTROS: 0 },
            pagamentosUnicos: 5,
            mesesDistintos: 3,
            grupoDominante: 'BOLETO' as const,
            participacao: 1,
            confianca: 'ALTA' as const,
            janelaInicio: Date.UTC(2025, 0, 1),
            janelaFim: Date.UTC(2026, 9, 1),
        };
        await repo.upsertRodada([perfil, { ...perfil, pesCod: '2' }], 'run-1');
        await repo.upsertRodada([{ ...perfil, confianca: 'MEDIA', participacao: 0.9 }], 'run-2');
        expect(await repo.findByPesCod('90001')).toMatchObject({
            confianca: 'MEDIA',
            participacao: 0.9,
            jobRunId: 'run-2',
        });
        expect(await repo.findByPesCod('2')).toMatchObject({ jobRunId: 'run-1' });
    });
});

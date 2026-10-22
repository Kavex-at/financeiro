import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'reflect-metadata';
import PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import type { RechaveamentoInput } from '../../interface/sispag/AjusteCentavos.js';
import type { EtapaAjuste } from '../../libs/boleto/EtapaAjusteCentavos.js';
import AjusteCentavosExecucaoRepository from './AjusteCentavosExecucaoRepository.js';
import BloqueioDuplicidadeRepository from './BloqueioDuplicidadeRepository.js';
import LotePagamentoRepository from './LotePagamentoRepository.js';
import SugestaoBoletoRepository from './SugestaoBoletoRepository.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';
import VerificacaoEventoRepository from './VerificacaoEventoRepository.js';

/**
 * Ledger do ajuste de centavos e rechaveamento (ADR-0074, I18h/I18j) contra um Postgres DE
 * VERDADE. Roda no `npm run test:sql` com DSN LOCAL (apaga e recria `sispag_ajuste_repo_it`).
 */

jest.setTimeout(120_000);

const ADMIN_DSN = process.env.METRICAS_CICLO_TEST_DSN;
if (process.env.CI === 'true' && !ADMIN_DSN) {
    throw new Error(
        'METRICAS_CICLO_TEST_DSN ausente no CI — o job backend-sql não pode passar sem banco',
    );
}
const BANCO = 'sispag_ajuste_repo_it';
const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'migrations');
const PAR = '00000000-0000-0000-0000-00000000aa01';
const LOTE_RASCUNHO = '00000000-0000-0000-0000-00000000aa11';
const LOTE_FINALIZADO = '00000000-0000-0000-0000-00000000aa12';
const MASCARA = '34191…9000';
const VENC = Date.UTC(2026, 9, 30);

const dsnPara = (dsn: string, banco: string): string => {
    const url = new URL(dsn);
    url.pathname = `/${banco}`;
    return url.toString();
};

const describeComBanco = ADMIN_DSN ? describe : describe.skip;

describeComBanco('ledger do ajuste de centavos e rechaveamento (integração)', () => {
    let db: Client;
    let pool: PostgreeDatabaseClient;
    let repo: AjusteCentavosExecucaoRepository;
    let lotes: LotePagamentoRepository;

    const decisao = async (n: number, doc: string, tit: string, ddc: number): Promise<string> => {
        const id = `00000000-0000-0000-0000-0000000${String(n).padStart(5, '0')}`;
        await db.query(
            `INSERT INTO sispag_decisao_sugestao_boleto
                (id, fil_cod, doc_cod, tit_cod, pes_cod, ddc_cod, dit_cod, codbar_mascarado,
                 valor_titulo, vencimento_titulo, valor_boleto, vencimento_boleto, delta_valor,
                 delta_percentual, delta_dias, tier, emissor_chave, decisao, decidido_por,
                 decidido_em, confirmacao_emissor_id)
             VALUES ($1, 2, $2, $3, '7001', $4, 1, $5, 462.49, '2026-10-30', 462.50,
                     '2026-10-30', 0.01, 0, 0, 'CONHECIDO', '341:1:1', 'CONFIRMADA', 'ana',
                     '2026-10-19T10:00:00Z', $6)`,
            [id, doc, tit, ddc, MASCARA, PAR],
        );
        return id;
    };

    const carteira = (doc: string, tit: string) =>
        db.query(
            `INSERT INTO titulo_a_pagar (fil_cod, doc_cod, tit_cod, credor, pes_cod, valor,
                vencimento, aprovado, pago, banco, tem_boleto, doc_esp_numero)
             VALUES (2, $1, $2, 'NELSON', '7001', 462.49, $3, TRUE, FALSE, '341', FALSE, '12294')`,
            [doc, tit, new Date(VENC)],
        );

    const item = (lote: string, doc: string, tit: string) =>
        db.query(
            `INSERT INTO lote_pagamento_item
                (lote_id, fil_cod, doc_cod, tit_cod, incluido_por, modalidade, valor, vencimento,
                 credor)
             VALUES ($1, 2, $2, $3, 'ana', 'BOLETO', 462.49, '2026-10-30', 'NELSON')`,
            [lote, doc, tit],
        );

    const rechaveamento = (
        exec: string,
        decisaoId: string,
        doc: string,
        etapaAtual: EtapaAjuste = 'liberada',
    ): RechaveamentoInput => ({
        execucaoId: exec,
        etapaAtual,
        filCod: 2,
        docCod: doc,
        titCodAntigo: '1',
        titCodNovo: '2',
        frnCod: 3,
        decisaoId,
        tituloNovo: {
            valorBase: 462.49,
            valorLiquido: 462.5,
            vencimentoEpoch: VENC,
            aprovado: true,
        },
    });

    /** Abre e leva um ledger até `etapa` pelos caminhos válidos da máquina. */
    const ledgerEm = async (doc: string, decisaoId: string, etapa: 'liberada' | 'finalizada') => {
        const { execucao } = await repo.abrir({
            filCod: 2,
            docCod: doc,
            titCodOrigem: '1',
            decisaoId,
            codigoMascarado: MASCARA,
        });
        const passos = [
            'renegociacao_criada',
            'titulo_incluido',
            'composicao_gravada',
            'ajuste_aplicado',
            'finalizada',
            ...(etapa === 'liberada' ? ['liberada'] : []),
        ] as EtapaAjuste[];
        let de: EtapaAjuste = 'pendente';
        for (const para of passos) {
            expect(
                await repo.registrarResultado(execucao.id, de, para, {
                    ...(para === 'renegociacao_criada' ? { frnCod: 3 } : {}),
                    ...(para === 'finalizada' ? { titCodNovo: '2' } : {}),
                }),
            ).toBe(true);
            de = para;
        }
        return execucao.id;
    };

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
            `INSERT INTO lote_pagamento (id, fil_cod, status, criado_por, conta)
             VALUES ($1, 2, 'RASCUNHO', 'ana', '55795-4'), ($2, 2, 'FINALIZADO', 'ana', '55795-4')`,
            [LOTE_RASCUNHO, LOTE_FINALIZADO],
        );
        const env = {
            getEnvironmentVars: async () => ({ databaseConnectionString: dsnBanco }),
        } as unknown as EnvironmentProvider;
        pool = new PostgreeDatabaseClient(env);
        const eventos = new VerificacaoEventoRepository(pool);
        const bloqueios = new BloqueioDuplicidadeRepository(pool, eventos);
        lotes = new LotePagamentoRepository(pool, eventos, bloqueios);
        repo = new AjusteCentavosExecucaoRepository(
            pool,
            new SugestaoBoletoRepository(pool),
            new TituloAPagarRepository(pool),
            lotes,
        );
    });

    afterAll(async () => {
        await pool?.close();
        await db?.end();
    });

    it('abrir é idempotente por (título, decisão) e grava identidade e máscara', async () => {
        const d = await decisao(1, '100', '1', 100);
        const a = await repo.abrir({
            filCod: 2,
            docCod: '100',
            titCodOrigem: '1',
            decisaoId: d,
            codigoMascarado: MASCARA,
            conexosUsername: 'MPS_FRANCINEI',
            conexosUsnCod: '77',
        });
        expect(a.criado).toBe(true);
        expect(a.execucao).toMatchObject({
            etapa: 'pendente',
            conexosUsername: 'MPS_FRANCINEI',
            conexosUsnCod: '77',
            codigoMascarado: MASCARA,
        });
        expect(a.execucao.marcador).toMatch(/^AJC-[0-9A-F]{12}$/);
        const b = await repo.abrir({ filCod: 2, docCod: '100', titCodOrigem: '1', decisaoId: d });
        expect(b).toMatchObject({ criado: false, execucao: { id: a.execucao.id } });
    });

    it('outro ledger NÃO terminal do mesmo título devolve o existente (nunca dois)', async () => {
        const d1 = await decisao(2, '101', '1', 101);
        const d2 = await decisao(3, '101', '9', 102);
        const a = await repo.abrir({ filCod: 2, docCod: '101', titCodOrigem: '1', decisaoId: d1 });
        const b = await repo.abrir({ filCod: 2, docCod: '101', titCodOrigem: '1', decisaoId: d2 });
        expect(b).toMatchObject({ criado: false, execucao: { id: a.execucao.id } });
        const { rows } = await db.query(
            `SELECT count(*)::int AS n FROM sispag_ajuste_centavos_execucao WHERE doc_cod = '101'`,
        );
        expect(rows[0].n).toBe(1);
    });

    it('registrarResultado: lock otimista pela etapa de origem; transição inválida lança', async () => {
        const d = await decisao(4, '102', '1', 103);
        const { execucao } = await repo.abrir({
            filCod: 2,
            docCod: '102',
            titCodOrigem: '1',
            decisaoId: d,
        });
        expect(
            await repo.registrarResultado(execucao.id, 'pendente', 'renegociacao_criada', {
                frnCod: 9,
            }),
        ).toBe(true);
        // segundo processo com a leitura velha: não avança
        expect(await repo.registrarResultado(execucao.id, 'pendente', 'renegociacao_criada')).toBe(
            false,
        );
        await expect(
            repo.registrarResultado(execucao.id, 'renegociacao_criada', 'concluido'),
        ).rejects.toThrow(/transição inválida/);
        expect(await repo.buscarPorId(execucao.id)).toMatchObject({
            etapa: 'renegociacao_criada',
            frnCod: 9,
        });
        expect(await repo.listarNaoTerminais(2)).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: execucao.id })]),
        );
    });

    it('rechavear: decisão transferida (autor herdado), carteira, item RASCUNHO; FINALIZADO e par intactos', async () => {
        const d = await decisao(5, '536', '1', 536);
        await carteira('536', '1');
        await item(LOTE_RASCUNHO, '536', '1');
        await item(LOTE_FINALIZADO, '536', '1');
        const versaoAntes = (
            await db.query('SELECT versao FROM lote_pagamento WHERE id = $1', [LOTE_RASCUNHO])
        ).rows[0].versao;
        const exec = await ledgerEm('536', d, 'liberada');

        const r = await repo.rechavear(rechaveamento(exec, d, '536'));
        expect(r.decisaoTransferida).toBe(true);
        expect(r.lotesTocados).toEqual([LOTE_RASCUNHO]);

        const decisoes = (
            await db.query(
                `SELECT id, tit_cod, decisao, anulada_por, tipo_anulacao, decidido_por, decidido_em,
                        origem_decisao_id, transferida_por, confirmacao_emissor_id, motivo_anulacao
                   FROM sispag_decisao_sugestao_boleto WHERE doc_cod = '536' ORDER BY tit_cod`,
            )
        ).rows;
        expect(decisoes[0]).toMatchObject({
            tit_cod: '1',
            decisao: 'ANULADA',
            anulada_por: 'sistema',
            tipo_anulacao: 'TITULO_RENEGOCIADO',
        });
        expect(decisoes[0].motivo_anulacao).toMatch(/536\/1 → 536\/2, frnCod 3/);
        expect(decisoes[1]).toMatchObject({
            tit_cod: '2',
            decisao: 'CONFIRMADA',
            decidido_por: 'ana',
            origem_decisao_id: d,
            transferida_por: 'sistema',
            confirmacao_emissor_id: PAR,
        });
        expect(new Date(decisoes[1].decidido_em).toISOString()).toBe('2026-10-19T10:00:00.000Z');

        const eventos = (
            await db.query(
                `SELECT tipo FROM sispag_sugestao_boleto_evento WHERE doc_cod = '536' ORDER BY tipo`,
            )
        ).rows.map((x) => x.tipo);
        expect(eventos).toEqual(['DECISAO_TRANSFERIDA', 'TITULO_RENEGOCIADO']);

        const titulos = (
            await db.query(
                `SELECT tit_cod, ativo, valor, credor FROM titulo_a_pagar WHERE doc_cod = '536'
                  ORDER BY tit_cod`,
            )
        ).rows;
        expect(titulos).toEqual([
            { tit_cod: '1', ativo: false, valor: '462.49', credor: 'NELSON' },
            { tit_cod: '2', ativo: true, valor: '462.49', credor: 'NELSON' },
        ]);

        const itens = (
            await db.query(
                `SELECT lote_id, tit_cod, valor FROM lote_pagamento_item WHERE doc_cod = '536'
                  ORDER BY lote_id`,
            )
        ).rows;
        expect(itens).toEqual([
            { lote_id: LOTE_RASCUNHO, tit_cod: '2', valor: '462.5' },
            { lote_id: LOTE_FINALIZADO, tit_cod: '1', valor: '462.49' },
        ]);
        const versaoDepois = (
            await db.query('SELECT versao FROM lote_pagamento WHERE id = $1', [LOTE_RASCUNHO])
        ).rows[0].versao;
        expect(versaoDepois).toBe(versaoAntes + 1);
        const trilhaLote = (
            await db.query(
                `SELECT evento, dados FROM sispag_verificacao_evento WHERE doc_cod = '536'`,
            )
        ).rows;
        expect(trilhaLote).toEqual([
            {
                evento: 'ITEM_TITULO_RENEGOCIADO',
                dados: expect.objectContaining({ titCodAntigo: '1', titCodNovo: '2' }),
            },
        ]);
        const par = (await db.query('SELECT estado, versao FROM sispag_confirmacao_emissor_boleto'))
            .rows;
        expect(par).toEqual([{ estado: 'VIGENTE', versao: 1 }]);
        expect(await repo.buscarPorId(exec)).toMatchObject({ etapa: 'rechaveada' });
        expect(
            await repo.buscarConcluidoPorTitCodNovo({ filCod: 2, docCod: '536', titCod: '2' }),
        ).toMatchObject({ id: exec });
        expect(await lotes.tituloEmLoteFechado({ filCod: 2, docCod: '536', titCod: '1' })).toBe(
            true,
        );
    });

    it('decisão anulada pela analista antes do rechaveamento: carteira/item seguem, decisão não', async () => {
        const d = await decisao(6, '540', '1', 540);
        await carteira('540', '1');
        await item(LOTE_RASCUNHO, '540', '1');
        const exec = await ledgerEm('540', d, 'finalizada');
        await db.query(
            `UPDATE sispag_decisao_sugestao_boleto SET decisao = 'ANULADA', anulada_por = 'bia',
                    anulada_em = now(), motivo_anulacao = 'mudou de ideia' WHERE id = $1`,
            [d],
        );
        const r = await repo.rechavear(rechaveamento(exec, d, '540', 'finalizada'));
        expect(r.decisaoTransferida).toBe(false);
        const novas = (
            await db.query(
                `SELECT count(*)::int AS n FROM sispag_decisao_sugestao_boleto
                  WHERE doc_cod = '540' AND tit_cod = '2'`,
            )
        ).rows[0].n;
        expect(novas).toBe(0);
        const itemNovo = (
            await db.query(`SELECT tit_cod FROM lote_pagamento_item WHERE doc_cod = '540'`)
        ).rows;
        expect(itemNovo).toEqual([{ tit_cod: '2' }]);
    });

    it('falha injetada no passo (5) desfaz (1)–(4): rollback integral', async () => {
        const d = await decisao(7, '550', '1', 550);
        await carteira('550', '1');
        await item(LOTE_RASCUNHO, '550', '1');
        const exec = await ledgerEm('550', d, 'liberada');
        const spy = jest
            .spyOn(lotes, 'trocarTituloDoItemEmRascunho')
            .mockRejectedValueOnce(new Error('falha injetada'));
        await expect(repo.rechavear(rechaveamento(exec, d, '550'))).rejects.toThrow(
            'falha injetada',
        );
        spy.mockRestore();
        const decisaoAntiga = (
            await db.query('SELECT decisao FROM sispag_decisao_sugestao_boleto WHERE id = $1', [d])
        ).rows[0].decisao;
        expect(decisaoAntiga).toBe('CONFIRMADA');
        const titulos = (
            await db.query(
                `SELECT tit_cod, ativo FROM titulo_a_pagar WHERE doc_cod = '550' ORDER BY tit_cod`,
            )
        ).rows;
        expect(titulos).toEqual([{ tit_cod: '1', ativo: true }]);
        const eventos = (
            await db.query(
                `SELECT count(*)::int AS n FROM sispag_sugestao_boleto_evento WHERE doc_cod = '550'`,
            )
        ).rows[0].n;
        expect(eventos).toBe(0);
        expect(await repo.buscarPorId(exec)).toMatchObject({ etapa: 'liberada' });
    });

    it('finalizarLote: títulos do lote com ajuste NÃO terminal', async () => {
        const d = await decisao(8, '560', '1', 560);
        await item(LOTE_RASCUNHO, '560', '1');
        await repo.abrir({ filCod: 2, docCod: '560', titCodOrigem: '1', decisaoId: d });
        const emCurso = await lotes.titulosComAjusteNaoTerminalNoLote(LOTE_RASCUNHO);
        expect(emCurso).toEqual(expect.arrayContaining([{ docCod: '560', titCod: '1' }]));
    });

    it('prontidão (ADR-0076): a consulta por VÁRIOS lotes devolve o mesmo que a do finalizar', async () => {
        const d = await decisao(9, '570', '1', 570);
        await item(LOTE_RASCUNHO, '570', '1');
        await repo.abrir({ filCod: 2, docCod: '570', titCodOrigem: '1', decisaoId: d });
        const doFinalizar = await lotes.titulosComAjusteNaoTerminalNoLote(LOTE_RASCUNHO);
        const daListagem = await lotes.titulosComAjusteNaoTerminalNosLotes([
            LOTE_RASCUNHO,
            LOTE_FINALIZADO,
        ]);
        expect(
            daListagem
                .filter((r) => r.loteId === LOTE_RASCUNHO)
                .map(({ docCod, titCod }) => ({ docCod, titCod }))
                .sort((a, b) => a.docCod.localeCompare(b.docCod)),
        ).toEqual(doFinalizar);
        expect(daListagem.every((r) => r.filCod === 2)).toBe(true);
        expect(await lotes.titulosComAjusteNaoTerminalNosLotes([])).toEqual([]);
    });
});

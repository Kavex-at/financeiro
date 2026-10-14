import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import TituloAPagarRepository from './TituloAPagarRepository.js';

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 500,
    liberado: true,
    pago: false,
    vencimento: 1_760_000_000_000,
    ...over,
});

/** Dia civil de Brasília codificado como o ERP (00:00Z). */
const HOJE = new Date('2026-10-14T00:00:00Z');

const buildDb = () => {
    const tx = { insert: jest.fn().mockResolvedValue(1) };
    return {
        tx,
        client: {
            withTransaction: jest.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)),
            update: jest.fn().mockResolvedValue(0),
            selectMany: jest.fn().mockResolvedValue([]),
        } as unknown as PostgreeDatabaseClient,
    };
};

describe('TituloAPagarRepository', () => {
    it('upsertMany faz INSERT ... ON CONFLICT num chunk', async () => {
        const { client, tx } = buildDb();
        await new TituloAPagarRepository(client).upsertMany(
            [titulo(), titulo({ titCod: '2' })],
            'RUN1',
        );
        expect(tx.insert).toHaveBeenCalledTimes(1);
        const [sql, params] = tx.insert.mock.calls[0];
        expect(sql).toContain('ON CONFLICT (fil_cod, doc_cod, tit_cod) DO UPDATE');
        expect(params).toMatchObject({ runId: 'RUN1', f0: 2, d0: '100', t1: '2' });
    });

    it('upsertMany PRESERVA tem_boleto quando o flag é indefinido e o grava quando é conhecido', async () => {
        const { client, tx } = buildDb();
        await new TituloAPagarRepository(client).upsertMany(
            [titulo({ titCod: '1', temBoleto: true }), titulo({ titCod: '2' })],
            'RUN1',
        );
        // Dois INSERTs: o do flag conhecido grava tem_boleto; o do desconhecido não o toca.
        expect(tx.insert).toHaveBeenCalledTimes(2);
        const [conhecido, desconhecido] = tx.insert.mock.calls.map((c: [string]) => c[0]);
        expect(conhecido).toContain('tem_boleto = EXCLUDED.tem_boleto');
        expect(desconhecido).not.toContain('tem_boleto = EXCLUDED.tem_boleto');
    });

    it('upsertMany grava forma_pagamento_conexos e PRESERVA a última quando vem indefinida', async () => {
        const { client, tx } = buildDb();
        await new TituloAPagarRepository(client).upsertMany(
            [titulo({ titCod: '1', formaPagamentoConexos: 6 }), titulo({ titCod: '2' })],
            'RUN1',
        );
        const [sql, params] = tx.insert.mock.calls[0];
        expect(params).toMatchObject({ fp0: 6, fp1: null });
        // NULL (título fora do grid / leitura falhou) não apaga o que a última leitura gravou.
        expect(sql).toMatch(
            /forma_pagamento_conexos = COALESCE\(\s*EXCLUDED\.forma_pagamento_conexos, titulo_a_pagar\.forma_pagamento_conexos\s*\)/,
        );
    });

    it('upsertMany grava doc_esp_numero (número do documento do fornecedor) e PRESERVA o último', async () => {
        const { client, tx } = buildDb();
        await new TituloAPagarRepository(client).upsertMany(
            [titulo({ titCod: '1', numeroDocumento: '3501' }), titulo({ titCod: '2' })],
            'RUN1',
        );
        const [sql, params] = tx.insert.mock.calls[0];
        expect(params).toMatchObject({ dn0: '3501', dn1: null });
        expect(sql).toMatch(
            /doc_esp_numero = COALESCE\(EXCLUDED\.doc_esp_numero, titulo_a_pagar\.doc_esp_numero\)/,
        );
    });

    it('upsertMany com lista vazia não abre transação', async () => {
        const { client } = buildDb();
        await new TituloAPagarRepository(client).upsertMany([], 'RUN1');
        expect(client.withTransaction as jest.Mock).not.toHaveBeenCalled();
    });

    it('marcarInativosForaDaRun inativa só nas filiais lidas e devolve a contagem', async () => {
        const { client } = buildDb();
        (client.update as jest.Mock).mockResolvedValue(4);
        const n = await new TituloAPagarRepository(client).marcarInativosForaDaRun('RUN1', [2, 4]);
        expect(n).toBe(4);
        const [sql, params] = (client.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('ativo = FALSE');
        expect(sql).toContain('fil_cod = ANY($filCodsLidas)');
        expect(params).toMatchObject({ runId: 'RUN1', filCodsLidas: [2, 4] });
    });

    it('marcarInativosForaDaRun não inativa nada se NENHUMA filial foi lida (fault-tolerance)', async () => {
        const { client } = buildDb();
        const n = await new TituloAPagarRepository(client).marcarInativosForaDaRun('RUN1', []);
        expect(n).toBe(0);
        expect(client.update as jest.Mock).not.toHaveBeenCalled();
    });

    it('listAtivos mapeia as linhas (valor numérico, vencimento epoch, ativo)', async () => {
        const { client } = buildDb();
        (client.selectMany as jest.Mock).mockResolvedValue([
            {
                fil_cod: 2,
                doc_cod: '100',
                tit_cod: '1',
                credor: 'ACME',
                pes_cod: '9',
                valor: '500.5',
                moeda: 'BRL',
                vencimento: new Date('2026-08-01T00:00:00Z'),
                aprovado: true,
                pago: false,
                banco: 'ITAÚ',
                num_remessa: null,
                tpd_cod: null,
                pronto_para_remessa: true,
                forma_pagamento_conexos: 6,
                doc_esp_numero: '3501',
            },
        ]);
        const titulos = await new TituloAPagarRepository(client).listAtivos();
        expect(titulos[0]).toMatchObject({
            docCod: '100',
            valor: 500.5,
            liberado: true,
            prontoParaRemessa: true,
            formaPagamentoConexos: 6,
            numeroDocumento: '3501',
            ativo: true,
        });
        expect(typeof titulos[0].vencimento).toBe('number');
        const sql = (client.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(sql).toContain('forma_pagamento_conexos');
        // lido de volta: a coluna da 0083 só serve se o SELECT a traz
        expect(sql).toContain('doc_esp_numero');
    });

    it('listElegiveisParaFormacao exclui título em QUALQUER lote vivo, não só RASCUNHO (I3)', async () => {
        const { client } = buildDb();
        await new TituloAPagarRepository(client).listElegiveisParaFormacao(7, HOJE);
        const [sql, params] = (client.selectMany as jest.Mock).mock.calls[0];
        // Título de remessa já gerada voltava para um novo lote automático (caso 3143, 02/10).
        for (const status of ['RASCUNHO', 'FINALIZADO', 'REMESSA_GERADA', 'RETORNADO']) {
            expect(sql).toContain(`'${status}'`);
        }
        // CANCELADO libera o título; não pode entrar na lista de lotes que o seguram.
        expect(sql).not.toContain("'CANCELADO'");
        expect(params).toEqual({ hoje: HOJE, ate: new Date('2026-10-22T00:00:00Z') });
    });

    it('listElegiveisParaFormacao: janela por dia civil — hoje entra, hoje+7 entra, hoje+8 não', async () => {
        // `>= now()` deixava de fora o título que vence hoje (00:00Z < instante atual).
        const { client } = buildDb();
        await new TituloAPagarRepository(client).listElegiveisParaFormacao(7, HOJE);
        const [sql] = (client.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('t.vencimento >= $hoje');
        expect(sql).toContain('t.vencimento < $ate');
        expect(sql).not.toContain('now()');
    });

    it('listElegiveisParaFormacao deixa de fora título com bloqueio por duplicidade ATIVO (I13g)', async () => {
        const { client } = buildDb();
        await new TituloAPagarRepository(client).listElegiveisParaFormacao(7, HOJE);
        const [sql] = (client.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toMatch(
            /NOT EXISTS \(\s*SELECT 1 FROM titulo_bloqueio_duplicidade b\s+WHERE b\.estado = 'ATIVO'/,
        );
        expect(sql).toMatch(/b\.fil_cod = t\.fil_cod AND b\.doc_cod = t\.doc_cod/);
    });

    it('buscarPorChave: parametrizado, devolve o título com a marca ativo e null quando não existe', async () => {
        const selectFirst = jest
            .fn()
            .mockResolvedValueOnce({
                fil_cod: 2,
                doc_cod: '100',
                tit_cod: '1',
                credor: null,
                pes_cod: '7001',
                valor: '500.00',
                moeda: null,
                vencimento: null,
                aprovado: true,
                pago: false,
                banco: null,
                num_remessa: null,
                tpd_cod: null,
                pronto_para_remessa: null,
                tem_boleto: false,
                forma_pagamento_conexos: 6,
                doc_esp_numero: 'NF9',
                ativo: false,
            })
            .mockResolvedValueOnce(null);
        const client = { selectFirst } as unknown as PostgreeDatabaseClient;
        const repo = new TituloAPagarRepository(client);
        const chave = { filCod: 2, docCod: '100', titCod: '1' };
        const t = await repo.buscarPorChave(chave);
        expect(selectFirst.mock.calls[0][0]).toMatch(/fil_cod = \$filCod AND doc_cod = \$docCod/);
        expect(selectFirst.mock.calls[0][1]).toEqual(chave);
        expect(t).toMatchObject({
            pesCod: '7001',
            valor: 500,
            ativo: false,
            numeroDocumento: 'NF9',
        });
        expect(await repo.buscarPorChave(chave)).toBeNull();
    });
});

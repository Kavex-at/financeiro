import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import RemessaExecucaoRepository from './RemessaExecucaoRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as PostgreeDatabaseClient;

const BEGIN = {
    idempotencyKey: 'remessa:L1',
    loteId: 'L1',
    filCod: 2,
    bncCod: 4,
    executadoPor: 'yuri',
};

/**
 * Este ledger é a trava anti-duplicação da remessa: `criarLote`/`importarTitulos`/
 * `gerarRemessa` não são idempotentes, e um segundo lote é dinheiro saindo duas vezes.
 * Estava sem nenhum teste — a invariante "settled não regride" existia só no SQL.
 */
describe('RemessaExecucaoRepository', () => {
    describe('beginExecution', () => {
        it('escrita real entra como `reconciling` (write-ahead)', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });

            const r = await new RemessaExecucaoRepository(db).beginExecution({
                ...BEGIN,
                dryRun: false,
            });

            expect(r).toEqual({ status: 'reconciling', alreadySettled: false });
            const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
            expect(params).toMatchObject({ newStatus: 'reconciling', dryRun: false });
        });

        it('dry-run entra como `pending` — não há escrita a conciliar', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'pending' });

            const r = await new RemessaExecucaoRepository(db).beginExecution({
                ...BEGIN,
                dryRun: true,
            });

            expect(r.status).toBe('pending');
            const [, params] = (db.selectFirst as jest.Mock).mock.calls[0];
            expect(params).toMatchObject({ newStatus: 'pending', dryRun: true });
        });

        it('uma linha `settled` NÃO regride — é a trava anti-duplicação', async () => {
            // O UPSERT preserva `settled` no banco; o repositório precisa DEVOLVER isso,
            // senão o serviço acha que pode seguir e gera um segundo lote de pagamento.
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'settled' });

            const r = await new RemessaExecucaoRepository(db).beginExecution({
                ...BEGIN,
                dryRun: false,
            });

            expect(r).toEqual({ status: 'settled', alreadySettled: true });
        });

        it('o SQL preserva settled no ON CONFLICT', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({ status: 'reconciling' });
            await new RemessaExecucaoRepository(db).beginExecution({ ...BEGIN, dryRun: false });

            const [sql] = (db.selectFirst as jest.Mock).mock.calls[0];
            expect(sql).toContain('ON CONFLICT (idempotency_key) DO UPDATE');
            expect(sql).toContain("remessa_execucao.status = 'settled'");
            // Parametrizado (Rule #5) — nenhum valor interpolado na string.
            expect(sql).not.toMatch(/'\$\{/);
        });
    });

    describe('handles nativos', () => {
        it('setNativeFlpCod grava o flpCod e avança a etapa para `importar`', async () => {
            // Persistido ANTES do próximo POST: morrer aqui deixa a pista do lote órfão.
            const db = buildDb();
            await new RemessaExecucaoRepository(db).setNativeFlpCod('remessa:L1', 42);

            const [sql, params] = (db.update as jest.Mock).mock.calls[0];
            expect(sql).toContain("etapa = 'importar'");
            expect(params).toEqual({ key: 'remessa:L1', flpCod: 42 });
        });

        it('setEtapa move o marcador sem tocar em mais nada', async () => {
            const db = buildDb();
            await new RemessaExecucaoRepository(db).setEtapa('remessa:L1', 'gerar_remessa');

            const [sql, params] = (db.update as jest.Mock).mock.calls[0];
            expect(sql).toContain('SET etapa = $etapa');
            expect(params).toEqual({ key: 'remessa:L1', etapa: 'gerar_remessa' });
        });
    });

    describe('fechamento', () => {
        it('settle marca settled + etapa concluido', async () => {
            const db = buildDb();
            await new RemessaExecucaoRepository(db).settle('remessa:L1', { nativeGabCod: 16 });

            const [sql, params] = (db.update as jest.Mock).mock.calls[0];
            expect(sql).toContain("status = 'settled'");
            expect(sql).toContain("etapa = 'concluido'");
            expect(params).toMatchObject({ key: 'remessa:L1', gabCod: 16 });
        });

        it('fail registra o erro sem apagar os handles já gravados', async () => {
            const db = buildDb();
            await new RemessaExecucaoRepository(db).fail('remessa:L1', {
                mensagem: 'timeout no fin015',
            });

            const [sql, params] = (db.update as jest.Mock).mock.calls[0];
            expect(sql).toContain("status = 'error'");
            expect(sql).not.toContain('native_flp_cod = NULL');
            expect(params).toMatchObject({ mensagem: 'timeout no fin015' });
        });
    });

    describe('leitura', () => {
        it('findByIdempotencyKey mapeia snake_case → camelCase', async () => {
            const db = buildDb();
            (db.selectFirst as jest.Mock).mockResolvedValue({
                idempotency_key: 'remessa:L1',
                lote_id: 'L1',
                fil_cod: 2,
                bnc_cod: 4,
                status: 'reconciling',
                dry_run: false,
                native_flp_cod: 42,
                etapa: 'importar',
                criado_em: '2026-08-24T12:00:00.000Z',
            });

            const row = await new RemessaExecucaoRepository(db).findByIdempotencyKey('remessa:L1');

            expect(row).toMatchObject({
                idempotencyKey: 'remessa:L1',
                loteId: 'L1',
                filCod: 2,
                status: 'reconciling',
                dryRun: false,
                nativeFlpCod: 42,
                etapa: 'importar',
            });
        });

        it('findByIdempotencyKey devolve null quando não há execução', async () => {
            const db = buildDb();
            const row = await new RemessaExecucaoRepository(db).findByIdempotencyKey('nada');
            expect(row).toBeNull();
        });

        it('listByStatus filtra e limita — é como se acha o `reconciling` órfão', async () => {
            const db = buildDb();
            await new RemessaExecucaoRepository(db).listByStatus('reconciling', 20);

            const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];
            expect(sql).toContain('WHERE status = $status');
            expect(params).toEqual({ status: 'reconciling', limit: 20 });
        });
    });
});

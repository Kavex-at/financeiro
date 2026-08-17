import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import { NDE_STATUS_EMISSAO } from '../../interface/recebimentos/constants.js';
import type { NotaDebitoEletronica } from '../../interface/recebimentos/NotaDebitoEletronica.js';
import NdeRepository from './NdeRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildNde = (o: Partial<NotaDebitoEletronica> = {}): NotaDebitoEletronica => ({
    id: 'nde-1',
    recebimentoId: 'rec-1',
    filCod: 4,
    correlationId: 'corr-1',
    valor: 15000,
    moeda: 'BRL',
    statusEmissao: NDE_STATUS_EMISSAO.PENDENTE,
    idempotencyKey: 'nde:rec-1',
    ...o,
});

describe('NdeRepository', () => {
    it('save: UPSERT por idempotency_key (uma NDe por Recebimento), jsonb, parametrizado', async () => {
        const db = buildDb();
        await new NdeRepository(db).save(buildNde());
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO nota_debito_eletronica');
        expect(sql).toContain('ON CONFLICT (idempotency_key) DO UPDATE');
        expect(sql).toContain('$erpResponse::jsonb');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toMatchObject({ id: 'nde-1', idempotencyKey: 'nde:rec-1' });
    });

    it('findByRecebimentoId: mapeia camelCase; null quando ausente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'nde-1',
            recebimento_id: 'rec-1',
            fil_cod: 4,
            correlation_id: 'corr-1',
            valor: '15000',
            moeda: 'BRL',
            status_emissao: 'emitida',
            idempotency_key: 'nde:rec-1',
        });
        const row = await new NdeRepository(db).findByRecebimentoId('rec-1');
        expect(row).toMatchObject({
            id: 'nde-1',
            recebimentoId: 'rec-1',
            statusEmissao: 'emitida',
            idempotencyKey: 'nde:rec-1',
        });

        const db2 = buildDb();
        expect(await new NdeRepository(db2).findByRecebimentoId('nope')).toBeNull();
    });

    describe('listParaPainel', () => {
        const execRow = (o: Record<string, unknown> = {}) => ({
            idempotency_key: 'nde:txn-1:1',
            correlation_id: 'nde:txn-1:1',
            fil_cod: 4,
            txn_id: 'txn-1',
            valor: '15000',
            nd_doc_cod: '18337',
            etapa: 'homologado',
            exec_status: 'settled',
            ...o,
        });

        it('a execução é a fonte, a NDe é o LEFT JOIN — e dispensada/dry-run ficam de fora', async () => {
            const db = buildDb();
            await new NdeRepository(db).listParaPainel({ filCods: [4, 5], limit: 200 });
            const [sql, params] = (db.selectMany as jest.Mock).mock.calls[0];

            expect(sql).toContain('FROM solicitacao_numerario_execucao');
            expect(sql).toContain('LEFT JOIN nota_debito_eletronica');
            expect(sql).toContain('e.fil_cod = ANY($filCods)');
            // Dry-run não POSTa nada: um documento que não existe no ERP não é uma NDe.
            expect(sql).toContain('e.dry_run = false');
            // ADR-0031: dispensada é "não era devida", nunca "faltou emitir".
            expect(sql).toContain('COALESCE(e.nde_dispensada, false) = false');
            expect(sql).not.toMatch(/'\s*\+|\$\{/);
            expect(params).toMatchObject({ filCods: [4, 5], limit: 200 });
        });

        it('NDe gravada → status e número vêm dela', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([
                execRow({
                    nde_id: 'nde-1',
                    recebimento_id: 'txn-1',
                    numero_nde: '000123',
                    nde_valor: '15000',
                    moeda: 'BRL',
                    status_emissao: 'emitida',
                    emitida_em: '2026-08-05T12:00:00.000Z',
                    emitida_por: 'ana',
                    nde_autorizado: true,
                    revisao_humana: false,
                }),
            ]);
            const [row] = await new NdeRepository(db).listParaPainel({ filCods: [4], limit: 200 });

            expect(row).toMatchObject({
                id: 'nde-1',
                recebimentoId: 'txn-1',
                numeroNde: '000123',
                valor: 15000,
                statusEmissao: 'emitida',
                ndDocCod: 18337,
                etapa: 'homologado',
                ndeAutorizado: true,
            });
        });

        it('documento gerado no ERP mas cauda fiscal parada → pendente (é a NDe que não saiu)', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([
                execRow({ etapa: 'fiscal-done', exec_status: 'reconciling' }),
            ]);
            const [row] = await new NdeRepository(db).listParaPainel({ filCods: [4], limit: 200 });

            // Sem linha em `nota_debito_eletronica` o id local não existe — a identidade é a execução.
            expect(row).toMatchObject({
                id: 'exec:nde:txn-1:1',
                statusEmissao: 'pendente',
                etapa: 'fiscal-done',
                valor: 15000,
                ndDocCod: 18337,
            });
            expect(row?.numeroNde).toBeUndefined();
        });

        it('execução em erro sem NDe gravada → erro, com a mensagem do ERP', async () => {
            const db = buildDb();
            (db.selectMany as jest.Mock).mockResolvedValue([
                execRow({ exec_status: 'error', erro_mensagem: 'homologação recusada' }),
            ]);
            const [row] = await new NdeRepository(db).listParaPainel({ filCods: [4], limit: 200 });

            expect(row).toMatchObject({
                statusEmissao: 'erro',
                erroMensagem: 'homologação recusada',
            });
        });
    });

    it('contarPendentes: COUNT no banco, não na página — emitida+autorizada não conta', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({ total: 37 });
        const total = await new NdeRepository(db).contarPendentes({ filCods: [4] });
        const [sql] = (db.selectFirst as jest.Mock).mock.calls[0];

        expect(total).toBe(37);
        expect(sql).toContain('count(*)');
        // COALESCE no status: sem linha de NDe o campo é NULL, e `NULL = 'emitida'` é NULL — sem o
        // COALESCE, uma execução sem NDe sumiria do COUNT em vez de contar como pendente.
        expect(sql).toContain("COALESCE(n.status_emissao, '') = 'emitida'");
        expect(sql).toContain('COALESCE(e.nde_autorizado, false) = true');
    });

    it('updateNumeroNde: grava o número que só o SEFAZ conhece, parametrizado', async () => {
        const db = buildDb();
        await new NdeRepository(db).updateNumeroNde('nde:txn-1:1', '000123');
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];

        expect(sql).toContain('UPDATE nota_debito_eletronica');
        expect(sql).toContain('WHERE idempotency_key = $idempotencyKey');
        expect(sql).not.toMatch(/'\s*\+|\$\{/);
        expect(params).toEqual({ idempotencyKey: 'nde:txn-1:1', numeroNde: '000123' });
    });
});

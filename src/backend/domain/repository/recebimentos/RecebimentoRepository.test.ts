import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { TransactionClient } from '../../client/database/PostgreeDatabaseClient.js';
import {
    MATCH_CLASSIFICACAO,
    RECEBIMENTO_STATUS,
    REGRA_TIPO,
} from '../../interface/recebimentos/constants.js';
import type { Recebimento } from '../../interface/recebimentos/Recebimento.js';
import { RecebimentoVersionConflictError } from '../../interface/recebimentos/recebimentoTransitions.js';
import RecebimentoRepository from './RecebimentoRepository.js';

const buildTx = (rootRows: unknown[] = [{ versao: 1 }]) =>
    ({
        selectMany: jest.fn().mockResolvedValue(rootRows),
        selectFirst: jest.fn().mockResolvedValue(null),
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
    }) as unknown as jest.Mocked<TransactionClient>;

const buildDb = (tx: jest.Mocked<TransactionClient>) =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
        withTransaction: jest.fn(async (fn: (t: TransactionClient) => Promise<unknown>) => fn(tx)),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

const buildAggregate = (overrides: Partial<Recebimento> = {}): Recebimento => ({
    id: 'rec-1',
    correlationId: 'corr-1',
    transacaoBancariaId: 'txn-1',
    filCod: 4,
    classificacaoMatch: MATCH_CLASSIFICACAO.UNICA,
    status: RECEBIMENTO_STATUS.APROVADO,
    valorRecebido: 15000,
    valorAlocado: 15000,
    diferencaNaoAlocada: 0,
    regrasAplicadas: [],
    rateios: [
        {
            id: 'rat-1',
            recebimentoId: 'rec-1',
            documentoDocCod: 'DOC-1',
            documentoTitCod: 'TIT-1',
            filCod: 4,
            finalidade: 'principal',
            valorAlocado: 15000,
            moeda: 'BRL',
            incluidoPor: 'analista',
        },
    ],
    versao: 0,
    criadoPor: 'analista',
    criadoEm: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
});

describe('RecebimentoRepository — agregado completo + concorrência otimista', () => {
    it('save: persiste raiz + rateios + regras na MESMA transação e bumpa a versão (modifiability-1)', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        const repo = new RecebimentoRepository(db);

        const regra = {
            id: 'regra-1',
            tipo: REGRA_TIPO.ENCOMENDA,
            versao: 3,
            vigenteDe: new Date('2026-01-01T00:00:00Z'),
            parametros: { pct: 10 },
            explicacao: 'encomenda',
            ativo: true,
        };
        const saved = await repo.save(buildAggregate({ regrasAplicadas: [regra] }));

        // Uma única transação.
        expect(db.withTransaction).toHaveBeenCalledTimes(1);
        // Raiz: INSERT ... RETURNING versao com o bump.
        const rootSql = (tx.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(rootSql).toContain('INSERT INTO recebimento');
        expect(rootSql).toContain('RETURNING versao');
        expect((tx.selectMany as jest.Mock).mock.calls[0][1]).toMatchObject({ versao: 1 });
        // Filhos: rateio + regra aplicada inseridos.
        const inserts = (tx.insert as jest.Mock).mock.calls.map(([sql]) => sql as string);
        expect(inserts.some((s) => s.includes('INSERT INTO rateio_recebimento'))).toBe(true);
        expect(inserts.some((s) => s.includes('INSERT INTO recebimento_regra_aplicada'))).toBe(
            true,
        );
        // Filhos são reescritos (DELETE antes do INSERT).
        const deletes = (tx.update as jest.Mock).mock.calls.map(([sql]) => sql as string);
        expect(deletes.some((s) => s.includes('DELETE FROM rateio_recebimento'))).toBe(true);
        expect(deletes.some((s) => s.includes('DELETE FROM recebimento_regra_aplicada'))).toBe(
            true,
        );
        expect(saved.versao).toBe(1);
    });

    it('save: SQL parametrizado (sem interpolação) na raiz e nos filhos', async () => {
        const tx = buildTx();
        const repo = new RecebimentoRepository(buildDb(tx));
        await repo.save(buildAggregate());
        const rootSql = (tx.selectMany as jest.Mock).mock.calls[0][0] as string;
        const rateioSql = (tx.insert as jest.Mock).mock.calls[0][0] as string;
        expect(rootSql).not.toMatch(/'\s*\+|\$\{/);
        expect(rateioSql).not.toMatch(/'\s*\+|\$\{/);
    });

    it('save: com expectedVersao aplica WHERE versao = $expectedVersao (optimistic guard)', async () => {
        const tx = buildTx();
        const repo = new RecebimentoRepository(buildDb(tx));
        await repo.save(buildAggregate({ versao: 5 }), 5);
        const rootSql = (tx.selectMany as jest.Mock).mock.calls[0][0] as string;
        expect(rootSql).toContain('recebimento.versao = $expectedVersao');
        const params = (tx.selectMany as jest.Mock).mock.calls[0][1] as Record<string, unknown>;
        expect(params).toMatchObject({ expectedVersao: 5, versao: 6 });
    });

    it('save: escrita concorrente perdida (0 linhas) lança RecebimentoVersionConflictError (fault-tolerance-3)', async () => {
        const tx = buildTx([]); // RETURNING vazio = versão não bateu
        const repo = new RecebimentoRepository(buildDb(tx));
        await expect(repo.save(buildAggregate({ versao: 2 }), 2)).rejects.toBeInstanceOf(
            RecebimentoVersionConflictError,
        );
    });

    it('save: sem expectedVersao (semeadura) não exige RETURNING e não lança conflito', async () => {
        const tx = buildTx([]);
        const repo = new RecebimentoRepository(buildDb(tx));
        await expect(repo.save(buildAggregate())).resolves.toMatchObject({ versao: 1 });
    });

    it('findById: reidrata o agregado completo (raiz + rateios + regras) — child round-trip', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 'rec-1',
            correlation_id: 'corr-1',
            transacao_id: 'txn-1',
            fil_cod: 4,
            classificacao_match: 'unica',
            status: 'executado',
            valor_recebido: '15000',
            versao: 2,
            criado_por: 'analista',
            criado_em: '2026-07-01T00:00:00Z',
        });
        (db.selectMany as jest.Mock)
            .mockResolvedValueOnce([
                {
                    id: 'rat-1',
                    recebimento_id: 'rec-1',
                    doc_cod: 'DOC-1',
                    tit_cod: 'TIT-1',
                    fil_cod: 4,
                    finalidade: 'principal',
                    valor_alocado: '15000',
                    moeda: 'BRL',
                    incluido_por: 'analista',
                },
            ])
            .mockResolvedValueOnce([
                {
                    regra_id: 'regra-1',
                    tipo: 'ENCOMENDA',
                    versao: 3,
                    vigente_de: '2026-01-01T00:00:00Z',
                    parametros: { pct: 10 },
                    explicacao: 'encomenda',
                    ativo: true,
                },
            ]);

        const repo = new RecebimentoRepository(db);
        const loaded = await repo.findById('rec-1');

        expect(loaded).not.toBeNull();
        expect(loaded?.rateios).toHaveLength(1);
        expect(loaded?.rateios[0]).toMatchObject({ id: 'rat-1', valorAlocado: 15000 });
        expect(loaded?.regrasAplicadas).toHaveLength(1);
        expect(loaded?.regrasAplicadas[0]).toMatchObject({ id: 'regra-1', versao: 3 });
        // Derivados recompostos a partir dos rateios carregados.
        expect(loaded?.valorAlocado).toBe(15000);
        expect(loaded?.diferencaNaoAlocada).toBe(0);
    });

    it('save(r); findById(r.id) → rateios round-trip (modifiability-1 acceptance)', async () => {
        // Simula o banco em memória: save grava; findById devolve o que foi gravado.
        const rateioStore: Record<string, unknown>[] = [];
        const tx = {
            selectMany: jest.fn().mockResolvedValue([{ versao: 1 }]),
            selectFirst: jest.fn().mockResolvedValue(null),
            insert: jest.fn(async (sql: string, params: Record<string, unknown>) => {
                if (sql.includes('INSERT INTO rateio_recebimento')) rateioStore.push(params);
                return 1;
            }),
            update: jest.fn().mockResolvedValue(1),
        } as unknown as jest.Mocked<TransactionClient>;
        const db = buildDb(tx);
        const repo = new RecebimentoRepository(db);
        const agg = buildAggregate();
        await repo.save(agg);

        expect(rateioStore).toHaveLength(1);
        expect(rateioStore[0]).toMatchObject({ id: 'rat-1', valorAlocado: 15000, moeda: 'BRL' });
    });

    it('findById: null quando a raiz não existe', async () => {
        const tx = buildTx();
        const db = buildDb(tx);
        (db.selectFirst as jest.Mock).mockResolvedValue(null);
        expect(await new RecebimentoRepository(db).findById('nope')).toBeNull();
    });
});

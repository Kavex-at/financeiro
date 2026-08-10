import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosExtratoClient from '../../client/ConexosExtratoClient.js';
import type { LancamentoExtrato } from '../../client/ConexosExtratoClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import type BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { FANOUT_LIMIT_RECEBIMENTOS } from '../../interface/recebimentos/constants.js';
import type RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import type TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import type LogService from '../LogService.js';
import IngestaoTransacoesService from './IngestaoTransacoesService.js';

const lancamento = (over: Partial<LancamentoExtrato> = {}): LancamentoExtrato => ({
    extCod: '137',
    exiCodSeq: '128',
    gerNum: 38,
    dataLancamento: new Date('2026-07-01T15:00:00Z'),
    tipo: 'CREDITO',
    valor: 1000,
    historico: 'SISPAG ACME',
    conciliadoNoErp: false,
    raw: {},
    ...over,
});

/** `BoundedConcurrency` real o bastante: executa em série e devolve settled. */
const buildBounded = () => ({
    run: jest.fn(
        async (
            items: unknown[],
            worker: (i: unknown, n: number) => Promise<unknown>,
            _limite?: number,
        ) => {
            const out = [];
            for (let i = 0; i < items.length; i++) {
                try {
                    out.push({ status: 'fulfilled', value: await worker(items[i], i) });
                } catch (reason) {
                    out.push({ status: 'rejected', reason });
                }
            }
            return out;
        },
    ),
});

/** Piso de ingestão do go-live da Frente IV (ADR-0028), em UTC 00:00. */
const PISO_PADRAO = new Date('2026-08-03T00:00:00.000Z');

const build = (o: { contas?: unknown[]; lockLivre?: boolean; startDate?: Date } = {}) => {
    const extrato = {
        listContas: jest
            .fn()
            .mockResolvedValue(o.contas ?? [{ gerNum: 38, gerDes: 'ITAÚ', qtdeBanco: 27 }]),
        listLancamentos: jest.fn().mockResolvedValue([lancamento()]),
    } as unknown as jest.Mocked<ConexosExtratoClient>;

    const transacaoRepo = {
        upsertMany: jest.fn().mockResolvedValue({ inseridas: 1, deduplicadas: 0 }),
    } as unknown as jest.Mocked<TransacaoRepository>;

    const runRepo = {
        createRun: jest.fn().mockResolvedValue('run-1'),
        finishRun: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<RecebimentoIngestaoRunRepository>;

    const base = {
        getFiliais: jest.fn().mockResolvedValue([{ filCod: 1 }, { filCod: 2 }]),
    } as unknown as jest.Mocked<ConexosBaseClient>;

    const bounded = buildBounded();

    const db = {
        withAdvisoryLock: jest.fn(
            async (
                _k: number,
                onAcquired: () => Promise<unknown>,
                onBusy: () => Promise<unknown>,
            ) => ((o.lockLivre ?? true) ? onAcquired() : onBusy()),
        ),
    } as unknown as jest.Mocked<PostgreeDatabaseClient>;

    const environmentProvider = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            recebimentoIngestDias: 90,
            recebimentoIngestFilCods: [],
            recebimentoIngestStartDate: o.startDate ?? PISO_PADRAO,
        }),
    } as unknown as jest.Mocked<EnvironmentProvider>;

    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<LogService>;

    const service = new IngestaoTransacoesService(
        extrato,
        transacaoRepo,
        runRepo,
        base,
        bounded as unknown as BoundedConcurrency,
        db,
        environmentProvider,
        logService,
    );
    return { service, extrato, transacaoRepo, runRepo, base, bounded, db, environmentProvider };
};

const periodo = { de: new Date('2026-05-01T00:00:00Z'), ate: new Date('2026-07-30T00:00:00Z') };
const inputMany = { filCods: [1, 2], periodo, correlationId: 'corr-1', triggeredBy: 'cron' };

describe('IngestaoTransacoesService — advisory lock', () => {
    it('runMany toma o lock UMA vez para N filiais', async () => {
        // A armadilha que este teste fecha: se `runMany` delegasse para `run` por
        // filial, cada chamada abriria uma sessão nova, `pg_try_advisory_lock`
        // falharia e TODAS as filiais virariam 409.
        const { service, db } = build();
        await service.runMany(inputMany);
        expect(db.withAdvisoryLock).toHaveBeenCalledTimes(1);
    });

    it('lock ocupado → IngestLockBusyError (409)', async () => {
        const { service } = build({ lockLivre: false });
        await expect(service.runMany(inputMany)).rejects.toBeInstanceOf(IngestLockBusyError);
    });

    it('run de uma filial também é protegido pelo lock', async () => {
        const { service, db } = build();
        await service.run({ filCod: 1, periodo, correlationId: 'c', triggeredBy: 'manual' });
        expect(db.withAdvisoryLock).toHaveBeenCalledTimes(1);
    });
});

/**
 * Idempotência: rodar a sincronização duas vezes não pode duplicar transação.
 * A garantia REAL é a `UNIQUE (natural_key)` + `ON CONFLICT` do banco (migration
 * 0032); aqui se fixa a metade que vive no serviço — que ele propague honestamente
 * o que o repositório reportou, em vez de contar toda releitura como novidade.
 */
describe('IngestaoTransacoesService — idempotência', () => {
    it('segunda run da mesma janela reporta 0 inseridas e tudo deduplicado', async () => {
        const { service, transacaoRepo } = build();

        // 1ª run: toda linha é nova.
        (transacaoRepo.upsertMany as jest.Mock).mockResolvedValue({
            inseridas: 1,
            deduplicadas: 0,
        });
        const primeira = await service.runMany(inputMany);

        // 2ª run, mesma janela: o `ON CONFLICT (natural_key)` barra tudo.
        (transacaoRepo.upsertMany as jest.Mock).mockResolvedValue({
            inseridas: 0,
            deduplicadas: 1,
        });
        const segunda = await service.runMany(inputMany);

        expect(primeira.inseridas).toBe(primeira.total);
        expect(segunda.total).toBe(primeira.total); // releu a mesma carteira…
        expect(segunda.inseridas).toBe(0); // …e não gravou nada de novo.
        expect(segunda.deduplicadas).toBe(segunda.total);
    });

    it('a run de auditoria registra as contagens que o job vai logar', async () => {
        const { service, runRepo } = build();
        const result = await service.runMany(inputMany);

        const finish = (runRepo.finishRun as jest.Mock).mock.calls[0][0];
        expect(finish).toMatchObject({
            status: 'success',
            totalLidas: result.total,
            totalInseridas: result.inseridas,
            totalDeduplicadas: result.deduplicadas,
        });
    });
});

describe('IngestaoTransacoesService — fan-out', () => {
    it('lê cada CONTA uma vez só, num único pool bounded (ADR-0032)', async () => {
        // Regressão do bug que inflou a carteira 7×: o `fin133` mostra as MESMAS contas
        // a partir de qualquer filial e o `fin095` ignora a filial do header, então o
        // fan-out (filial × conta) lia o mesmo extrato N vezes. A conta 38 aparece nas
        // duas filiais e tem que virar UM alvo.
        const { service, bounded } = build();
        await service.runMany(inputMany);

        // 1ª chamada: contas por filial. 2ª: as contas DISTINTAS.
        expect(bounded.run).toHaveBeenCalledTimes(2);
        const [alvos, , limite] = bounded.run.mock.calls[1];
        expect(limite).toBe(FANOUT_LIMIT_RECEBIMENTOS);
        expect(alvos).toEqual([{ gerNum: 38, gerDes: 'ITAÚ', filCodSessao: 1 }]);
    });

    it('a mesma conta vista por N filiais rende UMA leitura do fin095', async () => {
        const { service, extrato } = build();
        await service.runMany(inputMany);
        // 2 filiais × 1 conta × 3 blocos de 30 dias = 3 leituras, não 6.
        expect(extrato.listLancamentos).toHaveBeenCalledTimes(3);
        expect(new Set(extrato.listLancamentos.mock.calls.map((c) => c[0].gerNum))).toEqual(
            new Set([38]),
        );
    });

    it('contas distintas continuam sendo lidas todas', async () => {
        const { service, extrato } = build({
            contas: [
                { gerNum: 38, gerDes: 'ITAÚ', qtdeBanco: 27 },
                { gerNum: 212, gerDes: 'BRADESCO', qtdeBanco: 4 },
            ],
        });
        await service.runMany(inputMany);
        expect(new Set(extrato.listLancamentos.mock.calls.map((c) => c[0].gerNum))).toEqual(
            new Set([38, 212]),
        );
    });

    it('pula contas sem movimento — não gasta chamada para receber vazio', async () => {
        const { service, extrato } = build({
            contas: [
                { gerNum: 38, qtdeBanco: 27, qtdeSistema: 13 },
                { gerNum: 99, qtdeBanco: 0, qtdeSistema: 0 },
            ],
        });
        await service.run({ filCod: 1, periodo, correlationId: 'c', triggeredBy: 'cron' });
        const contasLidas = extrato.listLancamentos.mock.calls.map((c) => c[0].gerNum);
        expect(new Set(contasLidas)).toEqual(new Set([38]));
    });

    it('fatia a janela em blocos de 30 dias', async () => {
        const { service, extrato } = build();
        await service.run({ filCod: 1, periodo, correlationId: 'c', triggeredBy: 'cron' });
        // 90 dias → 3 blocos.
        expect(extrato.listLancamentos).toHaveBeenCalledTimes(3);
        const janelas = extrato.listLancamentos.mock.calls.map((c) => c[0]);
        expect(janelas[0].de).toEqual(periodo.de);
        expect(janelas[2].ate).toEqual(periodo.ate);
        // Blocos contíguos, sem buraco nem sobreposição.
        expect(janelas[1].de).toEqual(janelas[0].ate);
        expect(janelas[2].de).toEqual(janelas[1].ate);
    });
});

describe('IngestaoTransacoesService — run de auditoria', () => {
    it('fecha como success e agrega as contagens', async () => {
        const { service, runRepo } = build();
        const r = await service.run({
            filCod: 1,
            periodo,
            correlationId: 'c',
            triggeredBy: 'cron',
        });
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'success', totalContasFalhas: 0, totalContas: 1 }),
        );
        expect(r).toMatchObject({ runId: 'run-1', total: 3, deduplicadas: 0 });
        // Não materializa as transações na resposta (payload de MB no trigger manual).
        expect(r.importadas).toBeUndefined();
    });

    it('conta que falha NÃO aborta a run, mas fecha como partial', async () => {
        const { service, extrato, runRepo } = build({
            contas: [
                { gerNum: 38, qtdeBanco: 1 },
                { gerNum: 212, qtdeBanco: 1 },
            ],
        });
        extrato.listLancamentos.mockImplementation(async ({ gerNum }: { gerNum: number }) => {
            if (gerNum === 212) throw new Error('ERP fora do ar');
            return [lancamento()];
        });

        await service.run({ filCod: 1, periodo, correlationId: 'c', triggeredBy: 'cron' });

        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'partial', totalContasFalhas: 1 }),
        );
    });

    it('erro geral fecha a run como error e propaga', async () => {
        const { service, extrato, runRepo } = build();
        extrato.listContas.mockRejectedValue(new Error('boom'));
        // `resolverAlvos` engole a falha por filial (settled) → 0 alvos, run vazia.
        await service.run({ filCod: 1, periodo, correlationId: 'c', triggeredBy: 'cron' });
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'success', totalContas: 0 }),
        );

        const outro = build();
        (outro.runRepo.createRun as jest.Mock).mockRejectedValue(new Error('db down'));
        await expect(
            outro.service.run({ filCod: 1, periodo, correlationId: 'c', triggeredBy: 'cron' }),
        ).rejects.toThrow('db down');
    });
});

describe('IngestaoTransacoesService — configuração', () => {
    it('resolverFilCods cai para todas as filiais do ERP quando a env é vazia', async () => {
        const { service } = build();
        expect(await service.resolverFilCods()).toEqual([1, 2]);
    });

    it('resolverFilCods respeita a env quando configurada', async () => {
        const { service, environmentProvider } = build();
        (environmentProvider.getEnvironmentVars as jest.Mock).mockResolvedValue({
            recebimentoIngestDias: 90,
            recebimentoIngestFilCods: [3],
        });
        expect(await service.resolverFilCods()).toEqual([3]);
    });

    it('resolverPeriodo usa a janela da env e aceita override quando ela já começa depois do piso', async () => {
        // Relógio bem depois do piso: 90 e 30 dias atrás continuam > 2026-08-03,
        // então o recorte não morde e a janela é a pedida.
        jest.useFakeTimers().setSystemTime(new Date('2027-06-01T12:00:00.000Z'));
        try {
            const { service } = build();
            const p = await service.resolverPeriodo();
            expect(Math.round((p.ate.getTime() - p.de.getTime()) / 86400000)).toBe(90);

            const p30 = await service.resolverPeriodo(30);
            expect(Math.round((p30.ate.getTime() - p30.de.getTime()) / 86400000)).toBe(30);
        } finally {
            jest.useRealTimers();
        }
    });
});

/**
 * Piso da janela de ingestão (ADR-0028). O extrato anterior ao go-live pertence ao
 * processo manual antigo: importá-lo encheria a carteira do analista de pendências
 * falsas. Estes testes fixam o relógio porque o recorte é relativo a "hoje".
 */
describe('IngestaoTransacoesService — piso de 2026-08-03', () => {
    afterEach(() => jest.useRealTimers());

    it('recorta a janela default: lançamento anterior ao piso NÃO é buscado', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
        const { service } = build();

        // 90 dias antes de 2026-08-10 seria 2026-05-12 — bem antes do piso.
        const p = await service.resolverPeriodo();
        expect(p.de.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    });

    it('recorta TAMBÉM o backfill explícito — `dias` grande não fura o piso', async () => {
        // O caminho que o operador usa no painel (`POST /recebimentos/ingestao { dias }`)
        // e o `DIAS=` do job. Sem este recorte, um 365 digitado reabriria a carteira
        // inteira de volta ao início do ano.
        jest.useFakeTimers().setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
        const { service } = build();

        const p = await service.resolverPeriodo(365);
        expect(p.de.toISOString()).toBe('2026-08-03T00:00:00.000Z');
    });

    it('NÃO é pegajoso: passado o tempo, a janela volta a ser a pedida', async () => {
        // Garante que o piso é um MÍNIMO, não uma data de início fixa — senão a
        // ingestão iria relendo 2026-08-03 em diante para sempre, crescendo sem fim.
        jest.useFakeTimers().setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
        const { service } = build();

        const p = await service.resolverPeriodo(30);
        expect(p.de.toISOString()).toBe('2026-12-02T00:00:00.000Z');
    });

    it('respeita o piso vindo da env (CONEXOS_EXTRATO_SYNC_START_DATE)', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
        const { service } = build({ startDate: new Date('2026-09-01T00:00:00.000Z') });

        const p = await service.resolverPeriodo(90);
        expect(p.de.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    });

    it('o piso é o `de` REAL enviado ao fin095, não só o retorno de resolverPeriodo', async () => {
        // Fecha o ciclo: recortar a janela não serve de nada se a leitura usar outra.
        jest.useFakeTimers().setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
        const { service, extrato } = build();

        const periodo = await service.resolverPeriodo(365);
        await service.runMany({ ...inputMany, periodo });

        const chamadas = (extrato.listLancamentos as jest.Mock).mock.calls;
        expect(chamadas.length).toBeGreaterThan(0);
        for (const [args] of chamadas) {
            expect(args.de.getTime()).toBeGreaterThanOrEqual(PISO_PADRAO.getTime());
        }
    });
});

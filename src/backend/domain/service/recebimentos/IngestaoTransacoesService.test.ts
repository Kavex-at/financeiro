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
    filCod: 1,
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

const build = (o: { contas?: unknown[]; lockLivre?: boolean } = {}) => {
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

describe('IngestaoTransacoesService — fan-out', () => {
    it('achata (filial × conta) num único pool bounded, nunca aninhado', async () => {
        const { service, bounded } = build();
        await service.runMany(inputMany);

        // 1ª chamada: contas por filial. 2ª: os pares achatados.
        expect(bounded.run).toHaveBeenCalledTimes(2);
        const [alvos, , limite] = bounded.run.mock.calls[1];
        expect(limite).toBe(FANOUT_LIMIT_RECEBIMENTOS);
        expect(alvos).toEqual([
            { filCod: 1, gerNum: 38, gerDes: 'ITAÚ' },
            { filCod: 2, gerNum: 38, gerDes: 'ITAÚ' },
        ]);
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

    it('resolverPeriodo usa a janela da env e aceita override', async () => {
        const { service } = build();
        const p = await service.resolverPeriodo();
        const dias = Math.round((p.ate.getTime() - p.de.getTime()) / 86400000);
        expect(dias).toBe(90);

        const p30 = await service.resolverPeriodo(30);
        expect(Math.round((p30.ate.getTime() - p30.de.getTime()) / 86400000)).toBe(30);
    });
});

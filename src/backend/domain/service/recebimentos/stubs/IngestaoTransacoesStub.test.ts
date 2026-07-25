import 'reflect-metadata';
import BoundedConcurrency from '../../../libs/concurrency/BoundedConcurrency.js';
import {
    FANOUT_LIMIT_RECEBIMENTOS,
    RECEBIMENTO_INGEST_LOCK_KEY,
} from '../../../interface/recebimentos/constants.js';
import IngestaoTransacoesStub from './IngestaoTransacoesStub.js';

describe('IngestaoTransacoesStub — bounded fan-out seam (performance-1)', () => {
    it('exposes the namespaced advisory lock key (≠ SISPAG)', () => {
        const stub = new IngestaoTransacoesStub(new BoundedConcurrency());
        expect(stub.advisoryLockKey).toBe(RECEBIMENTO_INGEST_LOCK_KEY);
    });

    it('runMany fans out through BoundedConcurrency with FANOUT_LIMIT_RECEBIMENTOS (never Promise.all)', async () => {
        const bounded = new BoundedConcurrency();
        const runSpy = jest.spyOn(bounded, 'run');
        const stub = new IngestaoTransacoesStub(bounded);

        const result = await stub.runMany({
            filCods: [1, 2, 3, 4, 5, 6],
            periodo: { de: new Date(), ate: new Date() },
            correlationId: 'corr-1',
            triggeredBy: 'cron',
        });

        expect(runSpy).toHaveBeenCalledTimes(1);
        // The bound is the SISPAG-parity limit (=4), passed as the 3rd arg.
        expect(runSpy.mock.calls[0][2]).toBe(FANOUT_LIMIT_RECEBIMENTOS);
        expect(result.runId).toContain('stub-run-many-');
    });

    it('run ingests a single filial (empty deterministic run)', async () => {
        const stub = new IngestaoTransacoesStub(new BoundedConcurrency());
        const out = await stub.run({
            filCod: 4,
            periodo: { de: new Date(), ate: new Date() },
            correlationId: 'corr-1',
            triggeredBy: 'cron',
        });
        expect(out).toMatchObject({ total: 0, deduplicadas: 0, importadas: [] });
    });
});

import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import IngestaoPagamentosService from './IngestaoPagamentosService.js';

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 1000,
    liberado: true,
    pago: false,
    ...over,
});

const buildLog = () =>
    ({
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
    }) as unknown as LogService;

interface Mocks {
    tituloRepo: { upsertMany: jest.Mock; marcarInativosForaDaRun: jest.Mock };
    runRepo: {
        createRun: jest.Mock;
        finishRun: jest.Mock;
        findRunIdByIdempotencyKey: jest.Mock;
        recordIdempotencyKey: jest.Mock;
    };
    listTitulos: jest.Mock;
    listExterior: jest.Mock;
    listContas: jest.Mock;
    listBoletoDda: jest.Mock;
    acquire: boolean;
    filiais: Array<{ filCod: number }>;
}

const make = (over: Partial<Mocks> = {}) => {
    const tituloRepo = over.tituloRepo ?? {
        upsertMany: jest.fn().mockResolvedValue(undefined),
        marcarInativosForaDaRun: jest.fn().mockResolvedValue(3),
    };
    const runRepo = over.runRepo ?? {
        createRun: jest.fn().mockResolvedValue('RUN1'),
        finishRun: jest.fn().mockResolvedValue(undefined),
        findRunIdByIdempotencyKey: jest.fn().mockResolvedValue(null),
        recordIdempotencyKey: jest.fn().mockResolvedValue(undefined),
    };
    const listTitulos =
        over.listTitulos ??
        jest.fn().mockResolvedValue([titulo(), titulo({ titCod: '2', pago: true })]);
    const listContas = over.listContas ?? jest.fn().mockResolvedValue([{ ccoCod: 1, bncCod: 4 }]);
    const sispag = {
        listTitulosAPagar: listTitulos,
        listExteriorDocCods: over.listExterior ?? jest.fn().mockResolvedValue(new Set<string>()),
        listContasCorrentes: listContas,
    } as unknown as ConexosSispagClient;
    const listBoletoDda = over.listBoletoDda ?? jest.fn().mockResolvedValue(new Set<string>());
    const fin015 = {
        listarTitulosComBoletoDda: listBoletoDda,
    } as unknown as ConexosSispagWriteClient;
    const base = {
        getFiliais: jest.fn().mockResolvedValue(over.filiais ?? [{ filCod: 2 }]),
    } as unknown as ConexosBaseClient;
    const acquire = over.acquire ?? true;
    const db = {
        withAdvisoryLock: jest.fn(
            (_k: number, onAcquired: () => Promise<unknown>, onBusy: () => Promise<unknown>) =>
                acquire ? onAcquired() : onBusy(),
        ),
    } as unknown as PostgreeDatabaseClient;
    const service = new IngestaoPagamentosService(
        tituloRepo as unknown as TituloAPagarRepository,
        runRepo as unknown as PagamentoIngestaoRunRepository,
        sispag,
        fin015,
        base,
        new BoundedConcurrency(),
        db,
        buildLog(),
    );
    return { service, tituloRepo, runRepo, listTitulos, listContas, listBoletoDda };
};

describe('IngestaoPagamentosService', () => {
    it('happy — persiste só os não-pagos, inativa o resto e fecha a run', async () => {
        const { service, tituloRepo, runRepo } = make();
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r).toMatchObject({ runId: 'RUN1', status: 'success', totalInativados: 3 });
        // só 1 dos 2 títulos (o não-pago) é persistido
        expect(tituloRepo.upsertMany).toHaveBeenCalledWith(
            [expect.objectContaining({ titCod: '1', pago: false })],
            'RUN1',
        );
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ runId: 'RUN1', status: 'success', totalTitulos: 1 }),
        );
    });

    it('filial que falha na leitura NÃO entra na inativação anti-fantasma', async () => {
        const listTitulos = jest
            .fn()
            .mockResolvedValueOnce([titulo()]) // filial 2 ok
            .mockRejectedValueOnce(new Error('conexos 504')); // filial 4 falha
        const { service, tituloRepo } = make({
            listTitulos,
            filiais: [{ filCod: 2 }, { filCod: 4 }],
        });
        await service.executar({ triggeredBy: 'cron' });
        // inativa só na filial 2 (lida); a 4 (falha) preserva seus títulos.
        expect(tituloRepo.marcarInativosForaDaRun).toHaveBeenCalledWith('RUN1', [2]);
    });

    it('DESCARTA os títulos internacionais (exterior/câmbio) da carteira — fora do escopo', async () => {
        const listTitulos = jest
            .fn()
            .mockResolvedValue([titulo({ docCod: '100' }), titulo({ docCod: '200', titCod: '2' })]);
        const listExterior = jest.fn().mockResolvedValue(new Set(['200'])); // doc 200 = exterior
        const { service, tituloRepo } = make({ listTitulos, listExterior });
        await service.executar({ triggeredBy: 'cron' });
        const [persistidos] = tituloRepo.upsertMany.mock.calls[0];
        // só o nacional (100) entra; o internacional (200) é filtrado fora.
        expect(persistidos.map((t: { docCod: string }) => t.docCod)).toEqual(['100']);
    });

    it('idempotência — key já vista devolve o run existente sem rodar', async () => {
        const runRepo = {
            createRun: jest.fn(),
            finishRun: jest.fn(),
            findRunIdByIdempotencyKey: jest.fn().mockResolvedValue('RUN-OLD'),
            recordIdempotencyKey: jest.fn(),
        };
        const { service } = make({ runRepo });
        const r = await service.executar({ triggeredBy: 'admin', idempotencyKey: 'k1' });
        expect(r.runId).toBe('RUN-OLD');
        expect(runRepo.createRun).not.toHaveBeenCalled();
    });

    it('lock ocupado — outra ingestão rodando vira IngestLockBusyError', async () => {
        const { service } = make({ acquire: false });
        await expect(service.executar({ triggeredBy: 'cron' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );
    });

    it('erro na leitura/persistência — fecha a run como error e propaga', async () => {
        const tituloRepo = {
            upsertMany: jest.fn().mockRejectedValue(new Error('db down')),
            marcarInativosForaDaRun: jest.fn(),
        };
        const { service, runRepo } = make({ tituloRepo });
        await expect(service.executar({ triggeredBy: 'cron' })).rejects.toThrow('db down');
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ runId: 'RUN1', status: 'error' }),
        );
    });
});

describe('IngestaoPagamentosService — flag de boleto (DDA)', () => {
    it('marca temBoleto nos títulos que o ERP casou com um boleto DDA', async () => {
        // O `fin064` não sabe de boleto (titEspCodbar é null em 100% da carteira); quem sabe
        // é o flag `titVldReflexoDdaAssoc` do grid de pendentes.
        const { service, tituloRepo } = make({
            listBoletoDda: jest.fn().mockResolvedValue(new Set(['2:100:1'])),
        });
        await service.executar({ triggeredBy: 'cron' });
        expect(tituloRepo.upsertMany).toHaveBeenCalledWith(
            [expect.objectContaining({ docCod: '100', titCod: '1', temBoleto: true })],
            'RUN1',
        );
    });

    it('título fora do conjunto fica temBoleto=false', async () => {
        const { service, tituloRepo } = make({
            listBoletoDda: jest.fn().mockResolvedValue(new Set(['2:999:1'])),
        });
        await service.executar({ triggeredBy: 'cron' });
        expect(tituloRepo.upsertMany).toHaveBeenCalledWith(
            [expect.objectContaining({ temBoleto: false })],
            'RUN1',
        );
    });

    it('manda TODOS os bancos distintos da filial, não só o primeiro', async () => {
        // Medido em PRD: `contas[0]` é um banco sem lote nas filiais 1 e 2, e parar nele
        // marcava a carteira inteira dessas filiais como "sem boleto".
        const listContas = jest.fn().mockResolvedValue([
            { ccoCod: 12, bncCod: 38 },
            { ccoCod: 1, bncCod: 4 },
            { ccoCod: 3, bncCod: 4 },
        ]);
        const listBoletoDda = jest.fn().mockResolvedValue(new Set<string>());
        const { service } = make({ listContas, listBoletoDda });
        await service.executar({ triggeredBy: 'cron' });
        expect(listBoletoDda).toHaveBeenCalledWith({ filCod: 2, bncCods: [38, 4] });
    });

    it('falha ao ler o flag NÃO derruba a ingestão — carteira persiste com warn', async () => {
        const { service, tituloRepo, runRepo } = make({
            listBoletoDda: jest.fn().mockRejectedValue(new Error('ERP fora do ar')),
        });
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r.status).toBe('success');
        expect(tituloRepo.upsertMany).toHaveBeenCalledWith(
            [expect.objectContaining({ temBoleto: false })],
            'RUN1',
        );
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'success' }),
        );
    });

    it('filial sem conta pagadora degrada em silêncio (sem contexto para o grid)', async () => {
        const listBoletoDda = jest.fn();
        const { service } = make({
            listContas: jest.fn().mockResolvedValue([]),
            listBoletoDda,
        });
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r.status).toBe('success');
        expect(listBoletoDda).not.toHaveBeenCalled();
    });
});

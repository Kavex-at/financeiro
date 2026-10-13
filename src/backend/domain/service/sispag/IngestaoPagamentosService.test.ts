import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagWriteClient from '../../client/ConexosSispagWriteClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type { SinalPendente } from '../../interface/sispag/Fin015Write.js';
import type { TituloAPagar } from '../../interface/sispag/SispagInterface.js';
import type PagamentoIngestaoRunRepository from '../../repository/sispag/PagamentoIngestaoRunRepository.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import type BoletoDdaService from './BoletoDdaService.js';
import IngestaoPagamentosService, {
    DDA_PRAZO_NA_INGESTAO_MS,
} from './IngestaoPagamentosService.js';

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
    listSinais: jest.Mock;
    acquire: boolean;
    filiais: Array<{ filCod: number }>;
    encerrar: jest.Mock;
    /** `BoletoDdaService.sincronizar` — por padrão, sincroniza sem falha. */
    sincronizarDda: jest.Mock;
}

const DDA_OK = {
    arquivosNovos: 1,
    arquivosRelidos: 4,
    boletos: 120,
    falhas: 0,
    arquivosAdiados: 0,
};

/** Mapa do grid de pendentes como `listarSinaisDosPendentes` devolve. */
const sinais = (...linhas: Array<[string, SinalPendente]>): Map<string, SinalPendente> =>
    new Map(linhas);

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
    const listSinais = over.listSinais ?? jest.fn().mockResolvedValue(new Map());
    const fin015 = {
        listarSinaisDosPendentes: listSinais,
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
    const bloqueioRepo = {
        encerrarDeTitulosInativos: over.encerrar ?? jest.fn().mockResolvedValue(0),
    };
    const sincronizarDda = over.sincronizarDda ?? jest.fn().mockResolvedValue(DDA_OK);
    const log = buildLog();
    const service = new IngestaoPagamentosService(
        tituloRepo as unknown as TituloAPagarRepository,
        runRepo as unknown as PagamentoIngestaoRunRepository,
        sispag,
        fin015,
        base,
        new BoundedConcurrency(),
        db,
        log,
        bloqueioRepo as unknown as BloqueioDuplicidadeRepository,
        { sincronizar: sincronizarDda } as unknown as BoletoDdaService,
    );
    return {
        sincronizarDda,
        service,
        tituloRepo,
        runRepo,
        listTitulos,
        listContas,
        listSinais,
        bloqueioRepo,
        log,
    };
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

    describe('pool DDA dentro da ingestão', () => {
        it('sincroniza ANTES de ler os títulos, com prazo, e devolve o resumo', async () => {
            const { service, sincronizarDda, listTitulos } = make();
            const r = await service.executar({ triggeredBy: 'cron' });
            expect(sincronizarDda).toHaveBeenCalledWith({
                triggeredBy: 'ingestao:cron',
                prazoMs: DDA_PRAZO_NA_INGESTAO_MS,
            });
            expect(sincronizarDda.mock.invocationCallOrder[0]).toBeLessThan(
                listTitulos.mock.invocationCallOrder[0] ?? 0,
            );
            expect(r.dda).toEqual({ estado: 'sincronizado', ...DDA_OK });
        });

        it('falha do DDA NÃO derruba a ingestão: run success, aviso na run e WARN', async () => {
            const { service, runRepo, tituloRepo, log } = make({
                sincronizarDda: jest.fn().mockRejectedValue(new Error('fin124 504')),
            });
            const r = await service.executar({ triggeredBy: 'cron' });
            expect(r.status).toBe('success');
            expect(r.dda).toMatchObject({ estado: 'falhou', erro: 'fin124 504' });
            expect(tituloRepo.upsertMany).toHaveBeenCalledTimes(1);
            expect(runRepo.finishRun).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'success',
                    errorMessage: expect.stringContaining('pool DDA falhou'),
                }),
            );
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('sincronização DDA falhou'),
                }),
            );
        });

        it('sincronização já em andamento (lock) vira "ocupada", sem aviso na run', async () => {
            const { service, runRepo } = make({
                sincronizarDda: jest.fn().mockRejectedValue(new IngestLockBusyError('busy')),
            });
            const r = await service.executar({ triggeredBy: 'cron' });
            expect(r.status).toBe('success');
            expect(r.dda).toEqual({ estado: 'ocupada' });
            const fin = runRepo.finishRun.mock.calls[0]?.[0] as { errorMessage?: string };
            expect(fin.errorMessage).toBeUndefined();
        });

        it('arquivos adiados pelo prazo viram "parcial" e ficam registrados na run', async () => {
            const { service, runRepo } = make({
                sincronizarDda: jest.fn().mockResolvedValue({ ...DDA_OK, arquivosAdiados: 12 }),
            });
            const r = await service.executar({ triggeredBy: 'cron' });
            expect(r.dda).toMatchObject({ estado: 'parcial', arquivosAdiados: 12 });
            expect(runRepo.finishRun).toHaveBeenCalledWith(
                expect.objectContaining({
                    errorMessage: expect.stringContaining('pool DDA parcial'),
                }),
            );
        });
    });

    it('ADR-0063 I13g — depois de inativar, encerra os bloqueios por duplicidade dos títulos inativos', async () => {
        const { service, bloqueioRepo, tituloRepo } = make({
            encerrar: jest.fn().mockResolvedValue(2),
        });
        await service.executar({ triggeredBy: 'cron' });
        expect(bloqueioRepo.encerrarDeTitulosInativos).toHaveBeenCalledTimes(1);
        const ordemInativar = tituloRepo.marcarInativosForaDaRun.mock.invocationCallOrder[0] ?? 0;
        const ordemEncerrar =
            bloqueioRepo.encerrarDeTitulosInativos.mock.invocationCallOrder[0] ?? 0;
        expect(ordemEncerrar).toBeGreaterThan(ordemInativar);
    });

    it('falha ao encerrar bloqueios não regride a run (efeito pós-sucesso)', async () => {
        const { service, runRepo, log } = make({
            encerrar: jest.fn().mockRejectedValue(new Error('pg down')),
        });
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r.status).toBe('success');
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'success' }),
        );
        expect((log.warn as jest.Mock).mock.calls.map(([p]) => p.message)).toContain(
            'ingestão: falha ao encerrar bloqueios por duplicidade de títulos inativos',
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

    it('NENHUMA filial lida → run `error`, propaga e NÃO toca a carteira (não é carteira vazia)', async () => {
        const listTitulos = jest.fn().mockRejectedValue(new Error('Bad Credentials'));
        const { service, tituloRepo, runRepo } = make({
            listTitulos,
            filiais: [{ filCod: 1 }, { filCod: 2 }],
        });
        await expect(service.executar({ triggeredBy: 'cron' })).rejects.toThrow(/nenhuma das 2/);
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'error',
                errorMessage: expect.stringContaining('Bad Credentials'),
            }),
        );
        expect(tituloRepo.upsertMany).not.toHaveBeenCalled();
        expect(tituloRepo.marcarInativosForaDaRun).not.toHaveBeenCalled();
    });

    it('Conexos sem nenhuma filial → run `error`', async () => {
        const { service, runRepo } = make({ filiais: [] });
        await expect(service.executar({ triggeredBy: 'cron' })).rejects.toThrow(/nenhuma filial/);
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'error' }),
        );
    });

    it('leitura PARCIAL segue success, mas registra e devolve as filiais que falharam', async () => {
        const listTitulos = jest
            .fn()
            .mockResolvedValueOnce([titulo()])
            .mockRejectedValueOnce(new Error('conexos 504'));
        const { service, runRepo } = make({ listTitulos, filiais: [{ filCod: 2 }, { filCod: 4 }] });
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r).toMatchObject({ status: 'success', filiaisComFalha: [4] });
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'success',
                errorMessage: expect.stringContaining('filial 4: conexos 504'),
            }),
        );
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
            listSinais: jest.fn().mockResolvedValue(sinais(['2:100:1', { temBoletoDda: true }])),
        });
        await service.executar({ triggeredBy: 'cron' });
        expect(tituloRepo.upsertMany).toHaveBeenCalledWith(
            [expect.objectContaining({ docCod: '100', titCod: '1', temBoleto: true })],
            'RUN1',
        );
    });

    it('título fora do conjunto fica temBoleto=false', async () => {
        const { service, tituloRepo } = make({
            listSinais: jest.fn().mockResolvedValue(sinais(['2:999:1', { temBoletoDda: true }])),
        });
        await service.executar({ triggeredBy: 'cron' });
        expect(tituloRepo.upsertMany).toHaveBeenCalledWith(
            [expect.objectContaining({ temBoleto: false })],
            'RUN1',
        );
    });

    it('flag de boleto ILEGÍVEL (ex.: 403 do robô) → temBoleto indefinido, não false, e avisa', async () => {
        // Antes: conjunto vazio → temBoleto=false → o UPSERT apagava o flag de toda a filial,
        // desfazendo todo dia a ingestão manual da analista.
        const { service, tituloRepo, runRepo } = make({
            listSinais: jest.fn().mockRejectedValue(new Error('403 ACCESS_DENIED FIN_041')),
        });
        const r = await service.executar({ triggeredBy: 'cron' });
        const [persistidos] = tituloRepo.upsertMany.mock.calls[0];
        expect(persistidos[0].temBoleto).toBeUndefined();
        expect(r.filiaisSemFlagBoleto).toEqual([2]);
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 'success',
                errorMessage: expect.stringContaining('flag de boleto DDA não lido'),
            }),
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
        const listSinais = jest.fn().mockResolvedValue(new Map());
        const { service } = make({ listContas, listSinais });
        await service.executar({ triggeredBy: 'cron' });
        expect(listSinais).toHaveBeenCalledWith({ filCod: 2, bncCods: [38, 4] });
    });

    it('falha ao ler o flag NÃO derruba a ingestão — carteira persiste com warn', async () => {
        const { service, tituloRepo, runRepo } = make({
            listSinais: jest.fn().mockRejectedValue(new Error('ERP fora do ar')),
        });
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r.status).toBe('success');
        // Indefinido (preserva o flag gravado), e NÃO `false` — ver o teste do 403 do robô.
        const [persistidos] = tituloRepo.upsertMany.mock.calls[0];
        expect(persistidos[0].temBoleto).toBeUndefined();
        expect(runRepo.finishRun).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'success' }),
        );
    });

    it('filial sem conta pagadora degrada em silêncio (sem contexto para o grid)', async () => {
        const listSinais = jest.fn();
        const { service } = make({
            listContas: jest.fn().mockResolvedValue([]),
            listSinais,
        });
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r.status).toBe('success');
        expect(listSinais).not.toHaveBeenCalled();
    });
});

describe('IngestaoPagamentosService — forma de pagamento no Conexos (titVldPagopor)', () => {
    it('grava a forma do grid de pendentes, independente do flag DDA', async () => {
        // JOMED 5427/1 (PRD, 2026-10-08): BOLETO no Conexos, sem boleto DDA associado.
        const { service, tituloRepo } = make({
            listSinais: jest
                .fn()
                .mockResolvedValue(sinais(['2:100:1', { temBoletoDda: false, pagoPor: 6 }])),
        });
        await service.executar({ triggeredBy: 'cron' });
        expect(tituloRepo.upsertMany).toHaveBeenCalledWith(
            [expect.objectContaining({ temBoleto: false, formaPagamentoConexos: 6 })],
            'RUN1',
        );
    });

    it('título fora do grid ou sem forma legível fica indefinido (o UPSERT preserva)', async () => {
        const { service, tituloRepo } = make({
            listSinais: jest
                .fn()
                .mockResolvedValue(sinais(['2:999:1', { temBoletoDda: false, pagoPor: 2 }])),
        });
        await service.executar({ triggeredBy: 'cron' });
        const [persistidos] = tituloRepo.upsertMany.mock.calls[0];
        expect(persistidos[0].formaPagamentoConexos).toBeUndefined();
        expect(persistidos[0]).not.toHaveProperty('formaPagamentoConexos');
    });

    it('grid sem NENHUM titVldPagopor legível → avisa (contrato mudou), sem derrubar', async () => {
        const { service, log } = make({
            listSinais: jest
                .fn()
                .mockResolvedValue(
                    sinais(
                        ['2:100:1', { temBoletoDda: true }],
                        ['2:200:1', { temBoletoDda: false }],
                    ),
                ),
        });
        const r = await service.executar({ triggeredBy: 'cron' });
        expect(r.status).toBe('success');
        expect((log.warn as jest.Mock).mock.calls.map(([p]) => p.message)).toContain(
            'ingestão pagamentos: forma de pagamento (titVldPagopor) ilegível em todo o grid',
        );
    });

    it('código de forma desconhecido → grava e avisa UMA vez por código, com contagem e exemplo', async () => {
        const { service, tituloRepo, log } = make({
            listTitulos: jest
                .fn()
                .mockResolvedValue([titulo({ docCod: '100' }), titulo({ docCod: '200' })]),
            listSinais: jest
                .fn()
                .mockResolvedValue(
                    sinais(
                        ['2:100:1', { temBoletoDda: false, pagoPor: 11 }],
                        ['2:200:1', { temBoletoDda: false, pagoPor: 11 }],
                        ['2:300:1', { temBoletoDda: false, pagoPor: 6 }],
                    ),
                ),
        });
        await service.executar({ triggeredBy: 'cron' });
        const [persistidos] = tituloRepo.upsertMany.mock.calls[0];
        expect(
            persistidos.map((t: { formaPagamentoConexos?: number }) => t.formaPagamentoConexos),
        ).toEqual([11, 11]);
        const avisos = (log.warn as jest.Mock).mock.calls
            .map(([p]) => p)
            .filter((p) => p.message.includes('forma de pagamento desconhecida'));
        expect(avisos).toHaveLength(1);
        expect(avisos[0].data).toEqual({ filCod: 2, codigo: 11, titulos: 2, exemplo: '2:100:1' });
    });

    it('falha ao LOGAR o aviso de código desconhecido não descarta os sinais lidos', async () => {
        const { service, tituloRepo, log } = make({
            listSinais: jest
                .fn()
                .mockResolvedValue(sinais(['2:100:1', { temBoletoDda: true, pagoPor: 11 }])),
        });
        (log.warn as jest.Mock).mockImplementation(async (p: { message: string }) => {
            if (p.message.includes('forma de pagamento desconhecida')) throw new Error('log fora');
        });
        await service.executar({ triggeredBy: 'cron' });
        const [persistidos] = tituloRepo.upsertMany.mock.calls[0];
        expect(persistidos[0]).toMatchObject({ temBoleto: true, formaPagamentoConexos: 11 });
    });

    it('leitura do grid falhou → forma indefinida, como o flag DDA', async () => {
        const { service, tituloRepo } = make({
            listSinais: jest.fn().mockRejectedValue(new Error('403 ACCESS_DENIED')),
        });
        await service.executar({ triggeredBy: 'cron' });
        const [persistidos] = tituloRepo.upsertMany.mock.calls[0];
        expect(persistidos[0].formaPagamentoConexos).toBeUndefined();
    });
});

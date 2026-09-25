import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosDdaClient from '../../client/ConexosDdaClient.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import IngestLockBusyError from '../../errors/IngestLockBusyError.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import BoletoDdaService from './BoletoDdaService.js';
import ConsolidacaoBoletoDda from './ConsolidacaoBoletoDda.js';
import PaginacaoBoletoDda from './PaginacaoBoletoDda.js';

const HOJE = new Date('2026-09-23T15:00:00Z');
const dia = (civil: string): number => Date.parse(`${civil}T08:30:00Z`);

const build = (lockLivre = true) => {
    const calendar = BankingCalendar.withClock(() => HOJE);
    const dda = {
        listarArquivos: jest.fn().mockResolvedValue([]),
        listarItens: jest.fn().mockResolvedValue([]),
    };
    const repo = {
        listArquivosSincronizados: jest.fn().mockResolvedValue(new Map()),
        salvarArquivo: jest.fn().mockResolvedValue(undefined),
        listBoletos: jest.fn().mockResolvedValue([]),
        ultimaSincronizacao: jest.fn().mockResolvedValue(undefined),
    };
    const db = {
        withAdvisoryLock: jest.fn(
            (_k: number, fn: () => Promise<unknown>, busy: () => Promise<unknown>) =>
                lockLivre ? fn() : busy(),
        ),
    };
    const log = { info: jest.fn(), warn: jest.fn() };
    const service = new BoletoDdaService(
        dda as unknown as ConexosDdaClient,
        { getFilCodDefault: jest.fn().mockResolvedValue(1) } as unknown as ConexosBaseClient,
        repo as unknown as BoletoDdaRepository,
        { listAtivos: jest.fn().mockResolvedValue([]) } as unknown as TituloAPagarRepository,
        {
            listTitulosEmLotesAbertos: jest.fn().mockResolvedValue([]),
        } as unknown as LotePagamentoRepository,
        new ConsolidacaoBoletoDda(new CodigoBarrasBoleto(), calendar),
        new PaginacaoBoletoDda(),
        calendar,
        new BoundedConcurrency(),
        db as unknown as PostgreeDatabaseClient,
        log as unknown as LogService,
    );
    return { service, dda, repo, log };
};

describe('BoletoDdaService', () => {
    it('sincronizar lê arquivos novos e relê só os recentes já conhecidos', async () => {
        const { service, dda, repo } = build();
        dda.listarArquivos.mockResolvedValue([
            { ddcCod: 162, importadoEm: dia('2026-09-23') }, // novo
            { ddcCod: 152, importadoEm: dia('2026-09-10') }, // conhecido, recente → relê
            { ddcCod: 100, importadoEm: dia('2026-06-01') }, // conhecido, antigo → pula
        ]);
        repo.listArquivosSincronizados.mockResolvedValue(
            new Map([
                [152, dia('2026-09-10')],
                [100, dia('2026-06-01')],
            ]),
        );
        dda.listarItens.mockResolvedValue([{ ddcCod: 0, ditCod: 1, valor: 1 }]);

        const r = await service.sincronizar({ triggeredBy: 'teste' });

        expect(dda.listarItens.mock.calls.map((c) => c[0].ddcCod).sort()).toEqual([152, 162]);
        expect(r).toEqual({ arquivosNovos: 1, arquivosRelidos: 1, boletos: 2, falhas: 0 });
    });

    it('um arquivo que falha não derruba os outros e é contado', async () => {
        const { service, dda, repo, log } = build();
        dda.listarArquivos.mockResolvedValue([{ ddcCod: 1 }, { ddcCod: 2 }]);
        dda.listarItens
            .mockRejectedValueOnce(new Error('504'))
            .mockResolvedValueOnce([{ ddcCod: 2, ditCod: 1, valor: 1 }]);

        const r = await service.sincronizar({ triggeredBy: 'teste' });

        expect(r.falhas).toBe(1);
        expect(repo.salvarArquivo).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ ddcCod: 1, erro: '504' }) }),
        );
    });

    it('sincronização concorrente → IngestLockBusyError (409)', async () => {
        const { service } = build(false);
        await expect(service.sincronizar({ triggeredBy: 'teste' })).rejects.toBeInstanceOf(
            IngestLockBusyError,
        );
    });

    it('listar "a-vencer" corta pelo dia de Brasília; "todos" não corta', async () => {
        const { service, repo } = build();
        repo.ultimaSincronizacao.mockResolvedValue(123);

        const r = await service.listar({ escopo: 'a-vencer' });
        expect(repo.listBoletos).toHaveBeenLastCalledWith({ vencimentoDesde: '2026-09-23' });
        expect(r).toEqual({
            boletos: [],
            total: 0,
            pagina: 1,
            tamanho: 20,
            contagem: { todas: 0, VINCULADO: 0, CANDIDATO: 0, AMBIGUO: 0, SEM_TITULO: 0 },
            filiais: [],
            sincronizadoEm: 123,
            janelaDias: 3,
        });

        await service.listar({ escopo: 'todos' });
        expect(repo.listBoletos).toHaveBeenLastCalledWith({});
    });

    it('listar devolve só a página pedida, com o total do escopo inteiro', async () => {
        const { service, repo } = build();
        repo.listBoletos.mockResolvedValue(
            Array.from({ length: 45 }, (_, i) => ({
                ddcCod: 1,
                ditCod: i + 1,
                valor: 10 + i,
                vencimento: '2026-10-01',
            })),
        );

        const r = await service.listar({ escopo: 'todos', pagina: 3, tamanho: 20 });

        expect(r.total).toBe(45);
        expect(r.pagina).toBe(3);
        expect(r.boletos.map((b) => b.ditCod)).toEqual([41, 42, 43, 44, 45]);
        expect(r.contagem.SEM_TITULO).toBe(45);
    });
});

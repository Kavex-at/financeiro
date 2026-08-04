import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import { CATEGORIAS_TESOURARIA } from '../../interface/recebimentos/constants.js';
import type RecebimentoIngestaoRunRepository from '../../repository/recebimentos/RecebimentoIngestaoRunRepository.js';
import type TransacaoRepository from '../../repository/recebimentos/TransacaoRepository.js';
import RecebimentosPainelService from './RecebimentosPainelService.js';

const build = (o: { transacoes?: unknown[]; kpis?: Record<string, number> } = {}) => {
    const transacaoRepo = {
        listParaPainel: jest.fn().mockResolvedValue(o.transacoes ?? []),
        contarKpis: jest.fn().mockResolvedValue(o.kpis ?? { importada: 1758, conciliada: 1 }),
        somarValorPorStatus: jest.fn().mockResolvedValue({ importada: 250000, parcial: 1000 }),
    } as unknown as jest.Mocked<TransacaoRepository>;

    const runRepo = {
        findLatestSuccessFinishedAt: jest.fn().mockResolvedValue('2026-07-30T12:00:00.000Z'),
    } as unknown as jest.Mocked<RecebimentoIngestaoRunRepository>;

    const base = {
        getFiliais: jest.fn().mockResolvedValue([{ filCod: 1 }, { filCod: 2 }]),
    } as unknown as jest.Mocked<ConexosBaseClient>;

    return {
        transacaoRepo,
        runRepo,
        base,
        service: new RecebimentosPainelService(transacaoRepo, runRepo, base),
    };
};

describe('RecebimentosPainelService', () => {
    it('KPIs vêm do COUNT do banco, não da lista paginada', async () => {
        // Com o cap de 500, KPIs derivados da página contariam 500 de 1.759.
        const { service } = build({
            transacoes: [{}, {}],
            kpis: { importada: 1758, conciliada: 1 },
        });
        const painel = await service.montarPainel();

        expect(painel.transacoes).toHaveLength(2);
        expect(painel.kpis.importadas).toBe(1758);
        expect(painel.kpis.conciliadas).toBe(1);
    });

    it('esconde as categorias de tesouraria por default', async () => {
        const { service, transacaoRepo } = build();
        const painel = await service.montarPainel();

        expect(painel.categoriasOcultas).toEqual([...CATEGORIAS_TESOURARIA]);
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ categoriasExcluidas: [...CATEGORIAS_TESOURARIA] }),
        );
    });

    it('incluirTesouraria remove o filtro — o dado nunca foi apagado', async () => {
        const { service, transacaoRepo } = build();
        const painel = await service.montarPainel({ incluirTesouraria: true });

        expect(painel.categoriasOcultas).toEqual([]);
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ categoriasExcluidas: [] }),
        );
    });

    it('só lista CRÉDITO — débito não é recebimento', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel();
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ tipos: ['CREDITO'] }),
        );
    });

    it('usa as filiais permitidas do usuário quando existem', async () => {
        const { service, transacaoRepo, base } = build();
        await service.montarPainel({ filCodsPermitidas: [3] });
        expect(base.getFiliais).not.toHaveBeenCalled();
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ filCods: [3] }),
        );
    });

    it('sem allow-list cai para todas as filiais do ERP', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel();
        expect(transacaoRepo.listParaPainel).toHaveBeenCalledWith(
            expect.objectContaining({ filCods: [1, 2] }),
        );
    });

    it('marca truncado quando a lista bate no teto', async () => {
        const { service } = build({ transacoes: Array.from({ length: 10 }, () => ({})) });
        expect((await service.montarPainel({ limit: 10 })).truncado).toBe(true);
        expect((await service.montarPainel({ limit: 50 })).truncado).toBe(false);
    });

    it('o limit nunca ultrapassa o cap, mesmo pedido maior', async () => {
        const { service, transacaoRepo } = build();
        await service.montarPainel({ limit: 99999 });
        const [{ limit }] = (transacaoRepo.listParaPainel as jest.Mock).mock.calls[0];
        expect(limit).toBe(500);
    });

    it('expõe a última ingestão e a fonte banco — sem caminho de demonstração', async () => {
        const { service } = build();
        const painel = await service.montarPainel();
        expect(painel.fonte).toBe('banco');
        expect(painel.ultimaIngestao).toBe('2026-07-30T12:00:00.000Z');
    });

    it('valorNaoAlocado soma importadas + parciais', async () => {
        const { service } = build();
        expect((await service.montarPainel()).kpis.valorNaoAlocado).toBe(251000);
    });
});

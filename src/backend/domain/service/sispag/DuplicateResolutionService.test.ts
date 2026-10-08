import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import DuplicateResolutionError from '../../errors/DuplicateResolutionError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import type { AlertaItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type LogService from '../LogService.js';
import DuplicateResolutionService from './DuplicateResolutionService.js';
import type LotePagamentoService from './LotePagamentoService.js';

const CHAVE = { filCod: 4, docCod: '6173', titCod: '1' };

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 4,
    status: 'RASCUNHO',
    criadoPor: 'ana',
    versao: 2,
    automatico: true,
    itens: [],
    ...over,
});

const alerta = (over: Partial<AlertaItemLote> = {}): AlertaItemLote => ({
    id: 'A1',
    loteId: 'L1',
    ...CHAVE,
    tipo: 'DUPLICIDADE_FORTE',
    contraparteFilCod: 4,
    contraparteDocCod: '6702',
    evidencia: {},
    estado: 'ABERTA',
    criadoEm: '2026-10-05T10:00:00.000Z',
    verificadoEm: '2026-10-05T10:00:00.000Z',
    ...over,
});

const build = (opts: { lote?: LotePagamento | null; alerta?: AlertaItemLote | null } = {}) => {
    const tx = { tx: true };
    const loteRepo = {
        getLoteComItens: jest.fn().mockResolvedValue(opts.lote === undefined ? lote() : opts.lote),
        removerItem: jest.fn().mockResolvedValue(1),
        marcarManual: jest.fn().mockResolvedValue(undefined),
        tocarLote: jest.fn().mockResolvedValue(undefined),
    };
    const alertaRepo = {
        getById: jest.fn().mockResolvedValue(opts.alerta === undefined ? alerta() : opts.alerta),
        resolver: jest.fn().mockResolvedValue(true),
        descartarDoItem: jest.fn().mockResolvedValue(0),
    };
    const bloqueioRepo = {
        criar: jest.fn().mockResolvedValue('B1'),
        desfazer: jest.fn().mockResolvedValue({ id: 'B1', estado: 'DESFEITO' }),
    };
    const lotes = { getLote: jest.fn().mockResolvedValue(lote()) };
    const db = { withTransaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const log = { info: jest.fn() };
    const service = new DuplicateResolutionService(
        loteRepo as unknown as LotePagamentoRepository,
        alertaRepo as unknown as AlertaItemLoteRepository,
        bloqueioRepo as unknown as BloqueioDuplicidadeRepository,
        lotes as unknown as LotePagamentoService,
        db as unknown as PostgreeDatabaseClient,
        log as unknown as LogService,
    );
    return { service, loteRepo, alertaRepo, bloqueioRepo, lotes, tx };
};

const resolver = (
    service: DuplicateResolutionService,
    acao: 'JUSTIFICAR' | 'RETIRAR',
    justificativa?: string,
) =>
    service.resolverAlertaDuplicidade({
        loteId: 'L1',
        chave: CHAVE,
        alertaId: 'A1',
        acao,
        ...(justificativa !== undefined ? { justificativa } : {}),
        ator: 'ana',
    });

describe('DuplicateResolutionService.resolverAlertaDuplicidade (I13f)', () => {
    it('JUSTIFICAR: grava JUSTIFICADA com texto e ator; o item fica', async () => {
        const h = build();
        await resolver(h.service, 'JUSTIFICAR', '  NF de serviço e NF de produto  ');
        expect(h.alertaRepo.resolver).toHaveBeenCalledWith(
            {
                alerta: expect.objectContaining({ id: 'A1' }),
                resolucao: 'JUSTIFICADA',
                justificativa: 'NF de serviço e NF de produto',
                ator: 'ana',
            },
            h.tx,
        );
        expect(h.loteRepo.removerItem).not.toHaveBeenCalled();
        expect(h.bloqueioRepo.criar).not.toHaveBeenCalled();
        expect(h.lotes.getLote).toHaveBeenCalledWith('L1');
    });

    it.each(['', '   '])('JUSTIFICAR sem texto (%j) → 400, nada gravado', async (texto) => {
        const h = build();
        const err = await resolver(h.service, 'JUSTIFICAR', texto).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(DuplicateResolutionError);
        expect(err).toMatchObject({ statusCode: 400 });
        expect(h.alertaRepo.resolver).not.toHaveBeenCalled();
    });

    it('RETIRAR: alerta RETIRADA, item sai, demais alertas descartadas, bloqueio ATIVO — numa transação', async () => {
        const h = build();
        await resolver(h.service, 'RETIRAR');
        expect(h.alertaRepo.resolver.mock.calls[0]?.[0]).toMatchObject({ resolucao: 'RETIRADA' });
        expect(h.alertaRepo.descartarDoItem).toHaveBeenCalledWith('L1', CHAVE, 'ana', h.tx);
        expect(h.loteRepo.removerItem).toHaveBeenCalledWith({ loteId: 'L1', ...CHAVE }, h.tx);
        expect(h.loteRepo.marcarManual).toHaveBeenCalledWith('L1', h.tx);
        expect(h.loteRepo.tocarLote).toHaveBeenCalledWith('L1', h.tx);
        expect(h.bloqueioRepo.criar).toHaveBeenCalledWith(
            expect.objectContaining({
                chave: CHAVE,
                alertaId: 'A1',
                loteIdOrigem: 'L1',
                ator: 'ana',
                motivo: expect.stringContaining('cancelamento pendente no Conexos'),
            }),
            h.tx,
        );
    });

    it('só em RASCUNHO', async () => {
        const h = build({ lote: lote({ status: 'FINALIZADO' }) });
        await expect(resolver(h.service, 'JUSTIFICAR', 'x')).rejects.toBeInstanceOf(
            LoteEstadoInvalidoError,
        );
        expect(h.alertaRepo.resolver).not.toHaveBeenCalled();
    });

    it.each([
        ['inexistente', null],
        ['de outro lote', alerta({ loteId: 'L2' })],
        ['de outro item', alerta({ docCod: '9' })],
    ])('alerta %s → 404', async (_n, a) => {
        const h = build({ alerta: a as AlertaItemLote | null });
        await expect(resolver(h.service, 'JUSTIFICAR', 'x')).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it('alerta já tratada → 409 (também se outra pessoa resolveu no meio)', async () => {
        const h = build({ alerta: alerta({ estado: 'RESOLVIDA' }) });
        await expect(resolver(h.service, 'JUSTIFICAR', 'x')).rejects.toMatchObject({
            statusCode: 409,
        });
        const corrida = build();
        corrida.alertaRepo.resolver.mockResolvedValue(false);
        await expect(resolver(corrida.service, 'RETIRAR')).rejects.toMatchObject({
            statusCode: 409,
        });
        expect(corrida.bloqueioRepo.criar).not.toHaveBeenCalled();
    });
});

describe('DuplicateResolutionService.desfazerBloqueio (I13g)', () => {
    it('exige motivo e é auditado (repo grava o evento)', async () => {
        const h = build();
        await h.service.desfazerBloqueio({ chave: CHAVE, motivo: ' 6173 cancelado ', ator: 'ana' });
        expect(h.bloqueioRepo.desfazer).toHaveBeenCalledWith({
            chave: CHAVE,
            motivo: '6173 cancelado',
            ator: 'ana',
        });
        await expect(
            h.service.desfazerBloqueio({ chave: CHAVE, motivo: '  ', ator: 'ana' }),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('sem bloqueio ATIVO → 409', async () => {
        const h = build();
        h.bloqueioRepo.desfazer.mockResolvedValue(null);
        await expect(
            h.service.desfazerBloqueio({ chave: CHAVE, motivo: 'x', ator: 'ana' }),
        ).rejects.toMatchObject({ statusCode: 409 });
    });
});

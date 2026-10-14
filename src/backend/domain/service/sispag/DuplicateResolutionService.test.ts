import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import DuplicateResolutionError from '../../errors/DuplicateResolutionError.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import type { AlertaItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type AlertaItemLoteRepository from '../../repository/sispag/AlertaItemLoteRepository.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type RemessaExecucaoRepository from '../../repository/sispag/RemessaExecucaoRepository.js';
import type VerificacaoEventoRepository from '../../repository/sispag/VerificacaoEventoRepository.js';
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
        // Marca da duplicidade de título por padrão (comportamento histórico do desfazer).
        findAtivo: jest.fn().mockResolvedValue(null),
        listAtivosPorOrigemComTitulo: jest.fn().mockResolvedValue([]),
    };
    const eventos = { listarRetiradasPorCodigoBarras: jest.fn().mockResolvedValue([]) };
    const ledger = { listByLote: jest.fn().mockResolvedValue([]) };
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
        eventos as unknown as VerificacaoEventoRepository,
        ledger as unknown as RemessaExecucaoRepository,
    );
    return { service, loteRepo, alertaRepo, bloqueioRepo, lotes, tx, eventos, ledger };
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

describe('DuplicateResolutionService — retenção por código de barras (ADR-0069 emenda 1, I16g)', () => {
    const marca = (over: Record<string, unknown> = {}) => ({
        id: 'B9',
        ...CHAVE,
        motivo: 'Boleto repetido',
        origem: 'CODIGO_BARRAS_REPETIDO',
        estado: 'ATIVO',
        marcadoPor: 'sistema',
        marcadoEm: '2026-10-14T10:00:00.000Z',
        loteIdOrigem: 'L1',
        codigoMascarado: '34191…5555',
        tituloMantido: { filCod: 4, docCod: '6170', titCod: '1' },
        ...over,
    });

    it('desfazer sem motivo é recusado (400) também para a marca por código de barras', async () => {
        const h = build();
        h.bloqueioRepo.findAtivo.mockResolvedValue(marca());
        await expect(
            h.service.desfazerBloqueio({ chave: CHAVE, motivo: '   ', ator: 'ana' }),
        ).rejects.toMatchObject({ statusCode: 400 });
        expect(h.bloqueioRepo.desfazer).not.toHaveBeenCalled();
    });

    it('desfazer com motivo: DESFEITO pelo mesmo caminho/permissão/auditoria; não troca o item que ficou', async () => {
        const h = build();
        h.bloqueioRepo.findAtivo.mockResolvedValue(marca());
        h.ledger.listByLote.mockResolvedValue([
            { dryRun: false, status: 'settled', erroMensagem: undefined },
        ]);
        const r = await h.service.desfazerBloqueio({
            chave: CHAVE,
            motivo: 'boleto corrigido no fin124',
            ator: 'ana',
        });
        expect(r).toMatchObject({ estado: 'DESFEITO' });
        expect(h.bloqueioRepo.desfazer).toHaveBeenCalledWith({
            chave: CHAVE,
            motivo: 'boleto corrigido no fin124',
            ator: 'ana',
        });
        // Nada no lote local nem no ERP: desfazer só devolve o título ao pool.
        expect(h.loteRepo.removerItem).not.toHaveBeenCalled();
    });

    it('Q10: recusa desfazer enquanto a limpeza do rascunho do lote de origem está pendente', async () => {
        const h = build();
        h.bloqueioRepo.findAtivo.mockResolvedValue(marca());
        h.ledger.listByLote.mockResolvedValue([
            {
                dryRun: false,
                status: 'error',
                erroMensagem: 'LIMPEZA_CODIGO_REPETIDO_INCOMPLETA: 1 item(s) pending removal',
            },
        ]);
        await expect(
            h.service.desfazerBloqueio({ chave: CHAVE, motivo: 'x', ator: 'ana' }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'RESOLUCAO_DUPLICIDADE_LIMPEZA_PENDENTE',
        });
        expect(h.bloqueioRepo.desfazer).not.toHaveBeenCalled();
    });

    it('Q10: recusa desfazer com a execução mais recente ainda reconciling (limpeza em voo)', async () => {
        const h = build();
        h.bloqueioRepo.findAtivo.mockResolvedValue(marca());
        h.ledger.listByLote.mockResolvedValue([
            { dryRun: false, status: 'reconciling', erroMensagem: undefined },
            { dryRun: false, status: 'settled' },
        ]);
        await expect(
            h.service.desfazerBloqueio({ chave: CHAVE, motivo: 'x', ator: 'ana' }),
        ).rejects.toMatchObject({
            statusCode: 409,
            code: 'RESOLUCAO_DUPLICIDADE_LIMPEZA_PENDENTE',
        });
        expect(h.bloqueioRepo.desfazer).not.toHaveBeenCalled();
    });

    it('Q10: reconciling de dry-run ou ledger settled/success permite desfazer', async () => {
        const h = build();
        h.bloqueioRepo.findAtivo.mockResolvedValue(marca());
        h.ledger.listByLote.mockResolvedValue([
            { dryRun: true, status: 'reconciling' },
            { dryRun: false, status: 'settled' },
        ]);
        await h.service.desfazerBloqueio({ chave: CHAVE, motivo: 'x', ator: 'ana' });
        expect(h.bloqueioRepo.desfazer).toHaveBeenCalledTimes(1);
    });

    it('Q10: execução mais recente concluída ou dry-run não trava o desfazer', async () => {
        const h = build();
        h.bloqueioRepo.findAtivo.mockResolvedValue(marca());
        h.ledger.listByLote.mockResolvedValue([
            { dryRun: true, status: 'error', erroMensagem: 'LIMPEZA_CODIGO_REPETIDO_INCOMPLETA' },
            { dryRun: false, status: 'settled' },
        ]);
        await h.service.desfazerBloqueio({ chave: CHAVE, motivo: 'x', ator: 'ana' });
        expect(h.bloqueioRepo.desfazer).toHaveBeenCalled();
    });

    it('marca por duplicidade de título não consulta o ledger (comportamento histórico)', async () => {
        const h = build();
        h.bloqueioRepo.findAtivo.mockResolvedValue(marca({ origem: 'DUPLICIDADE_TITULO' }));
        await h.service.desfazerBloqueio({ chave: CHAVE, motivo: 'x', ator: 'ana' });
        expect(h.ledger.listByLote).not.toHaveBeenCalled();
    });

    it('listarRetidosPorCodigoDeBarras pede as origens de código de barras (repetido, ilegível e vínculo falho)', async () => {
        const h = build();
        await h.service.listarRetidosPorCodigoDeBarras();
        expect(h.bloqueioRepo.listAtivosPorOrigemComTitulo).toHaveBeenCalledWith([
            'CODIGO_BARRAS_REPETIDO',
            'CODIGO_BARRAS_ILEGIVEL',
            // ADR-0071: o título que saiu do lote porque o vínculo falhou também fica retido.
            'VINCULO_CODIGO_BARRAS_FALHOU',
        ]);
    });

    it('listarRetiradasDoLote lê da trilha do lote', async () => {
        const h = build();
        await h.service.listarRetiradasDoLote('L1');
        expect(h.eventos.listarRetiradasPorCodigoBarras).toHaveBeenCalledWith('L1');
    });
});

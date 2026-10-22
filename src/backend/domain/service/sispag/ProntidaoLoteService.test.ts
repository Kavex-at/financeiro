import 'reflect-metadata';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type LogService from '../LogService.js';
import ProntidaoLoteResolver from './ProntidaoLoteResolver.js';
import ProntidaoLoteService from './ProntidaoLoteService.js';
import type SituacaoPagamentoService from './SituacaoPagamentoService.js';

const item = (loteId: string, titCod: string): ItemLote => ({
    loteId,
    filCod: 2,
    docCod: '100',
    titCod,
    valor: 100,
    modalidade: 'BOLETO',
    incluidoPor: 'ana',
    divergencia: false,
});

const lote = (id: string, status: LotePagamento['status'], itens: ItemLote[]): LotePagamento => ({
    id,
    filCod: 2,
    conta: '55795-4',
    status,
    criadoPor: 'ana',
    versao: 1,
    itens,
});

const make = (
    over: { avaliarGravados?: jest.Mock; ajustes?: jest.Mock } = {},
): {
    service: ProntidaoLoteService;
    situacao: { avaliarGravados: jest.Mock };
    log: { warn: jest.Mock };
} => {
    const situacao = {
        avaliarGravados:
            over.avaliarGravados ??
            jest.fn(async (chaves: Array<{ filCod: number; docCod: string; titCod: string }>) => ({
                situacoes: new Map(
                    chaves.map((c) => [
                        `${c.filCod}:${c.docCod}:${c.titCod}`,
                        { estado: 'PRONTO', motivos: [] },
                    ]),
                ),
                fontesIndisponiveis: [],
            })),
    };
    const repo = {
        titulosComAjusteNaoTerminalNosLotes: over.ajustes ?? jest.fn().mockResolvedValue([]),
    };
    const log = { warn: jest.fn().mockResolvedValue(undefined) };
    const service = new ProntidaoLoteService(
        new ProntidaoLoteResolver(),
        situacao as unknown as SituacaoPagamentoService,
        repo as unknown as LotePagamentoRepository,
        log as unknown as LogService,
    );
    return { service, situacao, log };
};

describe('ProntidaoLoteService (ADR-0076, I20a)', () => {
    it('anexa `prontidao` só aos RASCUNHO, com UMA avaliação para todos os itens', async () => {
        const { service, situacao } = make();
        const r = await service.comProntidao([
            lote('L1', 'RASCUNHO', [item('L1', '1')]),
            lote('L2', 'FINALIZADO', [item('L2', '2')]),
            lote('L3', 'RASCUNHO', [item('L3', '3')]),
        ]);
        expect(r.map((l) => l.prontidao?.estado)).toEqual(['PRONTO', undefined, 'PRONTO']);
        expect(situacao.avaliarGravados).toHaveBeenCalledTimes(1);
        expect(situacao.avaliarGravados.mock.calls[0]?.[0]).toHaveLength(2);
    });

    it('o ajuste em andamento vale só para o lote em que o item está', async () => {
        const ajustes = jest
            .fn()
            .mockResolvedValue([{ loteId: 'L1', filCod: 2, docCod: '100', titCod: '1' }]);
        const { service } = make({ ajustes });
        const [l1, l3] = await service.comProntidao([
            lote('L1', 'RASCUNHO', [item('L1', '1')]),
            lote('L3', 'RASCUNHO', [item('L3', '1')]),
        ]);
        expect(l1?.prontidao?.pendencias.map((p) => p.codigo)).toEqual(['AJUSTE_EM_ANDAMENTO']);
        expect(l3?.prontidao?.estado).toBe('PRONTO');
        expect(ajustes).toHaveBeenCalledWith(['L1', 'L3']);
    });

    it('sem RASCUNHO não consulta nada', async () => {
        const { service, situacao } = make();
        await service.comProntidao([lote('L2', 'FINALIZADO', [item('L2', '2')])]);
        expect(situacao.avaliarGravados).not.toHaveBeenCalled();
    });

    it('falha ao montar o contexto: a lista sai sem `prontidao`, com WARN, e não quebra', async () => {
        const { service, log } = make({
            avaliarGravados: jest.fn().mockRejectedValue(new Error('pool esgotado')),
        });
        const lotes = [lote('L1', 'RASCUNHO', [item('L1', '1')])];
        const r = await service.comProntidao(lotes);
        expect(r[0]?.prontidao).toBeUndefined();
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: expect.stringContaining('prontidão') }),
        );
    });
});

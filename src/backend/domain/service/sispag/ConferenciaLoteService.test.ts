import 'reflect-metadata';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import ReturnReasonRequiredError from '../../errors/ReturnReasonRequiredError.js';
import SelfConferenceError from '../../errors/SelfConferenceError.js';
import type { ItemLote, LotePagamento } from '../../interface/sispag/SispagInterface.js';
import ConferenciaLoteRule from '../../libs/sispag/ConferenciaLoteRule.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type LogService from '../LogService.js';
import ConferenciaLoteService from './ConferenciaLoteService.js';
import type LotePagamentoService from './LotePagamentoService.js';

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L1',
    filCod: 2,
    docCod: '100',
    titCod: '1',
    modalidade: 'TED',
    incluidoPor: 'cron-formacao',
    divergencia: false,
    ...over,
});

const lote = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L1',
    filCod: 2,
    status: 'FINALIZADO',
    criadoPor: 'cron-formacao',
    finalizadoPor: 'ana',
    automatico: true,
    versao: 4,
    itens: [item()],
    ...over,
});

const build = (l: LotePagamento = lote()) => {
    const repo = {
        getLoteComItens: jest.fn().mockResolvedValue(l),
        conferir: jest.fn().mockResolvedValue(1),
        devolver: jest.fn().mockResolvedValue(1),
    };
    const lotes = { getLote: jest.fn().mockResolvedValue({ ...l, conferidoPor: 'bia' }) };
    const log = { info: jest.fn() };
    const service = new ConferenciaLoteService(
        repo as unknown as LotePagamentoRepository,
        new ConferenciaLoteRule(),
        lotes as unknown as LotePagamentoService,
        log as unknown as LogService,
    );
    return { service, repo, lotes, log };
};

describe('ConferenciaLoteService.conferirLote (L12)', () => {
    it('segunda pessoa confere: grava com versão (repo bumpa e audita)', async () => {
        const h = build();
        const r = await h.service.conferirLote({ loteId: 'L1', versao: 4, ator: 'bia' });
        expect(h.repo.conferir).toHaveBeenCalledWith({
            loteId: 'L1',
            versaoEsperada: 4,
            ator: 'bia',
        });
        expect(r.conferidoPor).toBe('bia');
        expect(h.log.info.mock.calls[0]?.[0].message).toMatch(/conferido/);
    });

    it.each([
        ['quem finalizou', lote(), 'ana'],
        ['quem incluiu item', lote({ itens: [item({ incluidoPor: 'caio' })] }), 'caio'],
        ['quem montou lote manual', lote({ automatico: false, criadoPor: 'dani' }), 'dani'],
    ])('%s → SelfConferenceError (403), nada gravado', async (_n, l, ator) => {
        const h = build(l);
        await expect(
            h.service.conferirLote({ loteId: 'L1', versao: 4, ator }),
        ).rejects.toBeInstanceOf(SelfConferenceError);
        expect(h.repo.conferir).not.toHaveBeenCalled();
    });

    it.each([
        ['RASCUNHO', lote({ status: 'RASCUNHO' })],
        ['lote só de boleto', lote({ itens: [item({ modalidade: 'BOLETO' })] })],
        ['já conferido', lote({ conferidoPor: 'eva' })],
    ])('%s → LoteEstadoInvalidoError', async (_n, l) => {
        const h = build(l);
        await expect(
            h.service.conferirLote({ loteId: 'L1', versao: 4, ator: 'bia' }),
        ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
        expect(h.repo.conferir).not.toHaveBeenCalled();
    });

    it('zero linhas com versão diferente → LoteVersaoConflitoError', async () => {
        const h = build();
        h.repo.conferir.mockResolvedValue(0);
        h.repo.getLoteComItens
            .mockResolvedValueOnce(lote())
            .mockResolvedValueOnce(lote({ versao: 5 }));
        await expect(
            h.service.conferirLote({ loteId: 'L1', versao: 4, ator: 'bia' }),
        ).rejects.toBeInstanceOf(LoteVersaoConflitoError);
    });

    it('zero linhas com mesma versão → LoteEstadoInvalidoError', async () => {
        const h = build();
        h.repo.conferir.mockResolvedValue(0);
        await expect(
            h.service.conferirLote({ loteId: 'L1', versao: 4, ator: 'bia' }),
        ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
    });
});

describe('ConferenciaLoteService.devolverLote (L13)', () => {
    it('devolve com motivo (aparado)', async () => {
        const h = build();
        await h.service.devolverLote({
            loteId: 'L1',
            versao: 4,
            ator: 'bia',
            motivo: '  conta errada ',
        });
        expect(h.repo.devolver).toHaveBeenCalledWith({
            loteId: 'L1',
            versaoEsperada: 4,
            ator: 'bia',
            motivo: 'conta errada',
        });
    });

    it('motivo vazio → ReturnReasonRequiredError (400)', async () => {
        const h = build();
        const err = await h.service
            .devolverLote({ loteId: 'L1', versao: 4, ator: 'bia', motivo: '   ' })
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ReturnReasonRequiredError);
        expect(err).toMatchObject({ statusCode: 400 });
        expect(h.repo.devolver).not.toHaveBeenCalled();
    });

    it('mesmas restrições de pessoa: quem finalizou não devolve', async () => {
        const h = build();
        await expect(
            h.service.devolverLote({ loteId: 'L1', versao: 4, ator: 'ana', motivo: 'x' }),
        ).rejects.toBeInstanceOf(SelfConferenceError);
    });

    it('só FINALIZADO', async () => {
        const h = build(lote({ status: 'REMESSA_GERADA' }));
        await expect(
            h.service.devolverLote({ loteId: 'L1', versao: 4, ator: 'bia', motivo: 'x' }),
        ).rejects.toBeInstanceOf(LoteEstadoInvalidoError);
    });
});

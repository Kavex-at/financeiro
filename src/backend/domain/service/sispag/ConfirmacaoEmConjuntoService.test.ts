import 'reflect-metadata';
import BatchConfirmationTooLargeError from '../../errors/BatchConfirmationTooLargeError.js';
import BoletoSuggestionNotAvailableError from '../../errors/BoletoSuggestionNotAvailableError.js';
import TitleSuggestionNotFoundError from '../../errors/TitleSuggestionNotFoundError.js';
import { CONFIRMACAO_CONJUNTO_MAXIMO } from '../../interface/sispag/ConfirmacaoEmConjunto.js';
import type { DesfechoTitulo } from '../../interface/sispag/SugestaoBoleto.js';
import ConfirmacaoEmConjuntoService from './ConfirmacaoEmConjuntoService.js';

// I15t (ADR-0080): a orquestração do conjunto. A regra (RegraIrmaosConjunto) e o confirmar têm testes
// próprios; aqui só o que é do conjunto: linha a linha, teto, lote finalizado, trilha e fila do ajuste.

const ORIGEM = { filCod: 2, docCod: '40100', titCod: '1' };
const linha = (docCod: string, ditCod = Number(docCod)) => ({
    filCod: 2,
    docCod,
    titCod: '1',
    ddcCod: 900,
    ditCod,
});

const desfecho = (docCod: string, over: Partial<DesfechoTitulo> = {}): DesfechoTitulo => ({
    filCod: 2,
    docCod,
    titCod: '1',
    pesCod: '387',
    valorTitulo: 647.56,
    vencimentoTitulo: '2026-10-27',
    dataDebito: '2026-10-27',
    situacao: 'UNICA_SEGURA',
    candidatos: [],
    totalCandidatos: 0,
    motivo: '',
    ...over,
});

const CENARIO = { desfechos: [], pares: [], datasDebito: new Map<string, string>() };

const montar = () => {
    const ordem: string[] = [];
    const sugestoes = {
        desfechosEmCache: jest.fn(async (): Promise<DesfechoTitulo[]> => []),
        cenarioParaConjunto: jest.fn(async () => CENARIO),
        confirmar: jest.fn(async (i: { docCod: string }) => {
            ordem.push(`inicio:${i.docCod}`);
            await new Promise((r) => setImmediate(r));
            ordem.push(`fim:${i.docCod}`);
            return { criada: true, decisao: { id: `dec-${i.docCod}` } };
        }),
    };
    const regra = { irmaos: jest.fn(() => []) };
    const tituloRepo = {
        buscarPorChave: jest.fn(async () => ({ ...ORIGEM, pesCod: '387' }) as unknown),
    };
    const loteRepo = {
        listTitulosEmLotesAbertos: jest.fn(
            async (): Promise<
                Array<{ filCod: number; docCod: string; titCod: string; status: string }>
            > => [],
        ),
    };
    const boletoRepo = { listBoletos: jest.fn(async () => []) };
    const ajuste = { agendarEmSequencia: jest.fn() };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ConfirmacaoEmConjuntoService(
        sugestoes as never,
        regra as never,
        tituloRepo as never,
        loteRepo as never,
        boletoRepo as never,
        ajuste as never,
        logService as never,
    );
    return {
        service,
        sugestoes,
        regra,
        tituloRepo,
        loteRepo,
        boletoRepo,
        ajuste,
        logService,
        ordem,
    };
};

describe('ConfirmacaoEmConjuntoService.confirmarEmConjunto (I15t(2)–(4), (6), (7))', () => {
    it('confirma linha a linha, em sequência, com o mesmo contexto de conjunto', async () => {
        const h = montar();
        const r = await h.service.confirmarEmConjunto({
            origem: ORIGEM,
            itens: [linha('40100'), linha('40107'), linha('40111')],
            ator: 'ana',
        });
        expect(h.ordem).toEqual([
            'inicio:40100',
            'fim:40100',
            'inicio:40107',
            'fim:40107',
            'inicio:40111',
            'fim:40111',
        ]);
        const contextos = h.sugestoes.confirmar.mock.calls.map(
            ([i]) => (i as unknown as { conjunto: { id: string; pesCod: string } }).conjunto,
        );
        expect(new Set(contextos.map((c) => c.id)).size).toBe(1);
        expect(contextos[0]).toMatchObject({ id: r.conjuntoId, pesCod: '387', origem: ORIGEM });
        expect(h.sugestoes.confirmar.mock.calls[0]?.[0]).toMatchObject({ ator: 'ana' });
        expect(r).toMatchObject({ confirmadas: 3, recusadas: 0 });
        expect(r.resultados.map((x) => x.status)).toEqual([
            'CONFIRMADA',
            'CONFIRMADA',
            'CONFIRMADA',
        ]);
    });

    it('o credor do conjunto vem da carteira, não do cliente', async () => {
        const h = montar();
        h.tituloRepo.buscarPorChave.mockResolvedValueOnce({ ...ORIGEM, pesCod: '555' });
        await h.service.confirmarEmConjunto({
            origem: ORIGEM,
            itens: [linha('40100')],
            ator: 'ana',
        });
        expect(h.sugestoes.confirmar.mock.calls[0]?.[0]).toMatchObject({
            conjunto: { pesCod: '555' },
        });
    });

    it('falha parcial: cada linha tem o seu resultado e as outras seguem', async () => {
        const h = montar();
        h.sugestoes.confirmar
            .mockImplementationOnce(async () => ({ criada: true, decisao: { id: 'dec-a' } }))
            .mockImplementationOnce(async () => {
                throw new BoletoSuggestionNotAvailableError({
                    ...linha('40107'),
                    motivo: 'O boleto não foi escolhido pelo número do documento: confirme este título sozinho.',
                });
            })
            .mockImplementationOnce(async () => ({ criada: false, decisao: { id: 'dec-c' } }))
            .mockImplementationOnce(async () => {
                throw new Error('connection reset');
            })
            .mockImplementationOnce(async () => ({ criada: true, decisao: { id: 'dec-e' } }));
        const r = await h.service.confirmarEmConjunto({
            origem: ORIGEM,
            itens: ['40100', '40107', '40111', '40115', '40120'].map((d) => linha(d)),
            ator: 'ana',
        });
        expect(r.resultados.map((x) => x.status)).toEqual([
            'CONFIRMADA',
            'RECUSADA',
            'JA_CONFIRMADA',
            'RECUSADA',
            'CONFIRMADA',
        ]);
        expect(r.resultados[1]?.motivo).toMatch(/número do documento/);
        expect(r.resultados[3]?.motivo).toBe(
            'Não foi possível confirmar este título agora. Tente de novo.',
        );
        expect(JSON.stringify(r)).not.toContain('connection reset');
        expect(h.logService.error).toHaveBeenCalledTimes(1);
        expect(r).toMatchObject({ confirmadas: 3, recusadas: 2 });
        // Ajuste: só as decisões NOVAS, uma fila só, depois da última linha.
        expect(h.ajuste.agendarEmSequencia).toHaveBeenCalledTimes(1);
        expect(h.ajuste.agendarEmSequencia).toHaveBeenCalledWith([
            { filCod: 2, docCod: '40100', titCod: '1', decisaoId: 'dec-a' },
            { filCod: 2, docCod: '40120', titCod: '1', decisaoId: 'dec-e' },
        ]);
    });

    it(`acima de ${CONFIRMACAO_CONJUNTO_MAXIMO} linhas: 422 e nada confirmado`, async () => {
        const h = montar();
        const itens = Array.from({ length: CONFIRMACAO_CONJUNTO_MAXIMO + 1 }, (_, i) =>
            linha(String(41000 + i)),
        );
        await expect(
            h.service.confirmarEmConjunto({ origem: ORIGEM, itens, ator: 'ana' }),
        ).rejects.toBeInstanceOf(BatchConfirmationTooLargeError);
        expect(h.sugestoes.confirmar).not.toHaveBeenCalled();
        expect(h.ajuste.agendarEmSequencia).not.toHaveBeenCalled();
    });

    it('linhas repetidas contam uma vez (no teto e na confirmação)', async () => {
        const h = montar();
        const itens = [
            ...Array.from({ length: CONFIRMACAO_CONJUNTO_MAXIMO }, (_, i) =>
                linha(String(41000 + i)),
            ),
            linha('41000'),
        ];
        const r = await h.service.confirmarEmConjunto({ origem: ORIGEM, itens, ator: 'ana' });
        expect(h.sugestoes.confirmar).toHaveBeenCalledTimes(CONFIRMACAO_CONJUNTO_MAXIMO);
        expect(r.resultados).toHaveLength(CONFIRMACAO_CONJUNTO_MAXIMO);
    });

    it('título em lote local finalizado: recusado sem chamar o confirmar', async () => {
        const h = montar();
        h.loteRepo.listTitulosEmLotesAbertos.mockResolvedValue([
            { filCod: 2, docCod: '40107', titCod: '1', status: 'REMESSA_GERADA' },
            { filCod: 2, docCod: '40111', titCod: '1', status: 'RASCUNHO' },
        ]);
        const r = await h.service.confirmarEmConjunto({
            origem: ORIGEM,
            itens: [linha('40107'), linha('40111')],
            ator: 'ana',
        });
        expect(r.resultados.map((x) => x.status)).toEqual(['RECUSADA', 'CONFIRMADA']);
        expect(r.resultados[0]?.motivo).toMatch(/lote já finalizado/);
        expect(h.sugestoes.confirmar).toHaveBeenCalledTimes(1);
    });

    it('linha de outra filial: recusada sem chamar o confirmar', async () => {
        const h = montar();
        const r = await h.service.confirmarEmConjunto({
            origem: ORIGEM,
            itens: [{ ...linha('40107'), filCod: 3 }],
            ator: 'ana',
        });
        expect(r.resultados[0]).toMatchObject({ status: 'RECUSADA' });
        expect(r.resultados[0]?.motivo).toMatch(/outra filial/);
        expect(h.sugestoes.confirmar).not.toHaveBeenCalled();
    });

    it('título de origem fora da carteira: 404 e nada confirmado', async () => {
        const h = montar();
        h.tituloRepo.buscarPorChave.mockResolvedValueOnce(null);
        await expect(
            h.service.confirmarEmConjunto({ origem: ORIGEM, itens: [linha('40100')], ator: 'ana' }),
        ).rejects.toBeInstanceOf(TitleSuggestionNotFoundError);
        expect(h.sugestoes.confirmar).not.toHaveBeenCalled();
    });

    it('loga o conjunto uma vez, em português, sem código de barras', async () => {
        const h = montar();
        await h.service.confirmarEmConjunto({
            origem: ORIGEM,
            itens: [linha('40100')],
            ator: 'ana',
        });
        expect(h.logService.info).toHaveBeenCalledTimes(1);
        expect(h.logService.info.mock.calls[0]?.[0]).toMatchObject({
            message: 'confirmação em conjunto concluída',
            data: { pedidas: 1, confirmadas: 1, novas: 1, recusadas: 0, ator: 'ana' },
        });
    });
});

describe('ConfirmacaoEmConjuntoService.listarIrmaos (I15t(1))', () => {
    it('origem sem desfecho: 404', async () => {
        const h = montar();
        await expect(h.service.listarIrmaos(ORIGEM)).rejects.toBeInstanceOf(
            TitleSuggestionNotFoundError,
        );
    });

    it('entrega à regra só o credor e a filial da origem, e os lotes finalizados', async () => {
        const h = montar();
        h.sugestoes.desfechosEmCache.mockResolvedValue([
            desfecho('40100', {
                candidatos: [{ vencimentoBoleto: '2026-10-27' } as never],
            }),
            desfecho('40107', { candidatos: [{ vencimentoBoleto: '2026-10-25' } as never] }),
            desfecho('50000', { pesCod: '999' }),
            desfecho('60000', { filCod: 3 }),
        ]);
        h.loteRepo.listTitulosEmLotesAbertos.mockResolvedValue([
            { filCod: 2, docCod: '40107', titCod: '1', status: 'FINALIZADO' },
            { filCod: 2, docCod: '40111', titCod: '1', status: 'RASCUNHO' },
        ]);
        const r = await h.service.listarIrmaos(ORIGEM);
        expect(r).toMatchObject({
            origem: ORIGEM,
            maximo: CONFIRMACAO_CONJUNTO_MAXIMO,
            irmaos: [],
        });
        const entrada = (h.regra.irmaos.mock.calls[0] as unknown as [Record<string, unknown>])[0];
        expect((entrada.desfechos as DesfechoTitulo[]).map((d) => d.docCod)).toEqual([
            '40100',
            '40107',
        ]);
        expect([...(entrada.emLoteFinalizado as Set<string>)]).toEqual(['2:40107:1']);
        expect(entrada.origem).toEqual({ ...ORIGEM, pesCod: '387' });
        expect(h.boletoRepo.listBoletos).toHaveBeenCalledWith({ vencimentoDesde: '2026-10-25' });
    });

    it('origem sem credor identificado: lista vazia', async () => {
        const h = montar();
        h.sugestoes.desfechosEmCache.mockResolvedValue([desfecho('40100', { pesCod: undefined })]);
        const r = await h.service.listarIrmaos(ORIGEM);
        expect(r.irmaos).toEqual([]);
        expect(h.regra.irmaos).not.toHaveBeenCalled();
    });
});

describe('ConfirmacaoEmConjuntoService — um cenário por conjunto (I15t(4))', () => {
    it('recalcula o cenário UMA vez e o passa a cada linha', async () => {
        const h = montar();
        await h.service.confirmarEmConjunto({
            origem: ORIGEM,
            itens: [linha('40100'), linha('40107'), linha('40111')],
            ator: 'ana',
        });
        expect(h.sugestoes.cenarioParaConjunto).toHaveBeenCalledTimes(1);
        expect(h.sugestoes.confirmar.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
            CENARIO,
            CENARIO,
            CENARIO,
        ]);
    });
});

import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type ConexosSispagClient from '../../client/ConexosSispagClient.js';
import type ConexosSispagRetornoClient from '../../client/ConexosSispagRetornoClient.js';
import type ConexosTitulosClient from '../../client/ConexosTitulosClient.js';
import LoteEstadoInvalidoError from '../../errors/LoteEstadoInvalidoError.js';
import LoteVersaoConflitoError from '../../errors/LoteVersaoConflitoError.js';
import type {
    ItemLote,
    LeituraBaixas,
    LeituraTitulo,
    LotePagamento,
} from '../../interface/sispag/SispagInterface.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type LogService from '../LogService.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import DecisaoStatusLote from './DecisaoStatusLote.js';
import SincronizacaoLoteService from './SincronizacaoLoteService.js';

/**
 * L11 `sincronizarStatus` ponta a ponta com mocks (ADR-0055, T1–T8). O caso real é o
 * PG230901.REM: fil 2/flp 24 (38682/1, baixa manual no borderô 22320) e fil 1/flp 8 (4030/7),
 * Itaú (bnc 4), retorno gar 9 processado nativamente só com BD, gar 10 carregado e nunca processado.
 */

const AGORA = new Date('2026-09-29T14:35:00.000Z');
const ANTES = '2026-09-28T14:35:00.000Z';

const item = (over: Partial<ItemLote> = {}): ItemLote => ({
    loteId: 'L-fil2',
    filCod: 2,
    docCod: '38682',
    titCod: '1',
    incluidoPor: 'u1',
    divergencia: false,
    ...over,
});

const loteFil2 = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L-fil2',
    filCod: 2,
    status: 'REMESSA_GERADA',
    criadoPor: 'u1',
    versao: 5,
    nativeFilCod: 2,
    nativeBncCod: 4,
    nativeFlpCod: 24,
    remessaGeradaEm: '2026-09-23T15:00:00.000Z',
    itens: [item()],
    ...over,
});

const loteFil1 = (over: Partial<LotePagamento> = {}): LotePagamento => ({
    id: 'L-fil1',
    filCod: 1,
    status: 'REMESSA_GERADA',
    criadoPor: 'u1',
    versao: 3,
    nativeFilCod: 1,
    nativeBncCod: 4,
    nativeFlpCod: 8,
    remessaGeradaEm: '2026-09-23T15:00:00.000Z',
    itens: [item({ loteId: 'L-fil1', filCod: 1, docCod: '4030', titCod: '7' })],
    ...over,
});

const pago: LeituraTitulo = { legivel: true, vldPago: true, aberto: 0, valorPagoTitulo: 275 };
const aberto: LeituraTitulo = { legivel: true, vldPago: false, aberto: 1856.16 };
const baixas22320: LeituraBaixas = {
    legivel: true,
    baixas: [
        {
            borCod: 22320,
            bxaCodSeq: 1,
            data: '2026-09-24T15:00:00.000Z',
            usuario: 'ERICA_VIANA',
            valor: 275,
        },
    ],
};

const GAR9_PROCESSADO = {
    filCod: 1,
    bncCod: 4,
    gtbCodSeq: 3,
    garCodSeq: 9,
    cadastradoEm: Date.parse('2026-09-24T11:30:00.000Z'),
    processadoEm: Date.parse('2026-09-24T11:33:00.000Z'),
};
const GAR10_SO_CARREGADO = {
    filCod: 1,
    bncCod: 4,
    gtbCodSeq: 3,
    garCodSeq: 10,
    cadastradoEm: Date.parse('2026-09-25T11:30:00.000Z'),
};

/** Linhas de detalhe do gar 9 (arquivo que MISTURA filiais) para o evento BD. */
const linhasBdGar9 = [
    {
        filCod: 1,
        bncCod: 4,
        gtbCodSeq: 3,
        garCodSeq: 9,
        flpCod: 8,
        docCod: '4030',
        titCod: '7',
        eventoCod: 'BD',
        eventoDescricao: 'PAGAMENTO AGENDADO',
    },
    {
        filCod: 2,
        bncCod: 4,
        gtbCodSeq: 3,
        garCodSeq: 9,
        flpCod: 24,
        docCod: '38682',
        titCod: '1',
        eventoCod: 'BD',
        eventoDescricao: 'PAGAMENTO AGENDADO',
    },
];

interface Setup {
    lotes: LotePagamento[];
    titulos?: Record<string, LeituraTitulo>;
    baixas?: LeituraBaixas;
    detalhe?: (p: { garCodSeq: number; eventoCod: string }) => unknown[];
}

const setup = ({ lotes, titulos = {}, baixas = baixas22320, detalhe }: Setup) => {
    const porId = new Map(lotes.map((l) => [l.id, l]));
    const loteRepo = {
        getLoteComItens: jest.fn(async (id: string) => porId.get(id) ?? null),
        listLotesSincronizaveis: jest.fn(async () => lotes.map((l) => l.id)),
        aplicarSincronizacao: jest.fn().mockResolvedValue('APLICADO'),
        tocarSincronizacao: jest.fn().mockResolvedValue(undefined),
    };
    const sispag = {
        lerSituacaoTitulo: jest.fn(
            async (filCod: number, docCod: string, titCod: string): Promise<LeituraTitulo> =>
                titulos[`${filCod}:${docCod}:${titCod}`] ?? aberto,
        ),
    };
    const titulosClient = { lerBaixasTitulo: jest.fn().mockResolvedValue(baixas) };
    const retorno = {
        listConfigsRetorno: jest.fn().mockResolvedValue([{ bncCod: 4, gtbCodSeq: 3 }]),
        listArquivosRetorno: jest.fn().mockResolvedValue([GAR9_PROCESSADO, GAR10_SO_CARREGADO]),
        listEventosBancarios: jest.fn().mockResolvedValue([
            { cod: 'BD', descricao: 'PAGAMENTO AGENDADO', tipo: 2, tipoRetorno: 1 },
            { cod: '00', descricao: 'PAGAMENTO EFETUADO', tipo: 2, tipoRetorno: 1 },
            { cod: 'AE', descricao: 'DATA INVALIDA', tipo: 2, tipoRetorno: 2 },
            { cod: 'ZZ', descricao: 'IRRELEVANTE', tipo: 2, tipoRetorno: 1 },
        ]),
        listDetalhe: jest.fn(async (p: { garCodSeq: number; eventoCod: string }) =>
            detalhe ? detalhe(p) : p.garCodSeq === 9 && p.eventoCod === 'BD' ? linhasBdGar9 : [],
        ),
        processarArquivoRetorno: jest.fn(),
        carregarArquivoRetorno: jest.fn(),
    };
    const notificacao = { emitir: jest.fn().mockResolvedValue(null) };
    const logService = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SincronizacaoLoteService(
        loteRepo as unknown as LotePagamentoRepository,
        sispag as unknown as ConexosSispagClient,
        titulosClient as unknown as ConexosTitulosClient,
        retorno as unknown as ConexosSispagRetornoClient,
        new DecisaoStatusLote(),
        notificacao as unknown as NotificacaoService,
        logService as unknown as LogService,
        new BoundedConcurrency(),
    );
    return { service, loteRepo, sispag, titulosClient, retorno, notificacao, logService };
};

const aplicadoPara = (loteRepo: { aplicarSincronizacao: jest.Mock }, loteId: string) =>
    loteRepo.aplicarSincronizacao.mock.calls.map((c) => c[0]).find((a) => a.loteId === loteId);

describe('SincronizacaoLoteService — T1..T8 (ADR-0055)', () => {
    it('T1: 38682/1 pago no fin064, PSQ_018 borderô 22320 manual, fin052 só BD → BAIXADO', async () => {
        const s = setup({ lotes: [loteFil2()], titulos: { '2:38682:1': pago } });
        const r = await s.service.sincronizarLote('L-fil2', AGORA);
        const aplicado = aplicadoPara(s.loteRepo, 'L-fil2');
        expect(aplicado).toEqual(
            expect.objectContaining({
                versaoEsperada: 5,
                statusAtual: 'REMESSA_GERADA',
                para: 'BAIXADO',
            }),
        );
        expect(aplicado.itens[0]).toEqual(
            expect.objectContaining({
                situacao: 'PAGO',
                borCod: 22320,
                bxaCodSeq: 1,
                origemBaixa: 'FORA_DO_RETORNO',
                baixaFonte: 'TITULO',
                retornoEvento: 'BD',
                valorPago: 275,
                pagoObservadoEm: AGORA.toISOString(),
            }),
        );
        expect(r?.resultado.resultado).toBe('TRANSICIONOU');
        expect(s.titulosClient.lerBaixasTitulo).toHaveBeenCalledWith({
            docCod: '38682',
            titCod: '1',
            filCod: 2,
        });
    });

    it('T2: 4030/7 vldPago=0 + BD → permanece REMESSA_GERADA com item AGENDADO', async () => {
        const s = setup({ lotes: [loteFil1()] });
        await s.service.sincronizarLote('L-fil1', AGORA);
        const aplicado = aplicadoPara(s.loteRepo, 'L-fil1');
        expect(aplicado.para).toBeUndefined();
        expect(aplicado.itens[0]).toEqual(expect.objectContaining({ situacao: 'AGENDADO' }));
        expect(s.notificacao.emitir).not.toHaveBeenCalled();
    });

    it('T2 gêmeo: 4030/7 vldPago=1 → BAIXADO', async () => {
        const s = setup({ lotes: [loteFil1()], titulos: { '1:4030:7': pago } });
        await s.service.sincronizarLote('L-fil1', AGORA);
        expect(aplicadoPara(s.loteRepo, 'L-fil1').para).toBe('BAIXADO');
    });

    it('T3: um único .RET com fil1/flp8 e fil2/flp24 atualiza os dois lotes (filCod da linha)', async () => {
        const s = setup({ lotes: [loteFil1(), loteFil2()] });
        const resumo = await s.service.sincronizarTodos(AGORA);
        expect(aplicadoPara(s.loteRepo, 'L-fil1').itens[0].retornoEvento).toBe('BD');
        expect(aplicadoPara(s.loteRepo, 'L-fil2').itens[0].retornoEvento).toBe('BD');
        expect(resumo.lotes).toBe(2);
    });

    it('só arquivo PROCESSADO dá detalhe: o gar 10 (só carregado) nunca é lido', async () => {
        const s = setup({ lotes: [loteFil1()] });
        await s.service.sincronizarTodos(AGORA);
        const gars = s.retorno.listDetalhe.mock.calls.map((c) => c[0].garCodSeq);
        expect(gars.length).toBeGreaterThan(0);
        expect(gars.every((g: number) => g === 9)).toBe(true);
    });

    it('detalhe só dos códigos que decidem (rejeição, 00, BD) — não varre o cadastro inteiro', async () => {
        const s = setup({ lotes: [loteFil1()] });
        await s.service.sincronizarTodos(AGORA);
        const codigos = s.retorno.listDetalhe.mock.calls.map((c) => c[0].eventoCod).sort();
        expect(codigos).toEqual(['00', 'AE', 'BD']);
    });

    it('T4: duas passadas sem baixa → sem transição, sem versão, sem alerta; só sincronizado_em', async () => {
        const jaSincronizado = loteFil1({
            itens: [
                item({
                    loteId: 'L-fil1',
                    filCod: 1,
                    docCod: '4030',
                    titCod: '7',
                    situacao: 'AGENDADO',
                    retornoEvento: 'BD',
                    retornoDescricao: 'PAGAMENTO AGENDADO',
                    rejeitado: false,
                    sincronizadoEm: ANTES,
                }),
            ],
        });
        const s = setup({ lotes: [jaSincronizado] });
        await s.service.sincronizarTodos(AGORA);
        await s.service.sincronizarTodos(AGORA);
        expect(s.loteRepo.aplicarSincronizacao).not.toHaveBeenCalled();
        expect(s.notificacao.emitir).not.toHaveBeenCalled();
        expect(s.loteRepo.tocarSincronizacao).toHaveBeenCalledTimes(2);
        expect(s.loteRepo.tocarSincronizacao).toHaveBeenCalledWith({
            loteId: 'L-fil1',
            itens: [{ filCod: 1, docCod: '4030', titCod: '7' }],
            em: AGORA.toISOString(),
        });
    });

    it('T5: rejeição (fbeVldTpret=2) num item + outro pago → RETORNADO + Alerta sispag-lote-retornado', async () => {
        const lote = loteFil2({
            itens: [item(), item({ docCod: '38700', titCod: '1' })],
        });
        const s = setup({
            lotes: [lote],
            titulos: { '2:38700:1': pago },
            detalhe: (p) =>
                p.garCodSeq === 9 && p.eventoCod === 'AE'
                    ? [{ ...linhasBdGar9[1], eventoCod: 'AE', eventoDescricao: 'DATA INVALIDA' }]
                    : [],
        });
        await s.service.sincronizarLote('L-fil2', AGORA);
        expect(aplicadoPara(s.loteRepo, 'L-fil2').para).toBe('RETORNADO');
        expect(s.notificacao.emitir).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo: 'sispag-lote-retornado',
                alvo: 'L-fil2',
                janelaInicio: AGORA,
            }),
        );
    });

    it.each([
        ['erro de rede', { legivel: false as const, motivo: 'socket hang up' }],
        ['403', { legivel: false as const, motivo: 'HTTP 403' }],
    ])('T6: fin064 com %s → lote e itens inalterados', async (_n, leitura) => {
        const s = setup({ lotes: [loteFil2()], titulos: { '2:38682:1': leitura } });
        const r = await s.service.sincronizarLote('L-fil2', AGORA);
        expect(s.loteRepo.aplicarSincronizacao).not.toHaveBeenCalled();
        expect(s.loteRepo.tocarSincronizacao).not.toHaveBeenCalled();
        expect(r?.resultado.resultado).toBe('FALHA_LEITURA');
        expect(s.logService.warn).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'leitura do fin064 falhou' }),
        );
        // e um evento POR LOTE, para o operador não reconstruir a falha a partir dos itens
        expect(s.logService.error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'leitura do lote falhou — nenhum título pôde ser lido',
                data: expect.objectContaining({ loteId: 'L-fil2', filCod: 2 }),
            }),
        );
    });

    it('T6: PSQ_018 403 com fin064 pago → ainda BAIXADO, enriquecimento nulo, NAO_IDENTIFICADA', async () => {
        const s = setup({
            lotes: [loteFil2()],
            titulos: { '2:38682:1': pago },
            baixas: { legivel: false, motivo: 'forbidden', status: 403 },
        });
        await s.service.sincronizarLote('L-fil2', AGORA);
        const aplicado = aplicadoPara(s.loteRepo, 'L-fil2');
        expect(aplicado.para).toBe('BAIXADO');
        expect(aplicado.itens[0].origemBaixa).toBe('NAO_IDENTIFICADA');
        expect(aplicado.itens[0].borCod).toBeUndefined();
        expect(aplicado.itens[0].pagoEm).toBeUndefined();
    });

    it('T7 (I11g): o serviço não depende de flag de escrita no ERP — a gravação local acontece', async () => {
        const fonte = readFileSync(path.join(__dirname, 'SincronizacaoLoteService.ts'), 'utf8');
        expect(fonte).not.toMatch(/conexosWriteEnabled|sispagLiveWriteEnabled|conexosDryRun/);
        const s = setup({ lotes: [loteFil2()], titulos: { '2:38682:1': pago } });
        await s.service.sincronizarLote('L-fil2', AGORA);
        expect(s.loteRepo.aplicarSincronizacao).toHaveBeenCalledTimes(1);
    });

    it('T8: lote BAIXADO + título reaberto → sem transição, divergência + Alerta sispag-baixa-divergente', async () => {
        const lote = loteFil2({
            status: 'BAIXADO',
            itens: [item({ situacao: 'PAGO', pagoObservadoEm: ANTES, sincronizadoEm: ANTES })],
        });
        const s = setup({ lotes: [lote] });
        await s.service.sincronizarTodos(AGORA);
        const aplicado = aplicadoPara(s.loteRepo, 'L-fil2');
        expect(aplicado.para).toBeUndefined();
        expect(aplicado.statusAtual).toBe('BAIXADO');
        expect(aplicado.itens[0].divergencia).toBe(true);
        expect(s.notificacao.emitir).toHaveBeenCalledWith(
            expect.objectContaining({ tipo: 'sispag-baixa-divergente', alvo: 'L-fil2' }),
        );
        // lote terminal não precisa do fin052 nem do PSQ_018
        expect(s.retorno.listConfigsRetorno).not.toHaveBeenCalled();
        expect(s.titulosClient.lerBaixasTitulo).not.toHaveBeenCalled();
    });

    it('REJEITADO + título pago → continua REJEITADO, lote RETORNADO, divergência + alerta', async () => {
        const s = setup({
            lotes: [loteFil2()],
            titulos: { '2:38682:1': pago },
            detalhe: (p) =>
                p.eventoCod === 'AE'
                    ? [{ ...linhasBdGar9[1], eventoCod: 'AE', eventoDescricao: 'DATA INVALIDA' }]
                    : [],
        });
        await s.service.sincronizarLote('L-fil2', AGORA);
        const aplicado = aplicadoPara(s.loteRepo, 'L-fil2');
        expect(aplicado.para).toBe('RETORNADO');
        expect(aplicado.itens[0]).toEqual(
            expect.objectContaining({ situacao: 'REJEITADO', divergencia: true }),
        );
        const tipos = s.notificacao.emitir.mock.calls.map((c) => c[0].tipo).sort();
        expect(tipos).toEqual(['sispag-baixa-divergente', 'sispag-lote-retornado']);
    });

    it('I11a: nunca processa, carrega nem baixa nada no ERP', async () => {
        const s = setup({ lotes: [loteFil1(), loteFil2()], titulos: { '2:38682:1': pago } });
        await s.service.sincronizarTodos(AGORA);
        expect(s.retorno.processarArquivoRetorno).not.toHaveBeenCalled();
        expect(s.retorno.carregarArquivoRetorno).not.toHaveBeenCalled();
    });

    it('conflito de versão → lote pulado, os demais seguem', async () => {
        const s = setup({ lotes: [loteFil1(), loteFil2()], titulos: { '2:38682:1': pago } });
        s.loteRepo.aplicarSincronizacao.mockImplementation(async (a: { loteId: string }) =>
            a.loteId === 'L-fil1' ? 'CONFLITO' : 'APLICADO',
        );
        const resumo = await s.service.sincronizarTodos(AGORA);
        const porLote = Object.fromEntries(resumo.resultados.map((r) => [r.loteId, r.resultado]));
        expect(porLote).toEqual({ 'L-fil1': 'PULADO', 'L-fil2': 'TRANSICIONOU' });
        expect(resumo.pulados).toBe(1);
        expect(resumo.transicionados).toBe(1);
    });

    it('sincronizarLote manual com conflito de versão → LoteVersaoConflitoError (409)', async () => {
        const s = setup({ lotes: [loteFil2()], titulos: { '2:38682:1': pago } });
        s.loteRepo.aplicarSincronizacao.mockResolvedValue('CONFLITO');
        await expect(s.service.sincronizarLote('L-fil2', AGORA)).rejects.toBeInstanceOf(
            LoteVersaoConflitoError,
        );
    });

    it('sincronizarLote em lote não sincronizável → LoteEstadoInvalidoError; inexistente → null', async () => {
        const s = setup({ lotes: [loteFil2({ status: 'FINALIZADO' })] });
        await expect(s.service.sincronizarLote('L-fil2', AGORA)).rejects.toBeInstanceOf(
            LoteEstadoInvalidoError,
        );
        expect(await s.service.sincronizarLote('nao-existe', AGORA)).toBeNull();
    });

    it('falha ao ler um código de evento não derruba a passada (e não vira rejeição)', async () => {
        const s = setup({ lotes: [loteFil1()] });
        s.retorno.listDetalhe.mockImplementation(async (p: { eventoCod: string }) => {
            if (p.eventoCod === 'AE') throw new Error('timeout');
            return p.eventoCod === 'BD' ? linhasBdGar9 : [];
        });
        const resumo = await s.service.sincronizarTodos(AGORA);
        expect(aplicadoPara(s.loteRepo, 'L-fil1').itens[0]).toEqual(
            expect.objectContaining({ situacao: 'AGENDADO', rejeitado: false }),
        );
        expect(resumo.eventosNaoLidos).toBe(1);
    });

    it('falha de alerta não derruba a sincronização (já gravada)', async () => {
        const s = setup({
            lotes: [loteFil2()],
            detalhe: (p) =>
                p.eventoCod === 'AE'
                    ? [{ ...linhasBdGar9[1], eventoCod: 'AE', eventoDescricao: 'DATA INVALIDA' }]
                    : [],
        });
        s.notificacao.emitir.mockRejectedValue(new Error('banco fora'));
        const r = await s.service.sincronizarLote('L-fil2', AGORA);
        expect(r?.resultado.resultado).toBe('TRANSICIONOU');
    });
});

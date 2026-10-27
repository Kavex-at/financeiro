import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import type { ItemDecidido } from '../../interface/sispag/SincronizacaoLote.js';
import type { LotePagamento } from '../../interface/sispag/SispagInterface.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type GrupoBoletoRepository from '../../repository/sispag/GrupoBoletoRepository.js';
import type LogService from '../LogService.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import FechamentoGrupoBoleto from './FechamentoGrupoBoleto.js';

/**
 * Fechamento do grupo de boleto depois da sincronização (ADR-0077, I21r): os N `PAGO` ⇒ grupo
 * `PAGO` (terminal, `GRUPO_PAGO`, marcas encerradas); J rejeitado ⇒ `j_rejeitado_em` + `Alerta`
 * `sispag-bordero-grupo-pendente`; parte paga ⇒ evento `GRUPO_DIVERGENTE` (a divergência nos N
 * itens e o alerta `sispag-baixa-divergente` vêm da `DecisaoStatusLote`). Idempotente.
 */

const AGORA = new Date('2026-10-27T14:00:00.000Z');
const MASCARA = '34191…7500';

const itemLote = (docCod: string, grupoBoletoId?: string) => ({
    loteId: 'L1',
    filCod: 2,
    docCod,
    titCod: '1',
    incluidoPor: 'u1',
    divergencia: false,
    ...(grupoBoletoId !== undefined ? { grupoBoletoId } : {}),
});
const lote = (): LotePagamento =>
    ({
        id: 'L1',
        filCod: 2,
        status: 'REMESSA_GERADA',
        itens: [
            itemLote('801'),
            itemLote('901', 'G1'),
            itemLote('902', 'G1'),
            itemLote('903', 'G1'),
        ],
    }) as unknown as LotePagamento;

const decidido = (docCod: string, situacao: string): ItemDecidido =>
    ({
        filCod: 2,
        docCod,
        titCod: '1',
        situacao,
        rejeitado: situacao === 'REJEITADO',
        divergencia: false,
        mudou: true,
        tituloLido: true,
    }) as unknown as ItemDecidido;

const todos = (s901: string, s902: string, s903: string): ItemDecidido[] => [
    decidido('801', 'PAGO'),
    decidido('901', s901),
    decidido('902', s902),
    decidido('903', s903),
];

const make = () => {
    const tx = { tx: true };
    const grupoRepo = {
        marcarPago: jest.fn().mockResolvedValue({ resultado: 'APLICADO' }),
        registrarEvento: jest.fn().mockResolvedValue('ev'),
        buscarPorId: jest.fn().mockResolvedValue({
            id: 'G1',
            filCod: 2,
            codbarMascarado: MASCARA,
            titulos: ['901', '902', '903'].map((docCod) => ({ filCod: 2, docCod, titCod: '1' })),
        }),
    };
    const execRepo = {
        ultimaPorGrupo: jest.fn().mockResolvedValue({
            id: 'E1',
            grupoId: 'G1',
            loteId: 'L1',
            filCod: 2,
            borCod: 252,
            flpCod: 48,
            bncCod: 341,
            etapa: 'importado',
        }),
        marcarJRejeitado: jest.fn().mockResolvedValue(undefined),
        registrarEtapa: jest.fn().mockResolvedValue(true),
    };
    const bloqueios = { encerrarDoGrupo: jest.fn().mockResolvedValue(0) };
    const db = { withTransaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    const notificacao = { emitir: jest.fn().mockResolvedValue(null) };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const service = new FechamentoGrupoBoleto(
        grupoRepo as unknown as GrupoBoletoRepository,
        execRepo as unknown as GrupoBoletoExecucaoRepository,
        bloqueios as unknown as BloqueioDuplicidadeRepository,
        db as unknown as PostgreeDatabaseClient,
        notificacao as unknown as NotificacaoService,
        log as unknown as LogService,
    );
    return { service, grupoRepo, execRepo, bloqueios, db, notificacao, log, tx };
};

describe('FechamentoGrupoBoleto (I21r)', () => {
    it('os N títulos PAGO ⇒ grupo PAGO com a observação, o lote e o borCod, e as marcas encerradas na mesma transação', async () => {
        const h = make();
        await h.service.fechar({
            lote: lote(),
            itens: todos('PAGO', 'PAGO', 'PAGO'),
            agora: AGORA,
        });
        expect(h.grupoRepo.marcarPago).toHaveBeenCalledWith(
            { grupoId: 'G1', observadoEm: AGORA, loteId: 'L1', borCod: 252 },
            h.tx,
        );
        expect(h.bloqueios.encerrarDoGrupo).toHaveBeenCalledWith(
            expect.objectContaining({ grupoId: 'G1', ator: 'sistema' }),
            h.tx,
        );
        expect(h.notificacao.emitir).not.toHaveBeenCalled();
    });

    it('idempotente: grupo já PAGO (JA_APLICADO) não encerra marca nem grava nada de novo', async () => {
        const h = make();
        h.grupoRepo.marcarPago.mockResolvedValue({ resultado: 'JA_APLICADO' });
        await h.service.fechar({
            lote: lote(),
            itens: todos('PAGO', 'PAGO', 'PAGO'),
            agora: AGORA,
        });
        expect(h.bloqueios.encerrarDoGrupo).not.toHaveBeenCalled();
    });

    it('parte paga NÃO fecha o grupo como PAGO (nunca "parcialmente pago")', async () => {
        const h = make();
        await h.service.fechar({
            lote: lote(),
            itens: todos('PAGO', 'PAGO', 'SEM_RETORNO'),
            agora: AGORA,
        });
        expect(h.grupoRepo.marcarPago).not.toHaveBeenCalled();
        expect(h.execRepo.marcarJRejeitado).not.toHaveBeenCalled();
    });

    it('divergência NOVA em título do grupo ⇒ evento GRUPO_DIVERGENTE uma vez por grupo (sem código completo)', async () => {
        const h = make();
        await h.service.fechar({
            lote: lote(),
            itens: todos('PAGO', 'PAGO', 'SEM_RETORNO'),
            divergencias: ['901', '902', '903'].map((docCod) => ({
                chave: { filCod: 2, docCod, titCod: '1' },
                detalhe: 'grupo de boleto parcialmente pago',
            })),
            agora: AGORA,
        });
        const eventos = h.grupoRepo.registrarEvento.mock.calls.filter(
            ([e]) => e.tipo === 'GRUPO_DIVERGENTE',
        );
        expect(eventos).toHaveLength(1);
        expect(eventos[0]?.[0]).toMatchObject({
            grupoId: 'G1',
            loteId: 'L1',
            borCod: 252,
            codigoMascarado: MASCARA,
        });
        expect(JSON.stringify(eventos)).not.toMatch(/\d{44}|\d{47}/);
    });

    it('J rejeitado (os N REJEITADO) ⇒ execução marcada com j_rejeitado_em e Alerta sispag-bordero-grupo-pendente com borCod, filial, títulos e o que fazer', async () => {
        const h = make();
        await h.service.fechar({
            lote: lote(),
            itens: todos('REJEITADO', 'REJEITADO', 'REJEITADO'),
            agora: AGORA,
        });
        expect(h.execRepo.marcarJRejeitado).toHaveBeenCalledWith('E1', AGORA);
        expect(h.notificacao.emitir).toHaveBeenCalledTimes(1);
        const alerta = h.notificacao.emitir.mock.calls[0]?.[0];
        expect(alerta).toMatchObject({
            tipo: 'sispag-bordero-grupo-pendente',
            alvo: 'G1',
            // Janela diária (dedup do `NotificacaoService`): meia-noite de Brasília do dia.
            janelaInicio: new Date('2026-10-27T03:00:00.000Z'),
        });
        expect(alerta.detalhe).toMatchObject({
            grupoId: 'G1',
            borCod: 252,
            filCod: 2,
            codigoMascarado: MASCARA,
        });
        expect(JSON.stringify(alerta.detalhe)).toContain('901/1');
        expect(typeof alerta.detalhe.acao).toBe('string');
        expect(alerta.detalhe.acao).toContain('fin015');
        expect(alerta.detalhe.acao).toContain('48');
        expect(alerta.detalhe.acao).toContain('fin010');
        expect(alerta.detalhe.acao).not.toMatch(/cancele|exclua/);
        expect(JSON.stringify(alerta)).not.toMatch(/\d{44}|\d{47}/);
        // Nenhuma escrita no ERP: só repositórios locais.
        expect(h.grupoRepo.marcarPago).not.toHaveBeenCalled();
    });

    it('a falha do alerta não derruba o fechamento (best-effort), mas fica no log', async () => {
        const h = make();
        h.notificacao.emitir.mockRejectedValue(new Error('sink fora'));
        await expect(
            h.service.fechar({
                lote: lote(),
                itens: todos('REJEITADO', 'REJEITADO', 'REJEITADO'),
                agora: AGORA,
            }),
        ).resolves.toBeUndefined();
        expect(h.execRepo.marcarJRejeitado).toHaveBeenCalled();
        expect(h.log.error).toHaveBeenCalled();
    });

    it('título do grupo não lido nesta passada ⇒ nada decide (I11c)', async () => {
        const h = make();
        const itens = todos('PAGO', 'PAGO', 'PAGO');
        (itens[3] as { tituloLido: boolean }).tituloLido = false;
        await h.service.fechar({ lote: lote(), itens, agora: AGORA });
        expect(h.grupoRepo.marcarPago).not.toHaveBeenCalled();
    });

    it('lote sem grupo de boleto: nenhuma chamada a repositório nenhum', async () => {
        const h = make();
        const l = lote();
        l.itens = [itemLote('801')] as LotePagamento['itens'];
        await h.service.fechar({ lote: l, itens: [decidido('801', 'PAGO')], agora: AGORA });
        expect(h.grupoRepo.marcarPago).not.toHaveBeenCalled();
        expect(h.execRepo.ultimaPorGrupo).not.toHaveBeenCalled();
        expect(h.db.withTransaction).not.toHaveBeenCalled();
    });

    describe('a execução não fica `importado` para sempre (HML v7, 2026-10-27)', () => {
        it('J rejeitado ⇒ marca o J e conclui a execução (importado → codbar_vinculado → concluido), liberando a próxima preparação', async () => {
            const h = make();
            await h.service.fechar({
                lote: lote(),
                itens: todos('REJEITADO', 'REJEITADO', 'REJEITADO'),
                agora: AGORA,
            });
            expect(h.execRepo.marcarJRejeitado).toHaveBeenCalledWith('E1', AGORA);
            expect(h.execRepo.registrarEtapa.mock.calls).toEqual([
                ['E1', 'importado', 'codbar_vinculado'],
                ['E1', 'codbar_vinculado', 'concluido'],
            ]);
        });

        it('pago ⇒ conclui a execução também', async () => {
            const h = make();
            await h.service.fechar({
                lote: lote(),
                itens: todos('PAGO', 'PAGO', 'PAGO'),
                agora: AGORA,
            });
            expect(h.execRepo.registrarEtapa).toHaveBeenCalledTimes(2);
        });

        it('execução de OUTRO lote (remessa posterior) não é marcada nem concluída por passada tardia', async () => {
            const h = make();
            h.execRepo.ultimaPorGrupo.mockResolvedValue({
                id: 'E2',
                grupoId: 'G1',
                loteId: 'L9',
                filCod: 2,
                etapa: 'importado',
            });
            await h.service.fechar({
                lote: lote(),
                itens: todos('REJEITADO', 'REJEITADO', 'REJEITADO'),
                agora: AGORA,
            });
            expect(h.execRepo.marcarJRejeitado).not.toHaveBeenCalled();
            expect(h.execRepo.registrarEtapa).not.toHaveBeenCalled();
        });

        it('execução já terminal não é tocada', async () => {
            const h = make();
            h.execRepo.ultimaPorGrupo.mockResolvedValue({
                id: 'E1',
                grupoId: 'G1',
                loteId: 'L1',
                filCod: 2,
                etapa: 'concluido',
            });
            await h.service.fechar({
                lote: lote(),
                itens: todos('REJEITADO', 'REJEITADO', 'REJEITADO'),
                agora: AGORA,
            });
            expect(h.execRepo.registrarEtapa).not.toHaveBeenCalled();
        });
    });
});

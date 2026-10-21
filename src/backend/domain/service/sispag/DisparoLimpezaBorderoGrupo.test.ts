import 'reflect-metadata';
import NotImplementedError from '../../errors/NotImplementedError.js';
import type { LimpezaBorderoGrupoInterface } from '../../interface/sispag/BorderoGrupoBoletoInterface.js';
import { ETAPA_BORDERO_GRUPO, type EtapaBordero } from '../../libs/boleto/EtapaBorderoGrupo.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type GrupoBoletoExecucaoRepository from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type { GrupoBoletoExecucao } from '../../repository/sispag/GrupoBoletoExecucaoRepository.js';
import type LogService from '../LogService.js';
import type NotificacaoService from '../operacao/NotificacaoService.js';
import DisparoLimpezaBorderoGrupo, {
    MOTIVO_LIMPEZA_LOTE_CANCELADO,
} from './DisparoLimpezaBorderoGrupo.js';

const execucao = (id: string, etapa: EtapaBordero, over: Partial<GrupoBoletoExecucao> = {}) =>
    ({
        id,
        grupoId: `G-${id}`,
        loteId: 'L1',
        filCod: 2,
        flpCod: 51,
        borCod: 251,
        borTimCad: 1_760_000_000_000,
        baixas: [],
        etapa,
        tentativas: 1,
        criadoEm: new Date(),
        atualizadoEm: new Date(),
        ...over,
    }) as GrupoBoletoExecucao;

const montar = (execucoes: GrupoBoletoExecucao[] | Error) => {
    const ledger = {
        listarPorLote: jest.fn(async () => {
            if (execucoes instanceof Error) throw execucoes;
            return execucoes;
        }),
    };
    const limpeza = {
        limpar: jest.fn(async (p: { execucao: GrupoBoletoExecucao }) => ({
            desfecho: 'limpo' as const,
            execucaoId: p.execucao.id,
        })),
    };
    const notificacao = { emitir: jest.fn().mockResolvedValue(null) };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const disparo = new DisparoLimpezaBorderoGrupo(
        ledger as unknown as GrupoBoletoExecucaoRepository,
        limpeza as unknown as LimpezaBorderoGrupoInterface,
        notificacao as unknown as NotificacaoService,
        BankingCalendar.withClock(() => new Date('2026-10-21T15:00:00Z')),
        log as unknown as LogService,
    );
    return { disparo, ledger, limpeza, notificacao, log };
};

describe('DisparoLimpezaBorderoGrupo — L5 com grupo de boleto (G3, I21q)', () => {
    it('entrega à limpeza só as execuções do lote que ainda admitem limpeza, com o motivo do cancelamento', async () => {
        const { disparo, limpeza, notificacao } = montar([
            execucao('E1', ETAPA_BORDERO_GRUPO.IMPORTADO),
            execucao('E2', ETAPA_BORDERO_GRUPO.CONCLUIDO),
            execucao('E3', ETAPA_BORDERO_GRUPO.LIMPO),
            execucao('E4', ETAPA_BORDERO_GRUPO.SIMULADO),
            execucao('E5', ETAPA_BORDERO_GRUPO.INDETERMINADO),
            execucao('E6', ETAPA_BORDERO_GRUPO.LIMPEZA_PENDENTE),
        ]);
        const r = await disparo.aposCancelarLote({ loteId: 'L1', ator: 'ana' });
        expect(limpeza.limpar.mock.calls.map((c) => c[0].execucao.id)).toEqual(['E1', 'E2']);
        expect(limpeza.limpar).toHaveBeenCalledWith(
            expect.objectContaining({ motivo: MOTIVO_LIMPEZA_LOTE_CANCELADO }),
        );
        expect(r).toEqual({ execucoes: 2, limpas: 2, pendentes: 0, falhas: 0 });
        expect(notificacao.emitir).not.toHaveBeenCalled();
    });

    it('lote sem execução de grupo: nada a fazer, nenhum log nem alerta', async () => {
        const { disparo, limpeza, notificacao, log } = montar([]);
        await expect(disparo.aposCancelarLote({ loteId: 'L1', ator: 'ana' })).resolves.toEqual({
            execucoes: 0,
            limpas: 0,
            pendentes: 0,
            falhas: 0,
        });
        expect(limpeza.limpar).not.toHaveBeenCalled();
        expect(notificacao.emitir).not.toHaveBeenCalled();
        expect(log.info).not.toHaveBeenCalled();
    });

    it('falha da limpeza vira Alerta sispag-bordero-grupo-pendente e nunca sobe (o cancelamento já valeu)', async () => {
        const { disparo, limpeza, notificacao } = montar([
            execucao('E1', ETAPA_BORDERO_GRUPO.RETIRADO),
            execucao('E2', ETAPA_BORDERO_GRUPO.IMPORTADO),
        ]);
        limpeza.limpar.mockRejectedValueOnce(
            new NotImplementedError('BorderoGrupoBoletoService: Task 14'),
        );
        const r = await disparo.aposCancelarLote({ loteId: 'L1', ator: 'ana' });
        expect(r).toEqual({ execucoes: 2, limpas: 1, pendentes: 0, falhas: 1 });
        expect(notificacao.emitir).toHaveBeenCalledTimes(1);
        expect(notificacao.emitir).toHaveBeenCalledWith(
            expect.objectContaining({
                tipo: 'sispag-bordero-grupo-pendente',
                alvo: '2:grupo:G-E1',
                severidade: 'erro',
                janelaInicio: new Date('2026-10-21T00:00:00-03:00'),
                detalhe: expect.objectContaining({ loteId: 'L1', borCod: 251, flpCod: 51 }),
            }),
        );
    });

    it('desfecho pendente (a própria limpeza já alertou) é contado, sem alerta duplicado', async () => {
        const { disparo, limpeza, notificacao } = montar([
            execucao('E1', ETAPA_BORDERO_GRUPO.IMPORTADO),
        ]);
        limpeza.limpar.mockResolvedValueOnce({ desfecho: 'pendente' as never, execucaoId: 'E1' });
        const r = await disparo.aposCancelarLote({ loteId: 'L1', ator: 'ana' });
        expect(r.pendentes).toBe(1);
        expect(notificacao.emitir).not.toHaveBeenCalled();
    });

    it('ledger ilegível também vira Alerta (alvo = o lote), sem lançar', async () => {
        const { disparo, notificacao } = montar(new Error('pool esgotado'));
        const r = await disparo.aposCancelarLote({ loteId: 'L1', ator: 'ana' });
        expect(r.falhas).toBe(1);
        expect(notificacao.emitir).toHaveBeenCalledWith(
            expect.objectContaining({ tipo: 'sispag-bordero-grupo-pendente', alvo: 'lote:L1' }),
        );
    });

    it('alerta que falha ao ser emitido só é logado (nunca derruba o cancelamento)', async () => {
        const { disparo, limpeza, notificacao, log } = montar([
            execucao('E1', ETAPA_BORDERO_GRUPO.IMPORTADO),
        ]);
        limpeza.limpar.mockRejectedValueOnce(new Error('timeout'));
        notificacao.emitir.mockRejectedValueOnce(new Error('alerta fora'));
        await expect(
            disparo.aposCancelarLote({ loteId: 'L1', ator: 'ana' }),
        ).resolves.toMatchObject({
            falhas: 1,
        });
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                message: 'limpeza do borderô do grupo: alerta do painel não foi emitido',
            }),
        );
    });
});

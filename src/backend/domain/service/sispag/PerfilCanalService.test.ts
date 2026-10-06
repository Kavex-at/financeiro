import 'reflect-metadata';
import type ConexosBaseClient from '../../client/ConexosBaseClient.js';
import type ConexosExtratoClient from '../../client/ConexosExtratoClient.js';
import type ConexosPagamentosRealizadosClient from '../../client/ConexosPagamentosRealizadosClient.js';
import BoundedConcurrency from '../../libs/concurrency/BoundedConcurrency.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { SISPAG_VERIFICACAO_DEFAULT } from '../../libs/environment/model/EnvironmentVars.js';
import type PerfilCanalFornecedorRepository from '../../repository/sispag/PerfilCanalFornecedorRepository.js';
import type LogService from '../LogService.js';
import ChannelProfileCalculator from './ChannelProfileCalculator.js';
import PerfilCanalService from './PerfilCanalService.js';

/**
 * `calcularPerfilCanal` (ADR-0063). Os clients são mocks que SÓ têm os métodos de leitura que o
 * serviço pode usar: um Proxy registra qualquer outro acesso — um método de escrita chamado aqui
 * reprovaria o teste.
 */

const DIA = 86_400_000;
const AGORA = new Date(Date.UTC(2026, 9, 5));

/** Mock que só aceita os métodos listados; registra qualquer outro acesso. */
const somenteLeitura = <T extends Record<string, unknown>>(metodos: T, proibidos: string[]) =>
    new Proxy(metodos, {
        get: (alvo, prop) => {
            if (typeof prop === 'string' && !(prop in alvo) && prop !== 'then')
                proibidos.push(prop);
            return alvo[prop as keyof T];
        },
    });

const build = (opts: { falhaBordero?: boolean; falhaExtrato?: boolean } = {}) => {
    const proibidos: string[] = [];
    // 5 boletos em 3 meses para o favorecido 10 → ALTA, dominante BOLETO.
    const pagamentos = [0, 1, 2, 3, 4].map((i) => ({
        pesCod: '10',
        credor: 'ACME',
        valor: 100 + i,
        data: AGORA.getTime() - (10 + i * 25) * DIA,
    }));
    const base = somenteLeitura(
        { getFiliais: jest.fn().mockResolvedValue([{ filCod: 2 }]) },
        proibidos,
    );
    const extrato = somenteLeitura(
        {
            listContas: jest.fn().mockResolvedValue([{ gerNum: 38, qtdeBanco: 10 }]),
            listLancamentos: jest.fn(async (p: { de: Date; ate: Date }) => {
                if (opts.falhaExtrato) throw new Error('HTTP 500');
                return pagamentos
                    .filter((b) => b.data >= p.de.getTime() && b.data <= p.ate.getTime())
                    .map((b) => ({
                        valor: b.valor,
                        dataLancamento: new Date(b.data),
                        historico: 'PAGTO TITULO',
                    }));
            }),
        },
        proibidos,
    );
    const realizados = somenteLeitura(
        {
            listBorderosPagamento: jest.fn(async () => {
                if (opts.falhaBordero) throw new Error('HTTP 503');
                return [{ borCod: 1, borDtaMvto: AGORA.getTime() - 10 * DIA }];
            }),
            listBaixasPagamento: jest.fn().mockResolvedValue(pagamentos),
        },
        proibidos,
    );
    const repo = { upsertRodada: jest.fn().mockResolvedValue(1) };
    const env = {
        getEnvironmentVars: jest
            .fn()
            .mockResolvedValue({ sispagVerificacao: { ...SISPAG_VERIFICACAO_DEFAULT } }),
    };
    const log = { warn: jest.fn() };
    const service = new PerfilCanalService(
        base as unknown as ConexosBaseClient,
        realizados as unknown as ConexosPagamentosRealizadosClient,
        extrato as unknown as ConexosExtratoClient,
        new ChannelProfileCalculator(),
        repo as unknown as PerfilCanalFornecedorRepository,
        env as unknown as EnvironmentProvider,
        new BoundedConcurrency(),
        log as unknown as LogService,
    );
    return { service, repo, extrato, realizados, proibidos, log };
};

describe('PerfilCanalService.calcular', () => {
    it('só LÊ do Conexos (nenhum outro método dos clients é tocado) e grava os perfis com o jobRunId', async () => {
        const h = build();
        const r = await h.service.calcular({ jobRunId: 'RUN-1', agora: AGORA });
        expect(h.proibidos).toEqual([]);
        expect(r).toMatchObject({
            perfis: 1,
            porConfianca: { ALTA: 1, MEDIA: 0, BAIXA: 0 },
            falhasLeitura: 0,
            gravado: true,
        });
        const [perfis, runId] = h.repo.upsertRodada.mock.calls[0] ?? [];
        expect(runId).toBe('RUN-1');
        expect(perfis[0]).toMatchObject({
            pesCod: '10',
            grupoDominante: 'BOLETO',
            confianca: 'ALTA',
            jobRunId: 'RUN-1',
        });
    });

    it('lê o extrato só de DÉBITOS, em fatias de 30 dias dentro da janela do tenant (24 meses)', async () => {
        const h = build();
        const r = await h.service.calcular({ jobRunId: 'RUN-1', agora: AGORA });
        expect(r.janelaFim - r.janelaInicio).toBe(24 * 30 * DIA);
        const chamadas = h.extrato.listLancamentos.mock.calls as unknown as Array<
            [{ exiVldTipo: number; de: Date; ate: Date }]
        >;
        expect(chamadas.length).toBe(24);
        for (const [p] of chamadas) {
            expect(p.exiVldTipo).toBe(1);
            expect(p.ate.getTime() - p.de.getTime()).toBeLessThanOrEqual(30 * DIA);
        }
    });

    it.each([
        ['borderô', { falhaBordero: true }],
        ['extrato', { falhaExtrato: true }],
    ])('leitura de %s que falha → não grava (perfil anterior vale)', async (_n, opts) => {
        const h = build(opts);
        const r = await h.service.calcular({ jobRunId: 'RUN-1', agora: AGORA });
        expect(r.falhasLeitura).toBeGreaterThan(0);
        expect(r.gravado).toBe(false);
        expect(h.repo.upsertRodada).not.toHaveBeenCalled();
        expect(h.log.warn.mock.calls[0]?.[0].message).toMatch(/perfil de canal: leitura falhou/);
    });
});

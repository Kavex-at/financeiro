import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type ConexosRenegociacaoClient from '../../client/ConexosRenegociacaoClient.js';
import type ConexosSessionRegistry from '../../client/ConexosSessionRegistry.js';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import ConexosError from '../../errors/ConexosError.js';
import CentsAdjustmentIncompleteError from '../../errors/CentsAdjustmentIncompleteError.js';
import CentsAdjustmentNotEligibleError from '../../errors/CentsAdjustmentNotEligibleError.js';
import type {
    AjusteCentavosExecucao,
    RechaveamentoInput,
} from '../../interface/sispag/AjusteCentavos.js';
import CodigoBarrasBoleto from '../../libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../../libs/boleto/CodigoBarrasSintetico.js';
import ElegibilidadeAjusteCentavos from '../../libs/boleto/ElegibilidadeAjusteCentavos.js';
import EtapaAjusteCentavos, { type EtapaAjuste } from '../../libs/boleto/EtapaAjusteCentavos.js';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { conexosRequestContext } from '../../libs/requestContext/ConexosRequestContext.js';
import ServerProcessMarker from '../../libs/runtime/ServerProcessMarker.js';
import type AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import type BoletoDdaRepository from '../../repository/sispag/BoletoDdaRepository.js';
import type LotePagamentoRepository from '../../repository/sispag/LotePagamentoRepository.js';
import type SugestaoBoletoRepository from '../../repository/sispag/SugestaoBoletoRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import AjusteCentavosTituloService from './AjusteCentavosTituloService.js';

const VENC = '2026-10-30';
const VENC_EPOCH = Date.UTC(2026, 9, 30);
const ROBO = { robo: true, getCapturedUsnCod: () => '77' };
const ANALISTA = { analista: true };

interface Cenario {
    valorTitulo?: number;
    valorBoleto?: number;
    vencimentoBoleto?: string;
    parEstado?: string;
    numeroBoleto?: string;
    totalPago?: number;
    loteFechado?: boolean;
    modo?: string;
    servidor?: boolean;
    loginSondado?: string;
    ledgerInicial?: Partial<AjusteCentavosExecucao>;
}

/** Ledger em memória com a MESMA semântica do repositório (máquina + lock otimista). */
const fakeLedger = () => {
    const linhas = new Map<string, AjusteCentavosExecucao>();
    let seq = 0;
    const rechaveamentos: RechaveamentoInput[] = [];
    const cfg = { decisaoTransferida: true };
    const repo = {
        linhas,
        rechaveamentos,
        cfg,
        abrir: jest.fn(async (i: Record<string, unknown>) => {
            for (const l of linhas.values()) {
                if (l.docCod === i.docCod && l.titCodOrigem === i.titCodOrigem) {
                    if (l.decisaoId === i.decisaoId || !EtapaAjusteCentavos.ehTerminal(l.etapa)) {
                        return { criado: false, execucao: { ...l } };
                    }
                }
            }
            seq += 1;
            const id = `exec-${seq}`;
            const nova = {
                id,
                filCod: i.filCod,
                docCod: i.docCod,
                titCodOrigem: i.titCodOrigem,
                decisaoId: i.decisaoId,
                marcador: `AJC-${seq}`,
                etapa: (i.etapa as EtapaAjuste) ?? 'pendente',
                tentativas: 1,
                criadoEm: '',
                atualizadoEm: '',
                ...(i.conexosUsername ? { conexosUsername: i.conexosUsername } : {}),
                ...(i.codigoMascarado ? { codigoMascarado: i.codigoMascarado } : {}),
                ...(i.deltaCentavos !== undefined ? { deltaCentavos: i.deltaCentavos } : {}),
                ...(i.frnVldTpop !== undefined ? { frnVldTpop: i.frnVldTpop } : {}),
                ...(i.valorBoletoCentavos !== undefined
                    ? { valorBoletoCentavos: i.valorBoletoCentavos }
                    : {}),
            } as AjusteCentavosExecucao;
            linhas.set(id, nova);
            return { criado: true, execucao: { ...nova } };
        }),
        registrarIntencao: jest.fn(async (id: string, intencao: string) => {
            const l = linhas.get(id);
            if (l) l.intencao = intencao;
        }),
        registrarTentativa: jest.fn(async () => undefined),
        registrarResultado: jest.fn(
            async (
                id: string,
                de: EtapaAjuste,
                para: EtapaAjuste,
                campos: Record<string, unknown> = {},
            ) => {
                EtapaAjusteCentavos.transicionar(de, para);
                const l = linhas.get(id);
                if (!l || l.etapa !== de) return false;
                Object.assign(l, { etapa: para, intencao: undefined });
                for (const [k, v] of Object.entries(campos)) {
                    if (v !== undefined) (l as unknown as Record<string, unknown>)[k] = v;
                }
                return true;
            },
        ),
        buscarPorId: jest.fn(async (id: string) => {
            const l = linhas.get(id);
            return l ? { ...l } : null;
        }),
        listarNaoTerminais: jest.fn(async () =>
            [...linhas.values()]
                .filter((l) => !EtapaAjusteCentavos.ehTerminal(l.etapa))
                .map((l) => ({ ...l })),
        ),
        buscarNaoTerminalPorOrigem: jest.fn(async (k: { docCod: string; titCod: string }) => {
            const l = [...linhas.values()].find(
                (x) =>
                    x.docCod === k.docCod &&
                    x.titCodOrigem === k.titCod &&
                    !EtapaAjusteCentavos.ehTerminal(x.etapa),
            );
            return l ? { ...l } : null;
        }),
        buscarConcluidoPorTitCodNovo: jest.fn(async () => null),
        ultimoPorTitulo: jest.fn(async (k: { docCod: string; titCod: string }) => {
            const l = [...linhas.values()]
                .reverse()
                .find(
                    (x) =>
                        x.docCod === k.docCod &&
                        (x.titCodOrigem === k.titCod || x.titCodNovo === k.titCod),
                );
            return l ? { ...l } : null;
        }),
        listarUltimosDaFilial: jest.fn(async () => [...linhas.values()]),
        rechavear: jest.fn(async (input: RechaveamentoInput) => {
            rechaveamentos.push(input);
            const l = linhas.get(input.execucaoId);
            if (l) {
                EtapaAjusteCentavos.transicionar(l.etapa, 'rechaveada');
                Object.assign(l, {
                    etapa: 'rechaveada',
                    titCodNovo: input.titCodNovo,
                    ...(input.motivo ? { motivo: input.motivo } : {}),
                });
            }
            return {
                decisaoTransferida: cfg.decisaoTransferida,
                lotesTocados: [] as string[],
                ...(cfg.decisaoTransferida ? { novaDecisaoId: 'dec-novo' } : {}),
            };
        }),
    };
    return repo;
};

const build = (c: Cenario = {}) => {
    const valorTitulo = c.valorTitulo ?? 462.49;
    const valorBoleto = c.valorBoleto ?? 462.5;
    const delta = Math.round((valorBoleto - valorTitulo) * 100);
    const ordem: string[] = [];
    const estado = { finalizada: false, liberado: false, cancelada: false };
    const original = {
        docCod: '536',
        titCod: '1',
        docTip: 2,
        pesCodFor: 121,
        titEspNumero: '12294',
        titDtaVencimento: VENC_EPOCH,
        pgtCod: 1,
        dupEspOrdem: 'A',
        vldLib: 1,
        vldPago: 0,
        raw: {
            totalLiquido: valorTitulo + 0 - 0 - (c.totalPago ?? 0) + (c.totalPago ?? 0),
            totalPago: c.totalPago ?? 0,
            totalAberto: valorTitulo - (c.totalPago ?? 0),
            titMnyJuros: null,
            titMnyDesconto: null,
            docEspNumero: '12294',
        } as Record<string, unknown>,
    };
    if (c.totalPago) original.raw.totalLiquido = valorTitulo;
    const novo = () => ({
        ...original,
        titCod: '2',
        vldLib: estado.liberado ? 1 : 0,
        titMnyValor: valorTitulo,
        raw: {
            totalLiquido: valorBoleto,
            totalPago: 0,
            totalAberto: valorTitulo,
            titMnyJuros: delta > 0 ? delta / 100 : 0,
            titMnyDesconto: delta < 0 ? -delta / 100 : 0,
            titMnyValor: valorTitulo,
        } as Record<string, unknown>,
    });
    const client = {
        criarRenegociacao: jest.fn(async (_s: unknown, _p: unknown) => {
            ordem.push('criar');
            return { frnCod: 3 };
        }),
        incluirTitulo: jest.fn(async () => {
            ordem.push('incluir');
        }),
        gravarComposicao: jest.fn(async (_s: unknown, _p: unknown) => {
            ordem.push('composicao');
        }),
        aplicarAjuste: jest.fn(async (_s: unknown, _p: unknown) => {
            ordem.push('ajuste');
        }),
        finalizarRenegociacao: jest.fn(async () => {
            ordem.push('finalizar');
            estado.finalizada = true;
        }),
        cancelarRenegociacao: jest.fn(async (): Promise<void> => {
            ordem.push('cancelar');
            throw new ConexosError({
                endpoint: 'fin070',
                cause: Object.assign(new Error('502'), { response: { status: 502 } }),
            });
        }),
        renegociacaoDesfeita: jest.fn(async () => estado.cancelada),
        validarSelecionado: jest.fn(async () => {
            ordem.push('validar');
        }),
        aplicarComando: jest.fn(async () => {
            ordem.push('aplicar');
            estado.liberado = true;
        }),
        lerRenegociacao: jest.fn(async () => ({
            frnCod: 3,
            finalizada: estado.finalizada,
            cancelada: estado.cancelada,
            mnyValorTotal: valorBoleto,
            titulos: [{ docCod: '536', titCod: '1' }],
        })),
        buscarRenegociacaoPorMarcador: jest.fn(async (): Promise<number[]> => []),
        listarTitulosDoDocumento: jest.fn(async () =>
            estado.finalizada ? [novo()] : [{ ...original }],
        ),
        listarBloqueios: jest.fn(async () =>
            estado.finalizada
                ? [
                      {
                          docCod: '536',
                          titCod: '2',
                          fblCod: 19,
                          ftbVldStatus: estado.liberado ? 2 : 1,
                          titMnyTotal: valorBoleto,
                          row: { docCod: 536, titCod: 2, fblCod: 19 },
                      },
                  ]
                : [],
        ),
        listarComandosDoBloqueio: jest.fn(async () => [
            { fbaCod: 3, nome: 'APROVAR', ativo: true },
            { fbaCod: 4, nome: 'REPROVAR', ativo: true },
        ]),
    };
    const ledger = fakeLedger();
    if (c.ledgerInicial) {
        ledger.linhas.set('exec-0', {
            id: 'exec-0',
            filCod: 2,
            docCod: '536',
            titCodOrigem: '1',
            decisaoId: 'dec-1',
            marcador: 'AJC-0',
            etapa: 'pendente',
            tentativas: 1,
            criadoEm: '',
            atualizadoEm: '',
            deltaCentavos: delta,
            frnVldTpop: delta > 0 ? 1 : 2,
            valorBoletoCentavos: Math.round(valorBoleto * 100),
            codigoMascarado: '34191…9000',
            ...c.ledgerInicial,
        } as AjusteCentavosExecucao);
    }
    const decisao = {
        id: 'dec-1',
        filCod: 2,
        docCod: '536',
        titCod: '1',
        ddcCod: 10,
        ditCod: 1,
        decisao: 'CONFIRMADA',
        confirmacaoEmissorId: 'par-1',
        decididoPor: 'ana',
    };
    const eventos: Array<Record<string, unknown>> = [];
    const sugestoes = {
        buscarDecisaoPorId: jest.fn(async () => decisao),
        listarDecisoes: jest.fn(async () => [decisao]),
        buscarParPorId: jest.fn(async () => ({ id: 'par-1', estado: c.parEstado ?? 'VIGENTE' })),
        inserirEventoAjuste: jest.fn(async (e: Record<string, unknown>) => {
            eventos.push(e);
            return { inserido: true };
        }),
        listarEventos: jest.fn(async () => []),
    };
    const boletos = {
        buscarPorChave: jest.fn(async () => ({
            ddcCod: 10,
            ditCod: 1,
            valor: valorBoleto,
            numero: c.numeroBoleto ?? '12294',
            vencimento: c.vencimentoBoleto ?? VENC,
            codbar: CodigoBarrasSintetico.linhaDigitavel({
                valor: valorBoleto,
                vencimento: c.vencimentoBoleto ?? VENC,
                serie: 1,
            }),
        })),
    };
    const titulos = {
        buscarPorChave: jest.fn(async () => ({
            filCod: 2,
            docCod: '536',
            titCod: '1',
            valor: valorTitulo,
            vencimento: VENC_EPOCH,
            liberado: true,
            pago: false,
            temBoleto: false,
            numeroDocumento: '12294',
            ativo: true,
        })),
    };
    const lotes = { tituloEmLoteFechado: jest.fn(async () => c.loteFechado ?? false) };
    const marcador = new ServerProcessMarker();
    if (c.servidor !== false) marcador.ligar();
    const env = {
        getEnvironmentVars: jest.fn(async () => ({
            sispagAjusteCentavosFiliais: c.modo ?? '2:on',
            sispagAjusteCentavosLoginSondado: c.loginSondado ?? 'MPS_FRANCINEI',
            conexosLogin: 'MPS_FRANCINEI',
            sispagLiveWriteEnabled: true,
            conexosWriteEnabled: true,
            conexosDryRun: false,
        })),
    };
    const logs: Array<Record<string, unknown>> = [];
    const log = {
        info: jest.fn(async (x: Record<string, unknown>) => void logs.push(x)),
        warn: jest.fn(async (x: Record<string, unknown>) => void logs.push(x)),
        error: jest.fn(async (x: Record<string, unknown>) => void logs.push(x)),
    };
    const registry = { robot: jest.fn(() => ROBO) };
    const locks: number[] = [];
    const db = {
        withAdvisoryLock: jest.fn(
            async (k: number, ok: () => Promise<unknown>, busy: () => Promise<unknown>) => {
                if (locks.includes(k)) return busy();
                locks.push(k);
                try {
                    return await ok();
                } finally {
                    locks.splice(locks.indexOf(k), 1);
                }
            },
        ),
    };
    const service = new AjusteCentavosTituloService(
        client as unknown as ConexosRenegociacaoClient,
        registry as unknown as ConexosSessionRegistry,
        ledger as unknown as AjusteCentavosExecucaoRepository,
        sugestoes as unknown as SugestaoBoletoRepository,
        boletos as unknown as BoletoDdaRepository,
        titulos as unknown as TituloAPagarRepository,
        lotes as unknown as LotePagamentoRepository,
        new ElegibilidadeAjusteCentavos(new CodigoBarrasBoleto()),
        marcador,
        BankingCalendar.withClock(() => new Date('2026-10-19T15:00:00Z')),
        env as unknown as EnvironmentProvider,
        log as unknown as LogService,
        db as unknown as PostgreeDatabaseClient,
    );
    return { service, client, ledger, sugestoes, eventos, logs, registry, ordem, estado, db };
};

const PEDIDO = {
    filCod: 2,
    docCod: '536',
    titCod: '1',
    decisaoId: 'dec-1',
    gatilho: 'confirmar' as const,
};

const ESCRITAS = [
    'criarRenegociacao',
    'incluirTitulo',
    'gravarComposicao',
    'aplicarAjuste',
    'finalizarRenegociacao',
    'cancelarRenegociacao',
    'validarSelecionado',
    'aplicarComando',
] as const;

const semEscrita = (client: ReturnType<typeof build>['client']) => {
    for (const m of ESCRITAS) expect(client[m]).not.toHaveBeenCalled();
};

const recusa = (key: string) =>
    new ConexosError({
        endpoint: 'fin070',
        cause: Object.assign(new Error('400'), {
            response: { status: 400, data: { messages: [{ valid: 'ERRO', message: key }] } },
        }),
    });
const transitoria = () =>
    new ConexosError({
        endpoint: 'fin070',
        cause: Object.assign(new Error('502'), { response: { status: 502 } }),
    });

describe('AjusteCentavosTituloService — casos canônicos da I18 (ADR-0073)', () => {
    it('caso 1: NELSON 462,49 × 462,50 ⇒ sequência exata, juros 0,01, liberação e rechaveamento', async () => {
        const h = build();
        const r = await h.service.ajustar(PEDIDO);
        expect(r).toMatchObject({ resultado: 'executado', etapa: 'concluido' });
        expect(h.ordem).toEqual([
            'criar',
            'incluir',
            'composicao',
            'ajuste',
            'finalizar',
            'validar',
            'aplicar',
        ]);
        const [, criar] = h.client.criarRenegociacao.mock.calls[0] ?? [];
        expect(criar).toMatchObject({
            filCod: 2,
            pesCod: 121,
            dataRenegEpoch: Date.UTC(2026, 9, 19),
        });
        expect((criar as { obs: string }).obs).toMatch(/AJC-1/);
        expect((criar as { obs: string }).obs).not.toMatch(/\d{20,}/);
        expect(h.client.gravarComposicao.mock.calls[0]?.[1]).toMatchObject({
            valor: 462.49,
            vencimentoEpoch: VENC_EPOCH,
            frgEspNumero: '12294',
            pgtCod: 1,
            dupEspOrdem: 'A',
        });
        expect(h.client.aplicarAjuste.mock.calls[0]?.[1]).toMatchObject({
            frnVldTpop: 1,
            frnMnyValor: 0.01,
        });
        expect(h.ledger.rechaveamentos[0]).toMatchObject({
            titCodAntigo: '1',
            titCodNovo: '2',
            frnCod: 3,
            tituloNovo: { valorLiquido: 462.5, valorBase: 462.49, aprovado: true },
        });
    });

    it('caso 2: 178,78 × 178,77 ⇒ desconto (frnVldTpop 2), 0,01', async () => {
        const h = build({ valorTitulo: 178.78, valorBoleto: 178.77 });
        const r = await h.service.ajustar(PEDIDO);
        expect(r.etapa).toBe('concluido');
        expect(h.client.aplicarAjuste.mock.calls[0]?.[1]).toMatchObject({
            frnVldTpop: 2,
            frnMnyValor: 0.01,
        });
        expect(h.ledger.rechaveamentos[0]?.tituloNovo.valorLiquido).toBe(178.77);
    });

    it('caso 3: Δ = R$ 0,06 ⇒ zero chamada ao fin070, recusado com evento', async () => {
        const h = build({ valorBoleto: 462.55 });
        const r = await h.service.ajustar(PEDIDO);
        expect(r).toMatchObject({ resultado: 'recusado', motivo: 'DELTA_ACIMA_LIMITE' });
        semEscrita(h.client);
        expect(h.eventos).toEqual([
            expect.objectContaining({ tipo: 'AJUSTE_RECUSADO', motivo: 'DELTA_ACIMA_LIMITE' }),
        ]);
    });

    it('caso 4: MSC nº 12294 sem par VIGENTE ⇒ recusado, sem escrita', async () => {
        const h = build({ parEstado: 'REVOGADA' });
        const r = await h.service.ajustar(PEDIDO);
        expect(r).toMatchObject({ resultado: 'recusado', motivo: 'PAR_NAO_VIGENTE' });
        semEscrita(h.client);
    });

    it('caso 5: Δ = 0 ⇒ nada a ajustar (DELTA_ZERO), sem escrita', async () => {
        const h = build({ valorBoleto: 462.49 });
        const r = await h.service.ajustar(PEDIDO);
        expect(r).toMatchObject({ resultado: 'recusado', motivo: 'DELTA_ZERO' });
        semEscrita(h.client);
    });

    describe('caso 6: falha antes do finalizar ⇒ compensação', () => {
        it('cancelamento que falha ⇒ indeterminado + alerta, nunca segunda renegociação', async () => {
            const h = build();
            h.client.gravarComposicao.mockRejectedValueOnce(
                recusa('FIN_070.O_TOTAL_DOS_TITULOS_A_SEREM_GERADOS'),
            );
            const r = await h.service.ajustar(PEDIDO);
            expect(r.etapa).toBe('indeterminado');
            expect(h.client.cancelarRenegociacao).toHaveBeenCalledTimes(1);
            expect(h.client.finalizarRenegociacao).not.toHaveBeenCalled();
            expect(h.client.aplicarAjuste).not.toHaveBeenCalled();
            expect(h.eventos.map((e) => e.tipo)).toContain('AJUSTE_FALHOU');
            expect(h.logs.some((l) => /indeterminado/.test(String(l.message)))).toBe(true);
            // retomada não cria outra renegociação: indeterminado é terminal
            await h.service.retomarPendentes({ filCod: 2 });
            expect(h.client.criarRenegociacao).toHaveBeenCalledTimes(1);
        });

        it('cancelamento ok e relido ⇒ cancelado; título original intacto (nenhum finalizar)', async () => {
            const h = build();
            h.client.gravarComposicao.mockRejectedValueOnce(recusa('FIN_070.X'));
            h.client.cancelarRenegociacao.mockImplementationOnce(async () => {
                h.ordem.push('cancelar');
                h.estado.cancelada = true;
            });
            // G3 (HML): a renegociação desfeita SOME — `GET fin070/{frnCod}` volta RECORDNOTFOUND.
            h.client.lerRenegociacao.mockRejectedValue(new Error('Not Found: FinReneg'));
            const r = await h.service.ajustar(PEDIDO);
            expect(r.etapa).toBe('cancelado');
            expect(h.client.renegociacaoDesfeita).toHaveBeenCalledWith(ROBO, {
                filCod: 2,
                frnCod: 3,
            });
            expect(h.client.finalizarRenegociacao).not.toHaveBeenCalled();
            expect(h.eventos.map((e) => e.tipo)).toContain('AJUSTE_CANCELADO');
        });

        it('cancelamento aceito mas a releitura ainda vê a renegociação ⇒ indeterminado', async () => {
            const h = build();
            h.client.gravarComposicao.mockRejectedValueOnce(recusa('FIN_070.X'));
            h.client.cancelarRenegociacao.mockImplementationOnce(async () => {
                h.ordem.push('cancelar');
            });
            const r = await h.service.ajustar(PEDIDO);
            expect(r.etapa).toBe('indeterminado');
            expect(r.motivo).toMatch(/CANCELAMENTO_FALHOU/);
        });
    });

    it('conferência: mnyValorTotal ≠ valor do boleto ⇒ não finaliza, compensa', async () => {
        const h = build();
        h.client.lerRenegociacao.mockResolvedValueOnce({
            frnCod: 3,
            finalizada: false,
            cancelada: false,
            mnyValorTotal: 462.49,
            titulos: [],
        });
        const r = await h.service.ajustar(PEDIDO);
        expect(h.client.finalizarRenegociacao).not.toHaveBeenCalled();
        expect(h.client.cancelarRenegociacao).toHaveBeenCalled();
        expect(r.etapa).toBe('indeterminado');
    });

    it('elegibilidade recalculada antes do finalizar: inelegível na 2ª leitura ⇒ cancela', async () => {
        const h = build();
        const [original] = await build().client.listarTitulosDoDocumento();
        const pago = { ...(original as object), vldPago: 1 } as never;
        h.client.listarTitulosDoDocumento
            .mockImplementationOnce(async () => [original as never])
            .mockImplementationOnce(async () => [pago]);
        const r = await h.service.ajustar(PEDIDO);
        expect(h.client.finalizarRenegociacao).not.toHaveBeenCalled();
        expect(h.client.cancelarRenegociacao).toHaveBeenCalled();
        expect(r.motivo).toMatch(/TITULO_PAGO_OU_PARCIAL/);
    });

    it('I18d: zero candidatos a título novo ⇒ indeterminado, sem palpite', async () => {
        const h = build();
        const original = (await build().client.listarTitulosDoDocumento())[0];
        h.client.listarTitulosDoDocumento.mockImplementation(async () =>
            h.estado.finalizada ? [] : [original as never],
        );
        const r = await h.service.ajustar(PEDIDO);
        expect(r.etapa).toBe('indeterminado');
        expect(h.ledger.rechavear).not.toHaveBeenCalled();
    });

    it('I18d: dois candidatos ⇒ indeterminado', async () => {
        const h = build();
        const base = build();
        base.estado.finalizada = true;
        const novo = (await base.client.listarTitulosDoDocumento())[0];
        const original = (await build().client.listarTitulosDoDocumento())[0];
        h.client.listarTitulosDoDocumento.mockImplementation(async () =>
            h.estado.finalizada
                ? [novo as never, { ...(novo as object), titCod: '3' } as never]
                : [original as never],
        );
        const r = await h.service.ajustar(PEDIDO);
        expect(r.etapa).toBe('indeterminado');
    });

    describe('I18e: reaprovação estreita', () => {
        it('caso 7: bloqueio com valor ≠ boleto ⇒ não libera; aguardando_aprovacao_manual (decisão segue o título)', async () => {
            const h = build();
            h.client.listarBloqueios.mockImplementation(async () =>
                h.estado.finalizada
                    ? [
                          {
                              docCod: '536',
                              titCod: '2',
                              fblCod: 19,
                              ftbVldStatus: 1,
                              titMnyTotal: 999,
                              row: { docCod: 536, titCod: 2, fblCod: 19 },
                          },
                      ]
                    : [],
            );
            const r = await h.service.ajustar(PEDIDO);
            expect(r.etapa).toBe('aguardando_aprovacao_manual');
            expect(h.client.aplicarComando).not.toHaveBeenCalled();
            expect(h.ledger.rechavear).toHaveBeenCalledTimes(1);
        });

        it('comando APROVAR ausente ou ambíguo ⇒ aguardando_aprovacao_manual', async () => {
            const h = build();
            h.client.listarComandosDoBloqueio.mockResolvedValue([
                { fbaCod: 3, nome: 'APROVAR', ativo: true },
                { fbaCod: 5, nome: 'APROVAR', ativo: true },
            ]);
            const r = await h.service.ajustar(PEDIDO);
            expect(r.etapa).toBe('aguardando_aprovacao_manual');
            expect(h.client.aplicarComando).not.toHaveBeenCalled();
        });

        it('título novo sem bloqueio e aprovado ⇒ sem_bloqueio ⇒ concluido', async () => {
            const h = build();
            h.client.listarBloqueios.mockResolvedValue([]);
            h.estado.liberado = true;
            const r = await h.service.ajustar(PEDIDO);
            expect(r.etapa).toBe('concluido');
            expect(h.client.aplicarComando).not.toHaveBeenCalled();
        });

        it('bloqueio que permanece após o comando ⇒ aguardando_aprovacao_manual', async () => {
            const h = build();
            h.client.aplicarComando.mockImplementation(async () => {
                h.ordem.push('aplicar');
            });
            const r = await h.service.ajustar(PEDIDO);
            expect(r.etapa).toBe('aguardando_aprovacao_manual');
        });
    });

    it('caso 8: retomada depois do finalizar ⇒ nenhuma segunda renegociação', async () => {
        const h = build({ ledgerInicial: { etapa: 'finalizada', frnCod: 3, titCodNovo: '2' } });
        h.estado.finalizada = true;
        await h.service.retomarPendentes({ filCod: 2 });
        expect(h.client.criarRenegociacao).not.toHaveBeenCalled();
        expect(h.client.finalizarRenegociacao).not.toHaveBeenCalled();
        expect(h.client.aplicarComando).toHaveBeenCalledTimes(1);
        expect(h.ledger.linhas.get('exec-0')?.etapa).toBe('concluido');
    });

    it('caso 9: resposta do POST fin070 perdida ⇒ acha o frnCod pelo marcador e continua', async () => {
        const h = build();
        h.client.criarRenegociacao.mockRejectedValueOnce(transitoria());
        h.client.buscarRenegociacaoPorMarcador.mockResolvedValueOnce([3]);
        const r = await h.service.ajustar(PEDIDO);
        expect(r.etapa).toBe('concluido');
        expect(h.client.criarRenegociacao).toHaveBeenCalledTimes(1);
        expect(h.client.buscarRenegociacaoPorMarcador).toHaveBeenCalledWith(ROBO, {
            filCod: 2,
            marcador: 'AJC-1',
        });
    });

    it('reexecutar sobre ajuste concluido é no-op', async () => {
        const h = build();
        await h.service.ajustar(PEDIDO);
        const chamadas = h.ordem.length;
        const r = await h.service.ajustar(PEDIDO);
        expect(h.ordem.length).toBe(chamadas);
        expect(r.etapa).toBe('concluido');
    });

    it('caso 10: título em lote local FINALIZADO ⇒ recusado (TITULO_EM_LOTE_FINALIZADO)', async () => {
        const h = build({ loteFechado: true });
        const r = await h.service.ajustar(PEDIDO);
        expect(r).toMatchObject({ resultado: 'recusado', motivo: 'TITULO_EM_LOTE_FINALIZADO' });
        semEscrita(h.client);
    });

    it('caso 12: processo de job (marcador desligado) ⇒ shadow, zero escrita, AJUSTE_SIMULADO', async () => {
        const h = build({ servidor: false });
        const r = await h.service.ajustar(PEDIDO);
        expect(r).toMatchObject({ resultado: 'simulado', modo: 'shadow' });
        semEscrita(h.client);
        expect(h.client.listarTitulosDoDocumento).toHaveBeenCalled(); // leitura ao vivo (M7)
        expect(h.eventos).toEqual([expect.objectContaining({ tipo: 'AJUSTE_SIMULADO' })]);
        expect(h.ledger.abrir).not.toHaveBeenCalled();
    });

    it('caso 13: pagamento parcial ⇒ recusado (TITULO_PAGO_OU_PARCIAL)', async () => {
        const h = build({ totalPago: 10 });
        const r = await h.service.ajustar(PEDIDO);
        expect(r).toMatchObject({ resultado: 'recusado', motivo: 'TITULO_PAGO_OU_PARCIAL' });
        semEscrita(h.client);
    });

    it('modo off ⇒ nada acontece (nem leitura)', async () => {
        const h = build({ modo: '' });
        const r = await h.service.ajustar(PEDIDO);
        expect(r.resultado).toBe('desligado');
        expect(h.client.listarTitulosDoDocumento).not.toHaveBeenCalled();
    });

    it('login sondado diferente ⇒ shadow (M3)', async () => {
        const h = build({ loginSondado: 'CLONEX' });
        const r = await h.service.ajustar(PEDIDO);
        expect(r.modo).toBe('shadow');
        semEscrita(h.client);
    });

    it('sessão = ConexosSessionRegistry.robot() explícita, mesmo dentro de request de analista', async () => {
        const h = build();
        await conexosRequestContext.run(
            { platformUsername: 'ana', resolved: ANALISTA as never },
            () => h.service.ajustar(PEDIDO),
        );
        expect(h.registry.robot).toHaveBeenCalled();
        for (const m of ESCRITAS) {
            for (const call of (h.client[m] as jest.Mock).mock.calls) expect(call[0]).toBe(ROBO);
        }
        const fonte = readFileSync(path.join(__dirname, 'AjusteCentavosTituloService.ts'), 'utf8');
        expect(fonte).not.toMatch(/ConexosSessionResolver|conexosRequestContext/);
    });

    it('serialização por título: execução concorrente do mesmo título não roda em paralelo', async () => {
        const h = build();
        const [a, b] = await Promise.all([h.service.ajustar(PEDIDO), h.service.ajustar(PEDIDO)]);
        expect([a.resultado, b.resultado]).toContain('em_andamento');
        expect(h.client.criarRenegociacao).toHaveBeenCalledTimes(1);
    });

    it('logs pt-BR sem código completo', async () => {
        const h = build();
        await h.service.ajustar(PEDIDO);
        expect(JSON.stringify(h.logs)).not.toMatch(/\d{20,}/);
        expect(JSON.stringify(h.eventos)).not.toMatch(/\d{20,}/);
        expect(h.logs.some((l) => /ajuste de centavos/.test(String(l.message)))).toBe(true);
    });

    describe('tentar de novo', () => {
        it('inelegível ⇒ CentsAdjustmentNotEligibleError com o motivo', async () => {
            const h = build({ valorBoleto: 462.55 });
            await expect(
                h.service.tentarDeNovo({ filCod: 2, docCod: '536', titCod: '1' }),
            ).rejects.toBeInstanceOf(CentsAdjustmentNotEligibleError);
        });

        it('ledger desta decisão já cancelado ⇒ inelegível, nunca "executado"', async () => {
            const h = build({ ledgerInicial: { etapa: 'cancelado' } });
            const erro = await h.service
                .tentarDeNovo({ filCod: 2, docCod: '536', titCod: '1' })
                .catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(CentsAdjustmentNotEligibleError);
            expect((erro as CentsAdjustmentNotEligibleError).details.motivo).toBe(
                'AJUSTE_ENCERRADO_CANCELADO',
            );
            expect(h.client.criarRenegociacao).not.toHaveBeenCalled();
        });

        it('parou em transitório ⇒ CentsAdjustmentIncompleteError (retomável)', async () => {
            const h = build();
            h.client.finalizarRenegociacao.mockRejectedValueOnce(transitoria());
            h.client.lerRenegociacao.mockImplementation(async () => {
                throw transitoria();
            });
            await expect(
                h.service.tentarDeNovo({ filCod: 2, docCod: '536', titCod: '1' }),
            ).rejects.toBeInstanceOf(CentsAdjustmentIncompleteError);
        });
    });
});

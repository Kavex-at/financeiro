import 'reflect-metadata';
import BankingCalendar from '../../libs/calendar/BankingCalendar.js';
import type EnvironmentProvider from '../../libs/environment/EnvironmentProvider.js';
import { PAGO_POR_CONEXOS } from '../../interface/sispag/PagoPorConexos.js';
import {
    DUPLICATE_HOLD_ORIGIN,
    type TituloAPagar,
} from '../../interface/sispag/SispagInterface.js';
import {
    ESTADO_PAGAMENTO,
    FONTE_SITUACAO,
    MOTIVO_PAGAMENTO,
} from '../../interface/sispag/SituacaoPagamento.js';
import type { PrazoBoleto } from '../../interface/sispag/PrazoBoleto.js';
import {
    MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO,
    SITUACAO_SUGESTAO_TITULO,
} from '../../interface/sispag/SugestaoBoleto.js';
import { ETAPA_AJUSTE } from '../../libs/boleto/EtapaAjusteCentavos.js';
import type AjusteCentavosExecucaoRepository from '../../repository/sispag/AjusteCentavosExecucaoRepository.js';
import type BloqueioDuplicidadeRepository from '../../repository/sispag/BloqueioDuplicidadeRepository.js';
import type TituloAPagarRepository from '../../repository/sispag/TituloAPagarRepository.js';
import type LogService from '../LogService.js';
import type BoletoSuggestionService from './BoletoSuggestionService.js';
import SituacaoPagamentoResolver from './SituacaoPagamentoResolver.js';
import SituacaoPagamentoService, { AVALIACAO_INCLUSAO } from './SituacaoPagamentoService.js';

const titulo = (over: Partial<TituloAPagar> = {}): TituloAPagar => ({
    docCod: '100',
    titCod: '1',
    filCod: 2,
    valor: 1000,
    liberado: true,
    pago: false,
    diasAteVencimento: 5,
    ...over,
});

interface Over {
    bloqueios?: jest.Mock;
    ajustes?: jest.Mock;
    desfechos?: jest.Mock;
    motivosOrfa?: Map<string, string>;
    prazos?: Map<string, PrazoBoleto>;
    env?: jest.Mock;
    buscarPorChave?: jest.Mock;
    buscarPorChaves?: jest.Mock;
}

const make = (over: Over = {}) => {
    const bloqueioRepo = {
        listAtivos: over.bloqueios ?? jest.fn().mockResolvedValue([]),
    } as unknown as BloqueioDuplicidadeRepository;
    const ajusteRepo = {
        listarUltimaEtapaPorTitulo: over.ajustes ?? jest.fn().mockResolvedValue(new Map()),
    } as unknown as AjusteCentavosExecucaoRepository;
    const boleto = {
        contextoPorTitulo: async () => ({
            situacoes: await (over.desfechos ?? jest.fn().mockResolvedValue(new Map()))(),
            motivosOrfa: over.motivosOrfa ?? new Map<string, string>(),
            prazos: over.prazos ?? new Map(),
        }),
    } as unknown as BoletoSuggestionService;
    const env = {
        getEnvironmentVars:
            over.env ??
            jest
                .fn()
                .mockResolvedValue({ sispagBindCodbarFiliais: '', sispagLiveWriteEnabled: true }),
    } as unknown as EnvironmentProvider;
    const log = {
        warn: jest.fn().mockResolvedValue(undefined),
        info: jest.fn().mockResolvedValue(undefined),
    } as unknown as LogService;
    // `buscarPorChave` do teste responde pela chave pedida; o serviço lê em lote (`buscarPorChaves`).
    const umPorChave = over.buscarPorChave ?? jest.fn().mockResolvedValue(null);
    const tituloRepo = {
        buscarPorChaves:
            over.buscarPorChaves ??
            jest.fn(async (chaves: Array<{ filCod: number; docCod: string; titCod: string }>) => {
                const lidos = await Promise.all(chaves.map((c) => umPorChave(c)));
                return lidos.filter((t): t is TituloAPagar => t !== null && t !== undefined);
            }),
    } as unknown as TituloAPagarRepository;
    // 20/10/2026 12:00 BRT: o dia civil de hoje é 2026-10-20.
    const calendar = BankingCalendar.withClock(() => new Date('2026-10-20T15:00:00Z'));
    const service = new SituacaoPagamentoService(
        new SituacaoPagamentoResolver(),
        bloqueioRepo,
        ajusteRepo,
        boleto,
        env,
        log,
        tituloRepo,
        calendar,
    );
    return { service, log, tituloRepo };
};

describe('SituacaoPagamentoService', () => {
    describe('avaliarCarteira', () => {
        it('preenche a situação de cada título e devolve o resumo da carteira inteira', async () => {
            const { service } = make();
            const titulos = [
                titulo(),
                titulo({ titCod: '2', liberado: false, valor: 500 }),
                titulo({ titCod: '3', diasAteVencimento: -2, valor: 250 }),
            ];
            const resumo = await service.avaliarCarteira(titulos);
            expect(titulos.map((t) => t.situacaoPagamento?.estado)).toEqual([
                ESTADO_PAGAMENTO.PRONTO,
                ESTADO_PAGAMENTO.BLOQUEADO,
                ESTADO_PAGAMENTO.BLOQUEADO,
            ]);
            expect(resumo.porEstado).toEqual({
                PRONTO: { qtd: 1, valor: 1000 },
                BLOQUEADO: { qtd: 2, valor: 750 },
            });
            expect(resumo.porMotivo).toEqual({
                ALCADA: { qtd: 1, valor: 500 },
                VENCIDO: { qtd: 1, valor: 250 },
            });
            expect(resumo.fontesIndisponiveis).toEqual([]);
        });

        it('usa as três fontes: duplicidade, ajuste de centavos e desfecho do boleto', async () => {
            const { service } = make({
                bloqueios: jest.fn().mockResolvedValue([
                    {
                        filCod: 2,
                        docCod: '1',
                        titCod: '1',
                        origem: DUPLICATE_HOLD_ORIGIN.DUPLICIDADE_TITULO,
                    },
                ]),
                ajustes: jest
                    .fn()
                    .mockResolvedValue(new Map([['2:2:1', ETAPA_AJUSTE.INDETERMINADO]])),
                desfechos: jest
                    .fn()
                    .mockResolvedValue(
                        new Map([['2:3:1', SITUACAO_SUGESTAO_TITULO.SEM_CANDIDATO]]),
                    ),
            });
            const titulos = [
                titulo({ docCod: '1' }),
                titulo({ docCod: '2' }),
                titulo({
                    docCod: '3',
                    formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO,
                    temBoleto: false,
                }),
            ];
            await service.avaliarCarteira(titulos);
            expect(titulos.map((t) => t.situacaoPagamento?.principal)).toEqual([
                MOTIVO_PAGAMENTO.DUPLICIDADE,
                MOTIVO_PAGAMENTO.AJUSTE_CENTAVOS_PENDENTE,
                MOTIVO_PAGAMENTO.BOLETO_SEM_DDA,
            ]);
        });

        it('uma fonte que falha vira aviso (fontesIndisponiveis) e não derruba as outras', async () => {
            const { service, log } = make({
                desfechos: jest.fn().mockRejectedValue(new Error('motor fora do ar')),
            });
            const titulos = [
                titulo({ formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO, temBoleto: false }),
                titulo({ titCod: '2', liberado: false }),
            ];
            const resumo = await service.avaliarCarteira(titulos);
            expect(resumo.fontesIndisponiveis).toEqual([FONTE_SITUACAO.BOLETO]);
            // sem a fonte do boleto o motivo dela não é aplicado, mas a alçada continua valendo
            expect(titulos[0]?.situacaoPagamento?.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
            expect(titulos[1]?.situacaoPagamento?.principal).toBe(MOTIVO_PAGAMENTO.ALCADA);
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ fonte: FONTE_SITUACAO.BOLETO }),
                }),
            );
        });

        it('I19i: confirmação órfã por reconhecimento invalidado traz o motivo no detalhe', async () => {
            const invalidado = make({
                desfechos: jest
                    .fn()
                    .mockResolvedValue(new Map([['2:100:1', SITUACAO_SUGESTAO_TITULO.ORFA]])),
                motivosOrfa: new Map([['2:100:1', MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO]]),
            });
            const outro = make({
                desfechos: jest
                    .fn()
                    .mockResolvedValue(new Map([['2:100:1', SITUACAO_SUGESTAO_TITULO.ORFA]])),
                motivosOrfa: new Map([
                    ['2:100:1', 'O Conexos já sinalizou boleto DDA para este título.'],
                ]),
            });
            const a = titulo();
            const b = titulo();
            await invalidado.service.avaliarCarteira([a]);
            await outro.service.avaliarCarteira([b]);
            expect(a.situacaoPagamento?.principal).toBe(MOTIVO_PAGAMENTO.CONFIRMACAO_A_REVISAR);
            expect(a.situacaoPagamento?.detalhe).toBe(MOTIVO_ORFA_RECONHECIMENTO_INVALIDADO);
            // outro motivo de órfã mantém o detalhe de sempre
            expect(b.situacaoPagamento?.detalhe).toBe(
                'o Conexos mudou o título depois da confirmação do boleto',
            );
        });

        it('I19t: preenche `prazoBoleto` (um batch) e cai no vencimento do título sem desfecho', async () => {
            const prazo: PrazoBoleto = {
                prazoEfetivo: '2026-10-20',
                origem: 'BOLETO_SUGERIDO',
                vencimentoTitulo: '2026-10-22',
                vencimentoBoleto: '2026-10-20',
                perdido: false,
            };
            const { service } = make({ prazos: new Map([['2:100:1', prazo]]) });
            const comPrazo = titulo();
            const semDesfecho = titulo({
                docCod: '200',
                vencimento: Date.parse('2026-10-23T15:00:00Z'),
            });
            const semVencimento = titulo({ docCod: '300' });
            await service.avaliarCarteira([comPrazo, semDesfecho, semVencimento]);
            expect(comPrazo.prazoBoleto).toEqual(prazo);
            expect(semDesfecho.prazoBoleto).toEqual({
                prazoEfetivo: '2026-10-23',
                origem: 'TITULO',
                vencimentoTitulo: '2026-10-23',
                perdido: false,
            });
            expect(semVencimento.prazoBoleto).toBeUndefined();
        });

        it('I19t: fonte BOLETO indisponível ⇒ prazo = título (fail-open) com a fonte avisada', async () => {
            const { service } = make({
                desfechos: jest.fn().mockRejectedValue(new Error('motor fora do ar')),
            });
            const t = titulo({ vencimento: Date.parse('2026-10-21T15:00:00Z') });
            const resumo = await service.avaliarCarteira([t]);
            expect(resumo.fontesIndisponiveis).toEqual([FONTE_SITUACAO.BOLETO]);
            expect(t.prazoBoleto).toMatchObject({ origem: 'TITULO', prazoEfetivo: '2026-10-21' });
        });

        it('I19e/I19b inalterados: título que vence hoje não é VENCIDO, com ou sem prazo de boleto', async () => {
            const hojeCivil = '2026-10-20';
            const { service } = make({
                prazos: new Map([
                    [
                        '2:100:1',
                        {
                            prazoEfetivo: hojeCivil,
                            origem: 'BOLETO_SUGERIDO',
                            vencimentoTitulo: '2026-10-25',
                            perdido: true,
                        } as PrazoBoleto,
                    ],
                ]),
            });
            const t = titulo({ diasAteVencimento: 0 });
            await service.avaliarCarteira([t]);
            expect(t.situacaoPagamento?.principal).not.toBe(MOTIVO_PAGAMENTO.VENCIDO);
        });

        it('registra TODAS as fontes que falharam', async () => {
            const { service } = make({
                bloqueios: jest.fn().mockRejectedValue(new Error('db')),
                ajustes: jest.fn().mockRejectedValue(new Error('db')),
            });
            const resumo = await service.avaliarCarteira([titulo()]);
            expect(resumo.fontesIndisponiveis.sort()).toEqual(
                [FONTE_SITUACAO.AJUSTE_CENTAVOS, FONTE_SITUACAO.DUPLICIDADE].sort(),
            );
        });

        it('título em lote FINALIZADO/REMESSA_GERADA fica FORA do resumo (já comprometido)', async () => {
            const { service } = make();
            const titulos = [
                titulo(),
                titulo({ titCod: '2', loteComprometido: { id: 'L1', status: 'FINALIZADO' } }),
                titulo({ titCod: '3', loteComprometido: { id: 'L2', status: 'REMESSA_GERADA' } }),
            ];
            const resumo = await service.avaliarCarteira(titulos);
            expect(resumo.porEstado.PRONTO.qtd).toBe(1);
            // a situação de cada título continua calculada; só o resumo não os conta
            expect(titulos[1]?.situacaoPagamento?.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('título em lote RASCUNHO continua nas contagens (ainda pode ser movido)', async () => {
            const { service } = make();
            const resumo = await service.avaliarCarteira([
                titulo({ loteRascunho: { id: 'L1', automatico: true } }),
            ]);
            expect(resumo.porEstado.PRONTO.qtd).toBe(1);
        });

        it('carteira vazia não quebra e zera o resumo', async () => {
            const { service } = make();
            const resumo = await service.avaliarCarteira([]);
            expect(resumo.porEstado.PRONTO.qtd).toBe(0);
            expect(resumo.porEstado.BLOQUEADO.qtd).toBe(0);
        });
    });

    describe('modo do vínculo do código de barras', () => {
        const boletoConfirmado = () => ({
            desfechos: jest
                .fn()
                .mockResolvedValue(new Map([['2:100:1', SITUACAO_SUGESTAO_TITULO.CONFIRMADA]])),
        });
        const titBoleto = () =>
            titulo({ formaPagamentoConexos: PAGO_POR_CONEXOS.BOLETO, temBoleto: false });

        it('confirmado com o vínculo ligado na filial do título é pronto', async () => {
            const { service } = make({
                ...boletoConfirmado(),
                env: jest.fn().mockResolvedValue({
                    sispagBindCodbarFiliais: 'on',
                    sispagLiveWriteEnabled: true,
                }),
            });
            const t = titBoleto();
            await service.avaliarCarteira([t]);
            expect(t.situacaoPagamento?.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });

        it('o kill-switch global derruba o vínculo: confirmado volta a bloqueado', async () => {
            const { service } = make({
                ...boletoConfirmado(),
                env: jest.fn().mockResolvedValue({
                    sispagBindCodbarFiliais: 'on',
                    sispagLiveWriteEnabled: false,
                }),
            });
            const t = titBoleto();
            await service.avaliarCarteira([t]);
            expect(t.situacaoPagamento?.principal).toBe(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA);
        });

        it('falha ao ler o ambiente é fail-closed: vínculo desligado', async () => {
            const { service } = make({
                ...boletoConfirmado(),
                env: jest.fn().mockRejectedValue(new Error('ssm')),
            });
            const t = titBoleto();
            await service.avaliarCarteira([t]);
            expect(t.situacaoPagamento?.principal).toBe(MOTIVO_PAGAMENTO.BOLETO_SEM_DDA);
        });

        it('por filial: "7:on" liga só a filial 7', async () => {
            const { service } = make({
                desfechos: jest.fn().mockResolvedValue(
                    new Map([
                        ['2:100:1', SITUACAO_SUGESTAO_TITULO.CONFIRMADA],
                        ['7:100:1', SITUACAO_SUGESTAO_TITULO.CONFIRMADA],
                    ]),
                ),
                env: jest.fn().mockResolvedValue({
                    sispagBindCodbarFiliais: '7:on',
                    sispagLiveWriteEnabled: true,
                }),
            });
            const naDois = titBoleto();
            const naSete = { ...titBoleto(), filCod: 7 };
            await service.avaliarCarteira([naDois, naSete]);
            expect(naDois.situacaoPagamento?.estado).toBe(ESTADO_PAGAMENTO.BLOQUEADO);
            expect(naSete.situacaoPagamento?.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });
    });

    describe('aging por dia civil quando o título vem sem ele', () => {
        const dia = (d: number) => Date.UTC(2026, 9, d);

        it('avaliarVarios: vencido ontem bloqueia, vence hoje não', async () => {
            const { service } = make();
            const mapa = await service.avaliarVarios([
                titulo({ titCod: '1', vencimento: dia(19), diasAteVencimento: undefined }),
                titulo({ titCod: '2', vencimento: dia(20), diasAteVencimento: undefined }),
            ]);
            expect(mapa.get('2:100:1')?.principal).toBe(MOTIVO_PAGAMENTO.VENCIDO);
            expect(mapa.get('2:100:2')?.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
        });
    });

    describe('avaliarVivo (inclusão no lote, I19s fail-closed)', () => {
        const chave = { filCod: 2, docCod: '100', titCod: '1' };
        const vivo = { liberado: true, pago: false, vencimento: Date.UTC(2026, 9, 30) };
        const situacaoDe = (a: Awaited<ReturnType<SituacaoPagamentoService['avaliarVivo']>>) =>
            a.resultado === AVALIACAO_INCLUSAO.AVALIADA ? a.situacao : undefined;

        it('título fora da carteira persistida: FORA_DA_CARTEIRA, sem situação inventada', async () => {
            const { service } = make();
            expect(await service.avaliarVivo(chave, vivo)).toEqual({
                resultado: AVALIACAO_INCLUSAO.FORA_DA_CARTEIRA,
            });
        });

        it('leitura do título falhou: LEITURA_FALHOU + WARN, nunca "pronto"', async () => {
            const { service, log } = make({
                buscarPorChave: jest.fn().mockRejectedValue(new Error('pool esgotado')),
            });
            expect(await service.avaliarVivo(chave, vivo)).toEqual({
                resultado: AVALIACAO_INCLUSAO.LEITURA_FALHOU,
            });
            expect(log.warn).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('inclusão recusada'),
                }),
            );
        });

        it('fonte de contexto que caiu vem em `fontesIndisponiveis`', async () => {
            const { service } = make({
                buscarPorChave: jest.fn().mockResolvedValue(titulo()),
                bloqueios: jest.fn().mockRejectedValue(new Error('timeout')),
            });
            expect(await service.avaliarVivo(chave, vivo)).toMatchObject({
                resultado: AVALIACAO_INCLUSAO.AVALIADA,
                situacao: { estado: ESTADO_PAGAMENTO.PRONTO },
                fontesIndisponiveis: [FONTE_SITUACAO.DUPLICIDADE],
            });
        });

        it('mistura o persistido (tipo, forma) com o ao vivo (aprovação, vencimento)', async () => {
            const persistido = titulo({
                liberado: false, // desatualizado: no Conexos já foi aprovado
                vencimento: Date.UTC(2026, 9, 10), // desatualizado: renegociado para o futuro
                tpdDesNome: 'NOTA FISCAL (PERMUTA)',
                diasAteVencimento: undefined,
            });
            const { service } = make({ buscarPorChave: jest.fn().mockResolvedValue(persistido) });
            const a = await service.avaliarVivo(chave, vivo);
            // aprovação e vencimento vêm do ao vivo; o tipo, do persistido
            expect(situacaoDe(a)?.motivos).toEqual([MOTIVO_PAGAMENTO.TIPO_PERMUTA]);
            expect(a).toMatchObject({ fontesIndisponiveis: [] });
        });

        it('vencimento ao vivo no passado bloqueia mesmo que o persistido estivesse em dia', async () => {
            const persistido = titulo({ vencimento: Date.UTC(2026, 9, 30) });
            const { service } = make({ buscarPorChave: jest.fn().mockResolvedValue(persistido) });
            const a = await service.avaliarVivo(chave, {
                ...vivo,
                vencimento: Date.UTC(2026, 9, 15),
            });
            expect(situacaoDe(a)?.principal).toBe(MOTIVO_PAGAMENTO.VENCIDO);
        });

        it('não altera o título persistido', async () => {
            const persistido = titulo({ liberado: false });
            const { service } = make({ buscarPorChave: jest.fn().mockResolvedValue(persistido) });
            await service.avaliarVivo(chave, vivo);
            expect(persistido.situacaoPagamento).toBeUndefined();
            expect(persistido.liberado).toBe(false);
        });
    });

    describe('avaliarVivos e avaliarGravados (ADR-0076)', () => {
        const vivo = { liberado: true, pago: false, vencimento: Date.UTC(2026, 9, 30) };

        it('avaliarVivos: UMA leitura da carteira e UM contexto, resultado na ordem da entrada', async () => {
            const bloqueios = jest.fn().mockResolvedValue([]);
            const buscarPorChaves = jest
                .fn()
                .mockResolvedValue([
                    titulo({ titCod: '2' }),
                    titulo({ titCod: '1', liberado: false }),
                ]);
            const { service } = make({ bloqueios, buscarPorChaves });
            const r = await service.avaliarVivos([
                { chave: { filCod: 2, docCod: '100', titCod: '1' }, vivo },
                { chave: { filCod: 2, docCod: '100', titCod: '9' }, vivo },
                {
                    chave: { filCod: 2, docCod: '100', titCod: '2' },
                    vivo: { ...vivo, liberado: false },
                },
            ]);
            expect(buscarPorChaves).toHaveBeenCalledTimes(1);
            expect(bloqueios).toHaveBeenCalledTimes(1);
            expect(r.map((a) => a.resultado)).toEqual(['AVALIADA', 'FORA_DA_CARTEIRA', 'AVALIADA']);
            // a aprovação é a AO VIVO, não a gravada
            expect(r[0]).toMatchObject({ situacao: { estado: ESTADO_PAGAMENTO.PRONTO } });
            expect(r[2]).toMatchObject({ situacao: { principal: MOTIVO_PAGAMENTO.ALCADA } });
        });

        it('avaliarVivos: leitura da carteira falhou → todos LEITURA_FALHOU', async () => {
            const { service } = make({
                buscarPorChaves: jest.fn().mockRejectedValue(new Error('timeout')),
            });
            const r = await service.avaliarVivos([
                { chave: { filCod: 2, docCod: '100', titCod: '1' }, vivo },
                { chave: { filCod: 2, docCod: '100', titCod: '2' }, vivo },
            ]);
            expect(r).toEqual([
                { resultado: AVALIACAO_INCLUSAO.LEITURA_FALHOU },
                { resultado: AVALIACAO_INCLUSAO.LEITURA_FALHOU },
            ]);
        });

        it('avaliarGravados: situação pela carteira gravada, com as fontes que falharam', async () => {
            const { service } = make({
                buscarPorChaves: jest
                    .fn()
                    .mockResolvedValue([
                        titulo({ titCod: '1', liberado: false, diasAteVencimento: undefined }),
                    ]),
                ajustes: jest.fn().mockRejectedValue(new Error('x')),
            });
            const r = await service.avaliarGravados([
                { filCod: 2, docCod: '100', titCod: '1' },
                { filCod: 2, docCod: '100', titCod: '2' },
            ]);
            expect(r.situacoes.get('2:100:1')?.principal).toBe(MOTIVO_PAGAMENTO.ALCADA);
            expect(r.situacoes.has('2:100:2')).toBe(false);
            expect(r.fontesIndisponiveis).toEqual([FONTE_SITUACAO.AJUSTE_CENTAVOS]);
        });
    });

    describe('avaliarVarios', () => {
        it('avaliarVarios lê o contexto UMA vez e devolve por chave', async () => {
            const bloqueios = jest.fn().mockResolvedValue([]);
            const { service } = make({ bloqueios });
            const mapa = await service.avaliarVarios([
                titulo(),
                titulo({ titCod: '2', liberado: false }),
            ]);
            expect(bloqueios).toHaveBeenCalledTimes(1);
            expect(mapa.get('2:100:1')?.estado).toBe(ESTADO_PAGAMENTO.PRONTO);
            expect(mapa.get('2:100:2')?.estado).toBe(ESTADO_PAGAMENTO.BLOQUEADO);
        });
    });
});

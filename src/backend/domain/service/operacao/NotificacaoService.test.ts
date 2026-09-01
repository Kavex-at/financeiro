import 'reflect-metadata';
import {
    ALERTA_SEVERIDADE,
    ALERTA_TIPO,
    type Alerta,
    type AlertaNovo,
    dedupKeyDe,
} from '../../interface/operacao/Alerta.js';
import type { AlertSink } from '../../interface/operacao/AlertSink.js';
import NotificacaoService from './NotificacaoService.js';

const novo = (over: Partial<AlertaNovo> = {}): AlertaNovo => ({
    tipo: ALERTA_TIPO.JOB_PARADO,
    alvo: 'recebimentos-extratos',
    severidade: ALERTA_SEVERIDADE.ERRO,
    janelaInicio: new Date('2026-09-01T12:00:00.000Z'),
    detalhe: { idadeMs: 4 * 60 * 60 * 1000 },
    ...over,
});

const persistido = (n: AlertaNovo): Alerta => ({
    ...n,
    id: 1,
    dedupKey: dedupKeyDe(n),
    sinkResultados: [],
    criadoEm: '2026-09-01T12:00:01.000Z',
});

const logServiceFake = () => ({ error: jest.fn().mockResolvedValue(undefined) });

const sinkOk = (nome: string): AlertSink => ({
    nome,
    entregar: jest.fn().mockResolvedValue(undefined),
});

const sinkQueExplode = (nome: string, msg = 'SMTP recusou'): AlertSink => ({
    nome,
    entregar: jest.fn().mockRejectedValue(new Error(msg)),
});

describe('dedupKeyDe', () => {
    it('trunca a janela ao minuto — detectores com segundos de diferença colidem de propósito', () => {
        const a = dedupKeyDe(novo({ janelaInicio: new Date('2026-09-01T12:00:03.500Z') }));
        const b = dedupKeyDe(novo({ janelaInicio: new Date('2026-09-01T12:00:58.000Z') }));
        expect(a).toBe(b);
    });

    it('janela nova gera chave nova — parado há dois dias merece ser dito de novo', () => {
        const a = dedupKeyDe(novo({ janelaInicio: new Date('2026-09-01T12:00:00.000Z') }));
        const b = dedupKeyDe(novo({ janelaInicio: new Date('2026-09-01T13:00:00.000Z') }));
        expect(a).not.toBe(b);
    });

    it('separa por tipo e por alvo', () => {
        expect(dedupKeyDe(novo({ alvo: 'a' }))).not.toBe(dedupKeyDe(novo({ alvo: 'b' })));
        expect(dedupKeyDe(novo())).not.toBe(dedupKeyDe(novo({ tipo: ALERTA_TIPO.JOB_FALHOU })));
    });
});

describe('NotificacaoService — dedup', () => {
    it('suprime o segundo alerta da mesma janela sem chamar sink nenhum', async () => {
        const sink = sinkOk('painel');
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(null), // banco recusou por ux_alerta_dedup
            registrarEntrega: jest.fn(),
        };
        const service = new NotificacaoService(repo as never, [sink], logServiceFake() as never);

        await expect(service.emitir(novo())).resolves.toBeNull();
        expect(sink.entregar).not.toHaveBeenCalled();
        expect(repo.registrarEntrega).not.toHaveBeenCalled();
    });

    it('supressão é desfecho normal, não erro', async () => {
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(null),
            registrarEntrega: jest.fn(),
        };
        const service = new NotificacaoService(repo as never, [], logServiceFake() as never);
        await expect(service.emitir(novo())).resolves.toBeNull();
    });
});

describe('NotificacaoService — fan-out e o invariante I5', () => {
    it('entrega a TODOS os sinks registrados (o port aceita um segundo sem mudar assinatura)', async () => {
        const painel = sinkOk('painel');
        const email = sinkOk('email');
        const n = novo();
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(persistido(n)),
            registrarEntrega: jest.fn().mockResolvedValue(undefined),
        };
        const service = new NotificacaoService(
            repo as never,
            [painel, email],
            logServiceFake() as never,
        );

        const emitido = await service.emitir(n);

        expect(painel.entregar).toHaveBeenCalledTimes(1);
        expect(email.entregar).toHaveBeenCalledTimes(1);
        expect(emitido?.sinkResultados).toEqual([
            { sink: 'painel', ok: true },
            { sink: 'email', ok: true },
        ]);
    });

    it('sink que lança NÃO propaga — o alerting não pode causar o incidente que vigia', async () => {
        const n = novo();
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(persistido(n)),
            registrarEntrega: jest.fn().mockResolvedValue(undefined),
        };
        const service = new NotificacaoService(
            repo as never,
            [sinkQueExplode('email')],
            logServiceFake() as never,
        );

        await expect(service.emitir(n)).resolves.not.toBeNull();
    });

    it('a falha do sink não passa em silêncio — fica em sinkResultados', async () => {
        const n = novo();
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(persistido(n)),
            registrarEntrega: jest.fn().mockResolvedValue(undefined),
        };
        const service = new NotificacaoService(
            repo as never,
            [sinkOk('painel'), sinkQueExplode('email', 'SMTP recusou')],
            logServiceFake() as never,
        );

        const emitido = await service.emitir(n);

        expect(emitido?.sinkResultados).toEqual([
            { sink: 'painel', ok: true },
            { sink: 'email', ok: false, erro: 'SMTP recusou' },
        ]);
        expect(repo.registrarEntrega).toHaveBeenCalledWith(1, emitido?.sinkResultados);
    });

    it('um sink caído não impede a entrega dos outros', async () => {
        const painel = sinkOk('painel');
        const n = novo();
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(persistido(n)),
            registrarEntrega: jest.fn().mockResolvedValue(undefined),
        };
        const service = new NotificacaoService(
            repo as never,
            [sinkQueExplode('email'), painel],
            logServiceFake() as never,
        );

        await service.emitir(n);
        expect(painel.entregar).toHaveBeenCalledTimes(1);
    });

    it('falha ao GRAVAR o desfecho também não derruba — o alerta já existe', async () => {
        const n = novo();
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(persistido(n)),
            registrarEntrega: jest.fn().mockRejectedValue(new Error('db fora')),
        };
        const service = new NotificacaoService(
            repo as never,
            [sinkOk('painel')],
            logServiceFake() as never,
        );

        await expect(service.emitir(n)).resolves.not.toBeNull();
    });

    it('loga a falha do sink, e um LogService quebrado ainda assim não derruba', async () => {
        const n = novo();
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(persistido(n)),
            registrarEntrega: jest.fn().mockResolvedValue(undefined),
        };
        const log = { error: jest.fn().mockRejectedValue(new Error('log fora')) };
        const service = new NotificacaoService(
            repo as never,
            [sinkQueExplode('email')],
            log as never,
        );

        await expect(service.emitir(n)).resolves.not.toBeNull();
        expect(log.error).toHaveBeenCalled();
    });

    it('sem sink nenhum registrado, ainda persiste e não quebra', async () => {
        const n = novo();
        const repo = {
            criarSeNovo: jest.fn().mockResolvedValue(persistido(n)),
            registrarEntrega: jest.fn().mockResolvedValue(undefined),
        };
        const service = new NotificacaoService(repo as never, [], logServiceFake() as never);

        const emitido = await service.emitir(n);
        expect(emitido?.sinkResultados).toEqual([]);
    });
});

describe('DbAlertSink', () => {
    it('é no-op: a persistência acontece a montante, o sink só torna o canal explícito', async () => {
        const { default: DbAlertSink } = await import('./DbAlertSink.js');
        const sink = new DbAlertSink();
        expect(sink.nome).toBe('painel');
        await expect(sink.entregar(persistido(novo()))).resolves.toBeUndefined();
    });
});

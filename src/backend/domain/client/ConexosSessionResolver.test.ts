import 'reflect-metadata';
import type SecretCipher from '../libs/crypto/SecretCipher.js';
import type EnvironmentProvider from '../libs/environment/EnvironmentProvider.js';
import { conexosRequestContext } from '../libs/requestContext/ConexosRequestContext.js';
import type UserRepository from '../repository/auth/UserRepository.js';
import type LogService from '../service/LogService.js';
import type ConexosSessionRegistry from './ConexosSessionRegistry.js';
import ConexosSessionResolver from './ConexosSessionResolver.js';

const ROBOT = { tag: 'robot', ensureSid: jest.fn() } as never;

const build = (over: {
    vinculo?: { conexosUsername: string; conexosPasswordEnc: string } | null;
    decrypt?: () => Promise<string>;
    userEnsureSid?: () => Promise<void>;
}) => {
    const userSession = { tag: 'user', ensureSid: jest.fn(over.userEnsureSid ?? (async () => {})) };
    const repo = {
        getVinculoConexos: jest.fn().mockResolvedValue(over.vinculo ?? null),
    } as unknown as UserRepository;
    const cipher = {
        decrypt: jest.fn(over.decrypt ?? (async () => 'senha-clara')),
    } as unknown as SecretCipher;
    const registry = {
        robot: jest.fn().mockReturnValue(ROBOT),
        forUser: jest.fn().mockReturnValue(userSession),
    } as unknown as ConexosSessionRegistry;
    const environmentProvider = {
        getEnvironmentVars: jest.fn().mockResolvedValue({ conexosLogin: 'MPS_ROBO' }),
    } as unknown as EnvironmentProvider;
    const logService = { warn: jest.fn().mockResolvedValue(undefined) } as unknown as LogService;
    return {
        resolver: new ConexosSessionResolver(
            repo,
            cipher,
            registry,
            environmentProvider,
            logService,
        ),
        userSession,
        registry,
        logService,
    };
};

/** Resolve dentro de uma request e devolve a identidade publicada no contexto. */
const resolveCapturandoIdentidade = async (
    resolver: ConexosSessionResolver,
    platformUsername: string,
) =>
    conexosRequestContext.run({ platformUsername }, async () => {
        await resolver.resolve();
        return conexosRequestContext.getStore()?.identity;
    });

describe('ConexosSessionResolver.resolve', () => {
    it('sem request/contexto → robô', async () => {
        const { resolver } = build({});
        expect(await resolver.resolve()).toBe(ROBOT);
    });

    it('usuário com vínculo válido → sessão dele', async () => {
        const { resolver, userSession } = build({
            vinculo: { conexosUsername: 'MARILYN_MUTAFCI', conexosPasswordEnc: 'enc' },
        });
        const out = await conexosRequestContext.run({ platformUsername: 'marilyn@kavex.com' }, () =>
            resolver.resolve(),
        );
        expect(out).toBe(userSession);
    });

    it('usuário sem vínculo → robô', async () => {
        const { resolver } = build({ vinculo: null });
        const out = await conexosRequestContext.run({ platformUsername: 'novato@kavex.com' }, () =>
            resolver.resolve(),
        );
        expect(out).toBe(ROBOT);
    });

    it('login Conexos do usuário falha (credencial inválida) → robô', async () => {
        const { resolver } = build({
            vinculo: { conexosUsername: 'X', conexosPasswordEnc: 'enc' },
            userEnsureSid: async () => {
                throw new Error('LOGIN_ERROR');
            },
        });
        const out = await conexosRequestContext.run({ platformUsername: 'x@kavex.com' }, () =>
            resolver.resolve(),
        );
        expect(out).toBe(ROBOT);
    });

    it('senha não decifra (chave trocada) → robô', async () => {
        const { resolver } = build({
            vinculo: { conexosUsername: 'X', conexosPasswordEnc: 'enc' },
            decrypt: async () => {
                throw new Error('bad tag');
            },
        });
        const out = await conexosRequestContext.run({ platformUsername: 'x@kavex.com' }, () =>
            resolver.resolve(),
        );
        expect(out).toBe(ROBOT);
    });

    it('cacheia a resolução no contexto da request (1 lookup só)', async () => {
        const { resolver, registry } = build({
            vinculo: { conexosUsername: 'X', conexosPasswordEnc: 'enc' },
        });
        await conexosRequestContext.run({ platformUsername: 'x@kavex.com' }, async () => {
            await resolver.resolve();
            await resolver.resolve();
        });
        expect((registry.forUser as jest.Mock).mock.calls.length).toBe(1);
    });
});

describe('ConexosSessionResolver.testarVinculo', () => {
    it('ausente quando não há vínculo', async () => {
        const { resolver } = build({ vinculo: null });
        expect(await resolver.testarVinculo('x@kavex.com')).toBe('ausente');
    });
    it('ok quando o login de teste passa', async () => {
        const { resolver } = build({
            vinculo: { conexosUsername: 'X', conexosPasswordEnc: 'enc' },
        });
        expect(await resolver.testarVinculo('x@kavex.com')).toBe('ok');
    });
    it('falha quando o login de teste erra', async () => {
        const { resolver } = build({
            vinculo: { conexosUsername: 'X', conexosPasswordEnc: 'enc' },
            userEnsureSid: async () => {
                throw new Error('nope');
            },
        });
        expect(await resolver.testarVinculo('x@kavex.com')).toBe('falha');
    });
});

describe('ConexosSessionResolver — I-1: o fallback com vínculo presente fala (ADR-0041)', () => {
    it('senha não decifra → warn com motivo `decrypt`, e ainda assim devolve o robô', async () => {
        const { resolver, logService } = build({
            vinculo: { conexosUsername: 'MARILYN_MUTAFCI', conexosPasswordEnc: 'enc' },
            decrypt: async () => {
                throw new Error('bad tag');
            },
        });

        const out = await conexosRequestContext.run({ platformUsername: 'm@kavex.com' }, () =>
            resolver.resolve(),
        );

        expect(out).toBe(ROBOT);
        expect(logService.warn as jest.Mock).toHaveBeenCalledTimes(1);
        expect((logService.warn as jest.Mock).mock.calls[0][0]).toMatchObject({
            data: {
                platformUsername: 'm@kavex.com',
                conexosUsername: 'MARILYN_MUTAFCI',
                motivo: 'decrypt',
                erro: 'bad tag',
            },
        });
    });

    it('login do ERP falha → warn com motivo `login` (o caso do incidente 2026-08-25)', async () => {
        const { resolver, logService } = build({
            vinculo: { conexosUsername: 'MARILYN_MUTAFCI', conexosPasswordEnc: 'enc' },
            userEnsureSid: async () => {
                throw new Error('LOGIN_ERROR');
            },
        });

        const out = await conexosRequestContext.run({ platformUsername: 'm@kavex.com' }, () =>
            resolver.resolve(),
        );

        expect(out).toBe(ROBOT);
        expect(logService.warn as jest.Mock).toHaveBeenCalledTimes(1);
        expect((logService.warn as jest.Mock).mock.calls[0][0]).toMatchObject({
            data: { conexosUsername: 'MARILYN_MUTAFCI', motivo: 'login', erro: 'LOGIN_ERROR' },
        });
    });

    it('o warn NUNCA carrega a senha, cifrada ou em claro', async () => {
        const { resolver, logService } = build({
            vinculo: { conexosUsername: 'X', conexosPasswordEnc: 'blob-cifrado' },
            userEnsureSid: async () => {
                throw new Error('nope');
            },
        });

        await conexosRequestContext.run({ platformUsername: 'x@kavex.com' }, () =>
            resolver.resolve(),
        );

        const payload = JSON.stringify((logService.warn as jest.Mock).mock.calls[0][0]);
        expect(payload).not.toContain('blob-cifrado');
        expect(payload).not.toContain('senha-clara');
    });

    it('usuário SEM vínculo → robô em silêncio (caminho normal, logar viraria ruído)', async () => {
        const { resolver, logService } = build({ vinculo: null });
        await conexosRequestContext.run({ platformUsername: 'novato@kavex.com' }, () =>
            resolver.resolve(),
        );
        expect(logService.warn as jest.Mock).not.toHaveBeenCalled();
    });

    it('fora de request (job/cron) → robô em silêncio', async () => {
        const { resolver, logService } = build({});
        expect(await resolver.resolve()).toBe(ROBOT);
        expect(logService.warn as jest.Mock).not.toHaveBeenCalled();
    });

    it('testarVinculo NÃO loga — é teste pedido pela UI, não degradação de execução', async () => {
        const { resolver, logService } = build({
            vinculo: { conexosUsername: 'X', conexosPasswordEnc: 'enc' },
            userEnsureSid: async () => {
                throw new Error('nope');
            },
        });
        expect(await resolver.testarVinculo('x@kavex.com')).toBe('falha');
        expect(logService.warn as jest.Mock).not.toHaveBeenCalled();
    });
});

describe('ConexosSessionResolver — publica a identidade resolvida (I-2, ADR-0041)', () => {
    it('vínculo válido → identidade do usuário, viaRobo=false', async () => {
        const { resolver } = build({
            vinculo: { conexosUsername: 'SIMONE_PEREIRA', conexosPasswordEnc: 'enc' },
        });
        expect(await resolveCapturandoIdentidade(resolver, 's@kavex.com')).toEqual({
            conexosUsername: 'SIMONE_PEREIRA',
            viaRobo: false,
        });
    });

    it('degradou para o robô → identidade DO ROBÔ, viaRobo=true (o fallback fica registrado)', async () => {
        const { resolver } = build({
            vinculo: { conexosUsername: 'MARILYN_MUTAFCI', conexosPasswordEnc: 'enc' },
            userEnsureSid: async () => {
                throw new Error('LOGIN_ERROR');
            },
        });
        expect(await resolveCapturandoIdentidade(resolver, 'm@kavex.com')).toEqual({
            conexosUsername: 'MPS_ROBO',
            viaRobo: true,
        });
    });

    it('usuário sem vínculo → identidade do robô', async () => {
        const { resolver } = build({ vinculo: null });
        expect(await resolveCapturandoIdentidade(resolver, 'novato@kavex.com')).toEqual({
            conexosUsername: 'MPS_ROBO',
            viaRobo: true,
        });
    });
});

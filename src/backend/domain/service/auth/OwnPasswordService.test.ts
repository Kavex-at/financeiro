import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import CurrentPasswordInvalidError from '../../errors/CurrentPasswordInvalidError.js';
import PasswordPolicyError from '../../errors/PasswordPolicyError.js';
import SupabaseAuthRejectedError from '../../errors/SupabaseAuthRejectedError.js';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import type { AccessEvent } from '../../repository/auth/AccessRepository.js';
import type {
    AppUser,
    AntesDoCommit,
    CredencialLinha,
} from '../../repository/auth/UserRepository.js';
import CredentialMirror from './CredentialMirror.js';
import OwnPasswordService from './OwnPasswordService.js';
import PasswordPolicy from './PasswordPolicy.js';

const UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';
const ATUAL = 'Senha-atual-1';
const NOVA = 'Senha-nova-22';
const TOKEN_CHAMADOR = 'eyJhbGciOiJFUzI1NiJ9.chamador.assinatura';
const TOKEN_SONDA = 'access-da-sonda';

let hashAtual = '';
beforeAll(async () => {
    hashAtual = await bcrypt.hash(ATUAL, 4);
});

afterEach(() => {
    jest.restoreAllMocks();
});

interface Montagem {
    modo?: 'local' | 'supabase';
    vinculado?: boolean;
    email?: string | null;
    adminConfigurado?: boolean;
    falhaNoCommit?: boolean;
}

/**
 * Banco falso com transação de verdade (no sentido do teste): `updatePassword` aplica o hash e o
 * evento, roda o passo e, se ele lançar, devolve a linha ao que era e descarta o evento.
 */
const montar = (m: Montagem = {}) => {
    const ordem: string[] = [];
    const usuario: AppUser = {
        id: 4,
        username: 'beto@columbiabr.com',
        passwordHash: hashAtual,
        role: 'user',
        ativo: true,
        ...(m.email === null ? {} : { email: m.email ?? 'beto@columbiabr.com' }),
        ...((m.vinculado ?? true) ? { authUserId: UUID } : {}),
    };
    const eventos: AccessEvent[] = [];
    const repo = {
        findByUsername: jest.fn(async (username: string) =>
            username === usuario.username ? { ...usuario } : null,
        ),
        updatePassword: jest.fn(
            async (
                id: number,
                hash: string,
                opcoes: { antesDoCommit?: AntesDoCommit; evento?: AccessEvent } = {},
            ) => {
                if (id !== usuario.id) return false;
                ordem.push('BEGIN');
                const antes = usuario.passwordHash;
                usuario.passwordHash = hash;
                if (opcoes.evento) eventos.push(opcoes.evento);
                try {
                    const linha: CredencialLinha = {
                        id: usuario.id,
                        username: usuario.username,
                        ativo: true,
                        passwordHash: hash,
                        ...(usuario.email ? { email: usuario.email } : {}),
                        ...(usuario.authUserId ? { authUserId: usuario.authUserId } : {}),
                    };
                    await opcoes.antesDoCommit?.({ tx: true } as never, linha);
                    if (m.falhaNoCommit) throw new Error('commit falhou');
                    ordem.push('COMMIT');
                    return true;
                } catch (error) {
                    usuario.passwordHash = antes;
                    if (opcoes.evento) eventos.pop();
                    ordem.push('ROLLBACK');
                    throw error;
                }
            },
        ),
        setAuthUserId: jest.fn(),
        findIdByAuthUserId: jest.fn(),
    };
    const client = {
        isAdminConfigured: jest.fn().mockResolvedValue(m.adminConfigurado ?? true),
        signInWithPassword: jest.fn(async (_email: string, senha: string) => {
            ordem.push('sonda');
            if (senha !== ATUAL) throw new SupabaseAuthRejectedError('invalid_credentials', 400);
            return { accessToken: TOKEN_SONDA, refreshToken: 'rt', expiresAt: 1, userId: UUID };
        }),
        logout: jest.fn(async (_token: string, scope = 'local') => {
            ordem.push(`logout-${scope}`);
        }),
        adminUpdateUser: jest.fn(async () => {
            ordem.push('admin-update');
            return { id: UUID, banned: false };
        }),
        updateOwnPassword: jest.fn(async () => {
            ordem.push('put-user');
        }),
        adminCreateUser: jest.fn(),
        adminFindUserByEmail: jest.fn(),
    };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const env = {
        getEnvironmentVars: jest.fn().mockResolvedValue({ authProvider: m.modo ?? 'local' }),
    };
    const mirror = new CredentialMirror(client as never, repo as never, log as never);
    const service = new OwnPasswordService(
        repo as never,
        mirror,
        client as never,
        env as never,
        new PasswordPolicy(),
        log as never,
    );
    return { service, repo, client, log, usuario, eventos, ordem };
};

const entrada = (over: Partial<Parameters<OwnPasswordService['alterar']>[0]> = {}) => ({
    username: 'beto@columbiabr.com',
    senhaAtual: ATUAL,
    novaSenha: NOVA,
    tokenDoChamador: TOKEN_CHAMADOR,
    algDoToken: 'ES256',
    ...over,
});

const logDeSucesso = (log: { info: jest.Mock }) =>
    log.info.mock.calls.find(([p]) => p.message === 'senha alterada pelo próprio usuário')?.[0];

describe('OwnPasswordService — política antes de tudo (caso 2 e 3)', () => {
    it('nova === atual → PasswordPolicyError [diferente_da_atual]; zero bcrypt.compare, sonda e GoTrue', async () => {
        const { service, client, repo } = montar({ modo: 'supabase' });
        const compare = jest.spyOn(bcrypt, 'compare');
        const erro = await service.alterar(entrada({ novaSenha: ATUAL })).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(PasswordPolicyError);
        expect((erro as PasswordPolicyError).regras).toEqual(['diferente_da_atual']);
        expect(compare).not.toHaveBeenCalled();
        expect(client.signInWithPassword).not.toHaveBeenCalled();
        expect(client.adminUpdateUser).not.toHaveBeenCalled();
        expect(client.updateOwnPassword).not.toHaveBeenCalled();
        expect(repo.updatePassword).not.toHaveBeenCalled();
    });

    it("7 caracteres e 'ç' × 40 → PasswordPolicyError [tamanho], sem tocar bcrypt", async () => {
        const { service } = montar();
        const compare = jest.spyOn(bcrypt, 'compare');
        for (const novaSenha of ['abcdefg', 'ç'.repeat(40)]) {
            const erro = await service.alterar(entrada({ novaSenha })).catch((e: unknown) => e);
            expect(erro).toBeInstanceOf(PasswordPolicyError);
            expect((erro as PasswordPolicyError).regras).toEqual(['tamanho']);
        }
        expect(compare).not.toHaveBeenCalled();
    });
});

describe('OwnPasswordService — modo local', () => {
    it('caso 1 (local, vinculado, Bearer HS256): bcrypt novo, adminUpdateUser, 1 evento, revogacao pulada-hs256', async () => {
        const { service, usuario, client, eventos, log } = montar({ modo: 'local' });
        await service.alterar(entrada({ algDoToken: 'HS256', tokenDoChamador: 'tok-hs256' }));
        expect(await bcrypt.compare(NOVA, usuario.passwordHash)).toBe(true);
        expect(usuario.passwordHash.startsWith('$2a$12$')).toBe(true);
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, { password: NOVA });
        expect(client.updateOwnPassword).not.toHaveBeenCalled();
        expect(client.logout).not.toHaveBeenCalled();
        expect(client.signInWithPassword).not.toHaveBeenCalled();
        expect(eventos).toEqual([
            {
                actor: 'beto@columbiabr.com',
                targetId: 4,
                type: 'senha',
                before: null,
                after: null,
            },
        ]);
        expect(logDeSucesso(log)?.data).toEqual({
            usuario: 'beto@columbiabr.com',
            modo: 'local',
            revogacao: 'pulada-hs256',
        });
    });

    it('caso 4: senha atual errada → CurrentPasswordInvalidError; nada gravado, nenhum evento', async () => {
        const { service, usuario, eventos, repo, client } = montar({ modo: 'local' });
        await expect(
            service.alterar(entrada({ senhaAtual: 'Errada-123', algDoToken: 'HS256' })),
        ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
        expect(usuario.passwordHash).toBe(hashAtual);
        expect(eventos).toEqual([]);
        expect(repo.updatePassword).not.toHaveBeenCalled();
        expect(client.adminUpdateUser).not.toHaveBeenCalled();
    });

    it('caso 6: sem auth_user_id → só local, nenhuma chamada ao GoTrue, evento gravado, revogacao sem-vinculo', async () => {
        const { service, client, eventos, log } = montar({ modo: 'local', vinculado: false });
        await service.alterar(entrada({ algDoToken: 'HS256' }));
        for (const fn of [
            client.adminUpdateUser,
            client.updateOwnPassword,
            client.signInWithPassword,
            client.logout,
        ]) {
            expect(fn).not.toHaveBeenCalled();
        }
        expect(eventos).toHaveLength(1);
        expect(logDeSucesso(log)?.data.revogacao).toBe('sem-vinculo');
    });

    it('sem a API admin configurada: só local (D3), revogacao sem-vinculo', async () => {
        const { service, client, log } = montar({ modo: 'local', adminConfigurado: false });
        await service.alterar(entrada({ algDoToken: 'HS256' }));
        expect(client.adminUpdateUser).not.toHaveBeenCalled();
        expect(logDeSucesso(log)?.data.revogacao).toBe('sem-vinculo');
    });

    it('caso 5 (local, vinculado): GoTrue fora no passo de escrita → erro sobe, ROLLBACK, sem evento', async () => {
        const { service, client, usuario, eventos, ordem } = montar({ modo: 'local' });
        client.adminUpdateUser.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        await expect(service.alterar(entrada({ algDoToken: 'HS256' }))).rejects.toBeInstanceOf(
            SupabaseAuthUnavailableError,
        );
        expect(usuario.passwordHash).toBe(hashAtual);
        expect(eventos).toEqual([]);
        expect(ordem).toContain('ROLLBACK');
    });
});

describe('OwnPasswordService — modo supabase', () => {
    it('caso 1/9 (RAMO = put-user): sonda pelo E-MAIL, logout local da sonda ANTES da tx, PUT /user com o token do chamador', async () => {
        const { service, client, ordem, eventos, log } = montar({ modo: 'supabase' });
        await service.alterar(entrada());
        expect(client.signInWithPassword).toHaveBeenCalledWith('beto@columbiabr.com', ATUAL);
        expect(client.logout).toHaveBeenCalledWith(TOKEN_SONDA, 'local');
        expect(client.updateOwnPassword).toHaveBeenCalledWith(TOKEN_CHAMADOR, NOVA);
        expect(client.adminUpdateUser).not.toHaveBeenCalled();
        // A sessão atual não é revogada: nenhum logout com o token do chamador, nem scope=others.
        expect(client.logout).not.toHaveBeenCalledWith(TOKEN_CHAMADOR, expect.anything());
        expect(client.logout).not.toHaveBeenCalledWith(expect.anything(), 'others');
        expect(ordem).toEqual(['sonda', 'logout-local', 'BEGIN', 'put-user', 'COMMIT']);
        expect(eventos).toHaveLength(1);
        expect(logDeSucesso(log)?.data).toEqual({
            usuario: 'beto@columbiabr.com',
            modo: 'supabase',
            revogacao: 'gotrue-put-user',
        });
    });

    it('não usa bcrypt.compare no modo supabase (a sonda é a verificação)', async () => {
        const { service } = montar({ modo: 'supabase' });
        const compare = jest.spyOn(bcrypt, 'compare');
        await service.alterar(entrada());
        expect(compare).not.toHaveBeenCalled();
    });

    it('Bearer HS256 no modo supabase: adminUpdateUser, nenhum PUT /user, revogacao pulada-hs256', async () => {
        const { service, client, log } = montar({ modo: 'supabase' });
        await service.alterar(entrada({ algDoToken: 'HS256', tokenDoChamador: 'tok-hs256' }));
        expect(client.updateOwnPassword).not.toHaveBeenCalled();
        expect(client.adminUpdateUser).toHaveBeenCalledWith(UUID, { password: NOVA });
        expect(logDeSucesso(log)?.data.revogacao).toBe('pulada-hs256');
    });

    it('caso 4 (supabase): GoTrue recusa a sonda → CurrentPasswordInvalidError; nada gravado', async () => {
        const { service, usuario, eventos, client } = montar({ modo: 'supabase' });
        await expect(service.alterar(entrada({ senhaAtual: 'Errada-123' }))).rejects.toBeInstanceOf(
            CurrentPasswordInvalidError,
        );
        expect(usuario.passwordHash).toBe(hashAtual);
        expect(eventos).toEqual([]);
        expect(client.updateOwnPassword).not.toHaveBeenCalled();
    });

    it('caso 5: GoTrue fora na SONDA → SupabaseAuthUnavailableError; nada gravado', async () => {
        const { service, client, usuario, eventos, repo } = montar({ modo: 'supabase' });
        client.signInWithPassword.mockRejectedValue(
            new SupabaseAuthUnavailableError('x', 'server_error', 502),
        );
        await expect(service.alterar(entrada())).rejects.toBeInstanceOf(
            SupabaseAuthUnavailableError,
        );
        expect(repo.updatePassword).not.toHaveBeenCalled();
        expect(usuario.passwordHash).toBe(hashAtual);
        expect(eventos).toEqual([]);
    });

    it('caso 5: GoTrue 429 na sonda → sobe com rateLimited (a rota responde 429, não 503)', async () => {
        const { service, client } = montar({ modo: 'supabase' });
        client.signInWithPassword.mockRejectedValue(
            new SupabaseAuthUnavailableError('x', 'rate_limited', 429),
        );
        const erro = await service.alterar(entrada()).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(SupabaseAuthUnavailableError);
        expect((erro as SupabaseAuthUnavailableError).rateLimited).toBe(true);
    });

    it('caso 5: GoTrue fora no PUT /user → erro sobe, ROLLBACK, sem evento', async () => {
        const { service, client, usuario, eventos } = montar({ modo: 'supabase' });
        client.updateOwnPassword.mockRejectedValue(
            new SupabaseAuthUnavailableError('x', 'timeout'),
        );
        await expect(service.alterar(entrada())).rejects.toBeInstanceOf(
            SupabaseAuthUnavailableError,
        );
        expect(usuario.passwordHash).toBe(hashAtual);
        expect(eventos).toEqual([]);
    });

    it('PUT /user recusado (ex.: sessão do chamador já revogada) → indisponível (503), ROLLBACK, nunca 500', async () => {
        const { service, client, usuario, log } = montar({ modo: 'supabase' });
        client.updateOwnPassword.mockRejectedValue(
            new SupabaseAuthRejectedError('session_not_found', 403),
        );
        const erro = await service.alterar(entrada()).catch((e: unknown) => e);
        expect(erro).toBeInstanceOf(SupabaseAuthUnavailableError);
        expect((erro as SupabaseAuthUnavailableError).rateLimited).toBe(false);
        expect(usuario.passwordHash).toBe(hashAtual);
        expect(log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'AUTH_INDISPONIVEL' }),
        );
    });

    it('falha no logout da sonda: só um aviso, a troca segue e responde sucesso', async () => {
        const { service, client, log, eventos } = montar({ modo: 'supabase' });
        client.logout.mockRejectedValue(new SupabaseAuthUnavailableError('x', 'timeout'));
        await expect(service.alterar(entrada())).resolves.toBeUndefined();
        expect(eventos).toHaveLength(1);
        expect(log.warn).toHaveBeenCalled();
    });

    it('sem auth_user_id ou sem e-mail: verifica pelo bcrypt local (D3), sem sonda', async () => {
        for (const m of [{ vinculado: false }, { email: null }] as const) {
            const { service, client } = montar({ modo: 'supabase', ...m });
            await service.alterar(entrada());
            expect(client.signInWithPassword).not.toHaveBeenCalled();
        }
        const { service } = montar({ modo: 'supabase', vinculado: false });
        await expect(service.alterar(entrada({ senhaAtual: 'Errada-123' }))).rejects.toBeInstanceOf(
            CurrentPasswordInvalidError,
        );
    });

    it('GoTrue mudou e o COMMIT falhou: AUTH_DIVERGENCIA (aposFalha) e o erro sobe', async () => {
        const { service, log } = montar({ modo: 'supabase', falhaNoCommit: true });
        await expect(service.alterar(entrada())).rejects.toThrow('commit falhou');
        expect(log.error).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'AUTH_DIVERGENCIA',
                data: expect.objectContaining({ userId: 4, authUserId: UUID, operacao: 'senha' }),
            }),
        );
    });
});

describe('OwnPasswordService — sem segredo em log (caso 8)', () => {
    it('nenhuma linha de log carrega senha, hash ou token', async () => {
        const { service, log, usuario } = montar({ modo: 'supabase' });
        await service.alterar(entrada());
        const tudo = JSON.stringify([
            ...log.info.mock.calls,
            ...log.warn.mock.calls,
            ...log.error.mock.calls,
        ]);
        for (const segredo of [ATUAL, NOVA, TOKEN_CHAMADOR, TOKEN_SONDA, usuario.passwordHash]) {
            expect(tudo).not.toContain(segredo);
        }
        expect(logDeSucesso(log)).toBeDefined();
    });
});

describe('OwnPasswordService — fonte', () => {
    const fonte = readFileSync(path.join(__dirname, 'OwnPasswordService.ts'), 'utf8');

    it('lê o modo pelo EnvironmentProvider, nunca process.env', () => {
        expect(fonte).toMatch(/EnvironmentProvider/);
        expect(fonte).not.toMatch(/process\.env/);
    });

    it('não invalida o cache de acesso (senha não muda permissões)', () => {
        expect(fonte).not.toMatch(/AccessService/);
    });

    it('não chama logout com scope=others (RAMO = put-user: o PUT /user já revoga as outras)', () => {
        expect(fonte).not.toMatch(/'others'/);
    });
});

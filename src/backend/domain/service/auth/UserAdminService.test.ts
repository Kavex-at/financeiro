import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type SupabaseAdminClient from '../../client/SupabaseAdminClient.js';
import {
    SupabaseAdminError,
    SupabaseEmailAlreadyExistsError,
} from '../../client/SupabaseAdminClient.js';
import type SecretCipher from '../../libs/crypto/SecretCipher.js';
import type UserRepository from '../../repository/auth/UserRepository.js';
import { UsernameAlreadyExistsError } from '../../repository/auth/UserRepository.js';
import type AppUserContextCache from './AppUserContextCache.js';
import UserAdminService, { SelfDeactivationError, createUserSchema } from './UserAdminService.js';

const AUTH_ID = 'a1b2c3d4-0000-4000-8000-000000000000';

const buildRepo = () =>
    ({
        listAll: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async (i) => ({
            id: 9,
            username: i.username,
            role: i.role,
            ativo: i.ativo,
            convitePendente: i.convitePendente,
            createdAt: '2026-08-06T00:00:00.000Z',
            ...(i.createdBy ? { createdBy: i.createdBy } : {}),
        })),
        findById: jest.fn().mockResolvedValue({
            id: 6,
            username: 'alvo@kavex.com',
            role: 'operador',
            ativo: true,
            convitePendente: false,
            authUserId: AUTH_ID,
        }),
        findByUsername: jest.fn().mockResolvedValue(null),
        setAtivo: jest.fn().mockResolvedValue(true),
        setConvitePendente: jest.fn().mockResolvedValue(true),
        markConviteAceito: jest.fn().mockResolvedValue(true),
        updatePassword: jest.fn().mockResolvedValue(true),
        setVinculoConexos: jest.fn().mockResolvedValue(true),
    }) as unknown as jest.Mocked<UserRepository>;

const buildCipher = () =>
    ({
        encrypt: jest.fn().mockImplementation(async (p: string) => `enc(${p})`),
        isEnabled: jest.fn().mockResolvedValue(true),
    }) as unknown as jest.Mocked<SecretCipher>;

const buildGoTrue = () =>
    ({
        inviteByEmail: jest.fn().mockResolvedValue({ id: AUTH_ID, email: 'novo@kavex.com' }),
        createUser: jest.fn().mockResolvedValue({ id: AUTH_ID, email: 'novo@kavex.com' }),
        getUserById: jest.fn().mockResolvedValue({ id: AUTH_ID }),
        setBanned: jest.fn().mockResolvedValue({ id: AUTH_ID }),
        deleteUser: jest.fn().mockResolvedValue(undefined),
        sendRecoveryLink: jest.fn().mockResolvedValue(undefined),
    }) as unknown as jest.Mocked<SupabaseAdminClient>;

const buildCache = () =>
    ({
        invalidate: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        clear: jest.fn(),
        legacyKeyFor: jest.fn((username: string) => `legacy:${username}`),
    }) as unknown as jest.Mocked<AppUserContextCache>;

const build = () => {
    const repo = buildRepo();
    const cipher = buildCipher();
    const goTrue = buildGoTrue();
    const cache = buildCache();
    return {
        service: new UserAdminService(repo, cipher, goTrue, cache),
        repo,
        goTrue,
        cache,
        cipher,
    };
};

describe('createUserSchema', () => {
    it('normaliza email (trim/lowercase) e default role=operador', () => {
        const out = createUserSchema.parse({
            username: '  NOVO@Kavex.com ',
            password: 'segredo12',
        });
        expect(out).toMatchObject({ username: 'novo@kavex.com', role: 'operador' });
    });

    it('rejeita email inválido, senha curta e role desconhecida', () => {
        expect(createUserSchema.safeParse({ username: 'x', password: 'segredo12' }).success).toBe(
            false,
        );
        expect(createUserSchema.safeParse({ username: 'a@b.com', password: 'curta' }).success).toBe(
            false,
        );
        expect(
            createUserSchema.safeParse({ username: 'a@b.com', password: 'segredo12', role: 'root' })
                .success,
        ).toBe(false);
    });
});

// ── U1 ────────────────────────────────────────────────────────────────────────────────────
describe('convidarUsuario (U1) — caminho padrão', () => {
    it('cria no GoTrue E a linha local: ativo=false, convite_pendente=true, operador, created_by', async () => {
        const { service, repo, goTrue } = build();
        const out = await service.convidarUsuario(
            { username: 'novo@kavex.com' },
            'simone@kavex.com',
        );

        expect(goTrue.inviteByEmail).toHaveBeenCalledWith('novo@kavex.com');
        expect(repo.create).toHaveBeenCalledWith({
            username: 'novo@kavex.com',
            role: 'operador', // least privilege — promover a admin é ato explícito e separado
            authUserId: AUTH_ID,
            ativo: false,
            convitePendente: true,
            createdBy: 'simone@kavex.com',
        });
        expect(out).toMatchObject({ ativo: false, convitePendente: true });
    });

    it('COMPENSAÇÃO: passo local falha ⇒ deleteUser no GoTrue com o id certo', async () => {
        // Sem isso fica um ÓRFÃO no GoTrue: ele obtém um JWT válido (barrado pelo 403
        // fail-closed), mas o e-mail fica QUEIMADO para um cadastro futuro, porque
        // `auth.users.email` é único. O sintoma aparece semanas depois como "não consigo
        // cadastrar essa pessoa", sem nenhum rastro da causa.
        const { service, repo, goTrue } = build();
        (repo.create as jest.Mock).mockRejectedValue(new Error('connection terminated'));

        await expect(service.convidarUsuario({ username: 'novo@kavex.com' })).rejects.toThrow();
        expect(goTrue.deleteUser).toHaveBeenCalledWith(AUTH_ID);
    });

    it('COMPENSAÇÃO QUE TAMBÉM FALHA: o erro carrega o e-mail e o auth_user_id órfão', async () => {
        // É a única pista de que aquele e-mail ficou queimado. Perdê-la torna o problema
        // indiagnosticável.
        const { service, repo, goTrue } = build();
        (repo.create as jest.Mock).mockRejectedValue(new Error('connection terminated'));
        (goTrue.deleteUser as jest.Mock).mockRejectedValue(new Error('gotrue down'));

        const err: unknown = await service
            .convidarUsuario({ username: 'novo@kavex.com' })
            .then(() => undefined)
            .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain('novo@kavex.com');
        expect((err as Error).message).toContain(AUTH_ID);
    });

    it('e-mail já existente em app_user ⇒ 409 e o GoTrue NEM é chamado', async () => {
        const { service, repo, goTrue } = build();
        (repo.findByUsername as jest.Mock).mockResolvedValue({
            id: 3,
            username: 'existe@kavex.com',
            role: 'operador',
            ativo: true,
        });

        await expect(
            service.convidarUsuario({ username: 'existe@kavex.com' }),
        ).rejects.toBeInstanceOf(UsernameAlreadyExistsError);
        expect(goTrue.inviteByEmail).not.toHaveBeenCalled();
    });

    it('e-mail já existente no GoTrue ⇒ 409, sem duplicata e sem compensação indevida', async () => {
        const { service, goTrue } = build();
        (goTrue.inviteByEmail as jest.Mock).mockRejectedValue(
            new SupabaseEmailAlreadyExistsError('existe@kavex.com'),
        );

        await expect(
            service.convidarUsuario({ username: 'existe@kavex.com' }),
        ).rejects.toBeInstanceOf(SupabaseEmailAlreadyExistsError);
        // Nada foi criado por nós — apagar seria destruir o usuário legítimo de outra pessoa.
        expect(goTrue.deleteUser).not.toHaveBeenCalled();
    });
});

// ── U3 ────────────────────────────────────────────────────────────────────────────────────
describe('cadastrarUsuarioComSenha (U3) — fallback sem SMTP', () => {
    it('cria com senha e a linha local nasce ativo=true, convite_pendente=false, operador', async () => {
        const { service, repo, goTrue } = build();
        await service.cadastrarUsuarioComSenha(
            { username: 'novo@kavex.com', password: 'segredo12', role: 'operador' },
            'simone@kavex.com',
        );

        expect(goTrue.createUser).toHaveBeenCalledWith({
            email: 'novo@kavex.com',
            password: 'segredo12',
        });
        expect(repo.create).toHaveBeenCalledWith(
            expect.objectContaining({ ativo: true, convitePendente: false, role: 'operador' }),
        );
    });

    it('NÃO depende de SMTP: funciona mesmo com o convite quebrado', async () => {
        // É exatamente isto que impede a ausência de SMTP de virar um bloqueio duro da
        // operação — o convite é o caminho preferencial, não o único.
        const { service, goTrue } = build();
        (goTrue.inviteByEmail as jest.Mock).mockRejectedValue(
            new SupabaseAdminError('inviteByEmail', 'smtp not configured'),
        );

        await expect(
            service.cadastrarUsuarioComSenha({
                username: 'novo@kavex.com',
                password: 'segredo12',
                role: 'operador',
            }),
        ).resolves.toMatchObject({ ativo: true });
    });

    it('password_hash local NÃO é escrito — a custódia é do GoTrue', async () => {
        const { service, repo } = build();
        await service.cadastrarUsuarioComSenha({
            username: 'novo@kavex.com',
            password: 'segredo12',
            role: 'operador',
        });
        expect((repo.create as jest.Mock).mock.calls[0][0]).not.toHaveProperty('passwordHash');
        expect(repo.updatePassword).not.toHaveBeenCalled();
    });

    it('mesma compensação transacional de U1', async () => {
        const { service, repo, goTrue } = build();
        (repo.create as jest.Mock).mockRejectedValue(new Error('db down'));
        await expect(
            service.cadastrarUsuarioComSenha({
                username: 'novo@kavex.com',
                password: 'segredo12',
                role: 'operador',
            }),
        ).rejects.toThrow();
        expect(goTrue.deleteUser).toHaveBeenCalledWith(AUTH_ID);
    });

    it('grava o vínculo Conexos cifrado quando informado na criação', async () => {
        const { service, repo, cipher } = build();
        await service.cadastrarUsuarioComSenha({
            username: 'marilyn@kavex.com',
            password: 'segredo12',
            role: 'operador',
            conexosUsername: 'MARILYN_MUTAFCI',
            conexosPassword: 'senha-erp',
        });
        expect(cipher.encrypt).toHaveBeenCalledWith('senha-erp');
        expect(repo.setVinculoConexos).toHaveBeenCalledWith(9, {
            conexosUsername: 'MARILYN_MUTAFCI',
            conexosPasswordEnc: 'enc(senha-erp)',
        });
    });
});

// ── U4 / U5 ───────────────────────────────────────────────────────────────────────────────
describe('desativarUsuario (U4) — defesa em profundidade, e a ORDEM importa', () => {
    it('(1) ativo=false local + invalidate SÍNCRONO, DEPOIS (2) ban no GoTrue', async () => {
        const { service, repo, goTrue, cache } = build();
        const order: string[] = [];
        (repo.setAtivo as jest.Mock).mockImplementation(async () => {
            order.push('local');
            return true;
        });
        (cache.invalidate as jest.Mock).mockImplementation(() => order.push('invalidate'));
        (goTrue.setBanned as jest.Mock).mockImplementation(async () => {
            order.push('ban');
            return { id: AUTH_ID };
        });

        await service.setAtivo(6, false, 'admin@kavex.com');

        // A ordem é a regra: é o passo 1 que o fail-closed enforça a cada request. Banir
        // primeiro deixaria uma janela em que a sessão viva continua operando.
        // Duas invalidações porque a pessoa tem DUAS identidades vivas durante o rollout.
        expect(order).toEqual(['local', 'invalidate', 'invalidate', 'ban']);
        expect(cache.invalidate).toHaveBeenCalledWith(AUTH_ID);
        expect(goTrue.setBanned).toHaveBeenCalledWith(AUTH_ID, true);
    });

    /**
     * As DUAS identidades da mesma pessoa (ADR-0030 §6).
     *
     * Durante as fases 2–3 ela pode estar com um token do provedor (entrada chaveada pelo
     * `auth_user_id`) OU com um token legado ainda válido (entrada chaveada pelo username).
     * Invalidar só a primeira deixaria a sessão legada operando até o TTL cheio — depois de
     * a UI ter dito ao admin que o acesso foi revogado. O sintoma seria "desativei e ele
     * continuou emitindo baixa", sem erro e sem log.
     */
    it('invalida as DUAS chaves: a do provedor E a do esquema legado', async () => {
        const { service, cache } = build();

        await service.setAtivo(6, false, 'admin@kavex.com');

        expect(cache.invalidate).toHaveBeenCalledWith(AUTH_ID);
        expect(cache.invalidate).toHaveBeenCalledWith('legacy:alvo@kavex.com');
    });

    it('sem authUserId (pendente de migração) ainda invalida a chave legada', async () => {
        // É justamente quem NÃO migrou que só pode estar com token legado — deixá-lo de fora
        // faria a revogação não alcançar exatamente a população que ela precisa alcançar.
        const { service, repo, cache } = build();
        (repo.findById as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'alvo@kavex.com',
            role: 'operador',
            ativo: true,
            convitePendente: false,
        });

        const out = await service.setAtivo(6, false, 'admin@kavex.com');

        expect(cache.invalidate).toHaveBeenCalledWith('legacy:alvo@kavex.com');
        expect(out.banGoTrue).toBe('nao-aplicavel');
    });

    it('falha no passo (1) ⇒ ABORTA: nada é chamado no GoTrue', async () => {
        const { service, repo, goTrue } = build();
        (repo.setAtivo as jest.Mock).mockRejectedValue(new Error('db down'));

        await expect(service.setAtivo(6, false, 'admin@kavex.com')).rejects.toThrow();
        expect(goTrue.setBanned).not.toHaveBeenCalled();
    });

    it('falha no passo (2) ⇒ SUCESSO PARCIAL auditado, não erro duro', async () => {
        // Retornar erro levaria o admin a crer que NÃO desativou ninguém — quando na prática
        // desativou. Ele agiria por fora, ou assumiria que a pessoa ainda tem acesso.
        const { service, goTrue } = build();
        (goTrue.setBanned as jest.Mock).mockRejectedValue(
            new SupabaseAdminError('setBanned', 'gotrue 503'),
        );
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        const out = await service.setAtivo(6, false, 'admin@kavex.com');

        expect(out).toEqual({ id: 6, ativo: false, banGoTrue: 'falhou' });
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('I-Usuario-6: alvo == ator ⇒ 403 ANTES de qualquer escrita', async () => {
        const { service, repo, goTrue } = build();
        (repo.findById as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'admin@kavex.com',
            role: 'admin',
            ativo: true,
            convitePendente: false,
            authUserId: AUTH_ID,
        });

        await expect(service.setAtivo(6, false, 'admin@kavex.com')).rejects.toBeInstanceOf(
            SelfDeactivationError,
        );
        expect(repo.setAtivo).not.toHaveBeenCalled();
        expect(goTrue.setBanned).not.toHaveBeenCalled();
    });

    it('desativar OUTRO admin é permitido — a guarda é só contra autodesativação', async () => {
        const { service, repo } = build();
        (repo.findById as jest.Mock).mockResolvedValue({
            id: 7,
            username: 'outro.admin@kavex.com',
            role: 'admin',
            ativo: true,
            convitePendente: false,
            authUserId: AUTH_ID,
        });

        await expect(service.setAtivo(7, false, 'admin@kavex.com')).resolves.toMatchObject({
            ativo: false,
        });
    });

    it('a autodesativação NÃO bloqueia a auto-REATIVAÇÃO (só desativar é destrutivo)', async () => {
        const { service, repo } = build();
        (repo.findById as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'admin@kavex.com',
            role: 'admin',
            ativo: false,
            convitePendente: false,
            authUserId: AUTH_ID,
        });
        await expect(service.setAtivo(6, true, 'admin@kavex.com')).resolves.toMatchObject({
            ativo: true,
        });
    });

    it('idempotente nas duas direções', async () => {
        const { service, repo } = build();
        (repo.findById as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'alvo@kavex.com',
            role: 'operador',
            ativo: false,
            convitePendente: false,
            authUserId: AUTH_ID,
        });
        await expect(service.setAtivo(6, false, 'admin@kavex.com')).resolves.toMatchObject({
            ativo: false,
        });
    });

    it('id inexistente ⇒ NOT_FOUND (nada é chamado no provedor)', async () => {
        const { service, repo, goTrue } = build();
        (repo.findById as jest.Mock).mockResolvedValue(null);
        await expect(service.setAtivo(999, false, 'admin@kavex.com')).rejects.toThrow(/NOT_FOUND/);
        expect(goTrue.setBanned).not.toHaveBeenCalled();
    });
});

describe('ativarUsuario (U5)', () => {
    it('ativo=true + unban + limpa convite_pendente', async () => {
        const { service, repo, goTrue } = build();
        (repo.findById as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'convidado@kavex.com',
            role: 'operador',
            ativo: false,
            convitePendente: true,
            authUserId: AUTH_ID,
        });

        await service.setAtivo(6, true, 'admin@kavex.com');

        expect(repo.setAtivo).toHaveBeenCalledWith(6, true);
        expect(repo.setConvitePendente).toHaveBeenCalledWith(6, false);
        expect(goTrue.setBanned).toHaveBeenCalledWith(AUTH_ID, false);
    });

    it('I-Usuario-5: o vínculo Conexos SOBREVIVE a desativar → reativar', async () => {
        // Limpar as colunas transformaria uma desativação temporária (férias, afastamento)
        // num retrabalho de ops — e, pior, num incentivo a NÃO desativar.
        const { service, repo } = build();
        await service.setAtivo(6, false, 'admin@kavex.com');
        await service.setAtivo(6, true, 'admin@kavex.com');
        expect(repo.setVinculoConexos).not.toHaveBeenCalled();
    });
});

// ── Reset de senha ────────────────────────────────────────────────────────────────────────
describe('redefinição de senha — a custódia saiu do nosso banco', () => {
    it('redefinirSenhaDeTerceiro dispara o link e NUNCA grava hash local', async () => {
        // Isto não é cosmético: é o que permite atribuir uma baixa fin010 a uma pessoa e
        // SUSTENTAR a atribuição. Depois desta feature, nenhum humano além do titular conhece
        // a senha de outro.
        const { service, repo, goTrue } = build();
        await service.redefinirSenhaDeTerceiro(6);
        expect(goTrue.sendRecoveryLink).toHaveBeenCalledWith('alvo@kavex.com');
        expect(repo.updatePassword).not.toHaveBeenCalled();
    });

    it('solicitarRedefinicaoSenha: resposta IDÊNTICA existindo ou não o usuário', async () => {
        // Um endpoint público que diferencia "e-mail não cadastrado" de "enviamos o link"
        // entrega a lista de funcionários da Columbia, um e-mail por vez.
        const { service, repo, goTrue } = build();

        (repo.findByUsername as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'existe@kavex.com',
            role: 'operador',
            ativo: true,
        });
        const existente = await service.solicitarRedefinicaoSenha('existe@kavex.com');

        (repo.findByUsername as jest.Mock).mockResolvedValue(null);
        const inexistente = await service.solicitarRedefinicaoSenha('nao-existe@kavex.com');

        expect(existente).toEqual(inexistente);
        expect(goTrue.sendRecoveryLink).toHaveBeenCalledTimes(1); // só o que existe recebe
    });

    it('usuário INATIVO não recebe link — e a resposta continua idêntica', async () => {
        // Reset de senha não pode ser porta dos fundos para reativação: um desligado que
        // ainda tem o e-mail corporativo não recupera acesso sem passar por um admin.
        const { service, repo, goTrue } = build();
        (repo.findByUsername as jest.Mock).mockResolvedValue({
            id: 7,
            username: 'desligado@kavex.com',
            role: 'operador',
            ativo: false,
        });

        const inativo = await service.solicitarRedefinicaoSenha('desligado@kavex.com');

        expect(goTrue.sendRecoveryLink).not.toHaveBeenCalled();
        (repo.findByUsername as jest.Mock).mockResolvedValue(null);
        expect(inativo).toEqual(await service.solicitarRedefinicaoSenha('nao-existe@kavex.com'));
    });

    it('falha do provedor NÃO vaza pela resposta (o anti-enumeração vale também no erro)', async () => {
        const { service, repo, goTrue } = build();
        (repo.findByUsername as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'existe@kavex.com',
            role: 'operador',
            ativo: true,
        });
        (goTrue.sendRecoveryLink as jest.Mock).mockRejectedValue(
            new SupabaseAdminError('sendRecoveryLink', 'smtp down'),
        );
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        await expect(service.solicitarRedefinicaoSenha('existe@kavex.com')).resolves.toBeDefined();
        warn.mockRestore();
    });
});

describe('vínculo Conexos (I-Usuario-5) — inalterado por esta feature', () => {
    it('setVinculo cifra a senha do ERP antes de persistir; null limpa', async () => {
        const { service, repo, cipher } = build();
        await service.setVinculo(6, { conexosUsername: 'X', conexosPassword: 'p' });
        expect(cipher.encrypt).toHaveBeenCalledWith('p');
        expect(repo.setVinculoConexos).toHaveBeenCalledWith(6, {
            conexosUsername: 'X',
            conexosPasswordEnc: 'enc(p)',
        });

        await service.setVinculo(6, null);
        expect(repo.setVinculoConexos).toHaveBeenLastCalledWith(6, null);
    });
});

describe('GUARDA — o hash local saiu do caminho de gestão', () => {
    it('UserAdminService não importa bcryptjs nem calcula BCRYPT_ROUNDS', () => {
        // O único consumidor legítimo de bcrypt que sobra é o LOGIN legado (`AuthService`),
        // que COMPARA — nunca gera — enquanto o rollout durar.
        const source = readFileSync(path.join(__dirname, 'UserAdminService.ts'), 'utf8');
        expect(source).not.toContain("from 'bcryptjs'");
        expect(source).not.toContain('BCRYPT_ROUNDS');
    });
});

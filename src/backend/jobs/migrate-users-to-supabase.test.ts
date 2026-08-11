import 'reflect-metadata';
import { container } from 'tsyringe';

// Neutraliza o bootstrap real (sem Conexos/DB) — e evita puxar `MigrationRunner`, que usa
// `import.meta` e não compila sob o transform CommonJS do ts-jest.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

import SupabaseAdminClient from '../domain/client/SupabaseAdminClient.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';
import type { PendingMigrationUser } from '../domain/repository/auth/UserRepository.js';
import { redactBody } from '../http/redact.js';
import { migrateUsersToSupabase } from './migrate-users-to-supabase.js';

const PENDING: PendingMigrationUser[] = [
    { id: 1, username: 'marilyn@kavex.com', passwordHash: '$2a$12$aaaaaaaaaaaaaaaaaaaaaa' },
    { id: 2, username: 'simone@kavex.com', passwordHash: '$2a$12$bbbbbbbbbbbbbbbbbbbbbb' },
];

const buildRepo = (pending: PendingMigrationUser[] = PENDING) =>
    ({
        listPendingMigration: jest.fn().mockResolvedValue(pending),
        linkAuthUser: jest.fn().mockResolvedValue(true),
        // Presentes de propósito: os testes-guarda abaixo provam que NENHUM é chamado.
        create: jest.fn(),
        setAtivo: jest.fn(),
        updatePassword: jest.fn(),
        setVinculoConexos: jest.fn(),
        upsertAdmin: jest.fn(),
    }) as unknown as jest.Mocked<UserRepository>;

const buildGoTrue = () =>
    ({
        createUserWithPasswordHash: jest
            .fn()
            .mockImplementation(async (i: { email: string }) => ({ id: `uuid-${i.email}` })),
    }) as unknown as jest.Mocked<SupabaseAdminClient>;

const register = (repo: UserRepository, goTrue: SupabaseAdminClient): void => {
    container.registerInstance(UserRepository, repo);
    container.registerInstance(SupabaseAdminClient, goTrue);
};

let logs: string[];

beforeEach(() => {
    container.clearInstances();
    logs = [];
    const capture = (...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
    };
    jest.spyOn(console, 'log').mockImplementation(capture);
    jest.spyOn(console, 'warn').mockImplementation(capture);
    jest.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('migrate-users-to-supabase — dry-run é o DEFAULT', () => {
    it('sem --execute NADA é escrito, nem local nem no provedor', async () => {
        const repo = buildRepo();
        const goTrue = buildGoTrue();
        register(repo, goTrue);

        const report = await migrateUsersToSupabase({ execute: false });

        expect(report).toMatchObject({ dryRun: true, pendentes: 2, migrados: 0, falhos: 0 });
        expect(goTrue.createUserWithPasswordHash).not.toHaveBeenCalled();
        expect(repo.linkAuthUser).not.toHaveBeenCalled();
    });
});

describe('migrate-users-to-supabase — a senha atual continua valendo', () => {
    it('cria no GoTrue REAPROVEITANDO o hash bcrypt (é o que evita o lockout geral)', async () => {
        const repo = buildRepo();
        const goTrue = buildGoTrue();
        register(repo, goTrue);

        await migrateUsersToSupabase({ execute: true });

        expect(goTrue.createUserWithPasswordHash).toHaveBeenCalledWith({
            email: 'marilyn@kavex.com',
            passwordHash: '$2a$12$aaaaaaaaaaaaaaaaaaaaaa',
        });
    });

    it('grava o auth_user_id devolvido pelo provedor na linha certa', async () => {
        const repo = buildRepo();
        register(repo, buildGoTrue());
        await migrateUsersToSupabase({ execute: true });
        expect(repo.linkAuthUser).toHaveBeenCalledWith(1, 'uuid-marilyn@kavex.com');
        expect(repo.linkAuthUser).toHaveBeenCalledWith(2, 'uuid-simone@kavex.com');
    });
});

describe('GUARDA — o job SÓ preenche o ponteiro', () => {
    it('não altera username, role nem ativo; não cria linha (UPDATE apenas)', async () => {
        // `username` é imutável (I-Usuario-2) E é o ator da trilha (I-Usuario-1): um job que
        // o "normalizasse" partiria a auditoria de três frentes de forma irreversível.
        const repo = buildRepo();
        register(repo, buildGoTrue());

        await migrateUsersToSupabase({ execute: true });

        expect(repo.create).not.toHaveBeenCalled();
        expect(repo.setAtivo).not.toHaveBeenCalled();
        expect(repo.updatePassword).not.toHaveBeenCalled();
        expect(repo.setVinculoConexos).not.toHaveBeenCalled();
        expect(repo.upsertAdmin).not.toHaveBeenCalled();
        // A única escrita local é o ponteiro.
        expect(repo.linkAuthUser).toHaveBeenCalledTimes(2);
    });
});

describe('idempotência POR CONSTRUÇÃO — o filtro É a condição', () => {
    it('rodar duas vezes com --execute migra ZERO na segunda', async () => {
        const goTrue = buildGoTrue();
        // 1ª execução: 2 pendentes. 2ª: a query não os seleciona mais (auth_user_id NOT NULL).
        const repo = buildRepo();
        register(repo, goTrue);
        await migrateUsersToSupabase({ execute: true });

        container.clearInstances();
        const repoDepois = buildRepo([]);
        register(repoDepois, goTrue);
        const segunda = await migrateUsersToSupabase({ execute: true });

        expect(segunda).toMatchObject({ pendentes: 0, migrados: 0, falhos: 0 });
        expect(repoDepois.linkAuthUser).not.toHaveBeenCalled();
    });
});

describe('relatório e GATE da Fase 3', () => {
    it('reporta total, migrados, falhos e os usernames que falharam', async () => {
        const repo = buildRepo();
        const goTrue = buildGoTrue();
        (goTrue.createUserWithPasswordHash as jest.Mock)
            .mockResolvedValueOnce({ id: 'uuid-ok' })
            .mockRejectedValueOnce(new Error('gotrue 500'));
        register(repo, goTrue);

        const report = await migrateUsersToSupabase({ execute: true });

        expect(report).toMatchObject({
            pendentes: 2,
            migrados: 1,
            falhos: 1,
            usernamesComFalha: ['simone@kavex.com'],
        });
    });

    it('lista NÃO vazia ⇒ avisa que a Fase 3 NÃO pode acontecer', async () => {
        // Desligar o login legado com pendentes deixa esses usuários sem NENHUM caminho de
        // login: o legado desligado e eles inexistentes no provedor.
        const repo = buildRepo();
        register(repo, buildGoTrue());
        await migrateUsersToSupabase({ execute: false });

        expect(logs.join('\n')).toMatch(
            /GATE.*MUST NOT be applied|AUTH_LEGACY_LOGIN_ENABLED=false/s,
        );
    });

    it('lista VAZIA ⇒ declara o gate aberto', async () => {
        register(buildRepo([]), buildGoTrue());
        await migrateUsersToSupabase({ execute: true });
        expect(logs.join('\n')).toMatch(/GATE OPEN/);
    });

    it('usuário sem password_hash falha explicitamente em vez de virar conta sem senha', async () => {
        const repo = buildRepo([{ id: 3, username: 'sem-hash@kavex.com' }]);
        const goTrue = buildGoTrue();
        register(repo, goTrue);

        const report = await migrateUsersToSupabase({ execute: true });

        expect(report).toMatchObject({ migrados: 0, falhos: 1 });
        expect(goTrue.createUserWithPasswordHash).not.toHaveBeenCalled();
    });
});

describe('GUARDA — nenhum hash ou senha aparece em log', () => {
    it('os logs não contêm o password_hash, e sobrevivem ao redactBody', async () => {
        const repo = buildRepo();
        register(repo, buildGoTrue());

        await migrateUsersToSupabase({ execute: true });
        await migrateUsersToSupabase({ execute: false });

        const joined = logs.join('\n');
        for (const user of PENDING) {
            expect(joined).not.toContain(user.passwordHash);
        }
        expect(joined).not.toMatch(/\$2[aby]\$/); // nenhum prefixo bcrypt em lugar nenhum
        // E o que o job produz continua limpo depois de passar pelo redator de logs.
        expect(JSON.stringify(redactBody({ logs }))).not.toMatch(/\$2[aby]\$/);
    });
});

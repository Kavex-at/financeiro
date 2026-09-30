import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import SupabaseAuthUnavailableError from '../../errors/SupabaseAuthUnavailableError.js';
import type { SupabaseAdminUser } from '../../interface/auth/SupabaseAuth.js';
import type { UsuarioParaSync } from '../../repository/auth/UserRepository.js';
import SupabaseAuthSyncService from './SupabaseAuthSyncService.js';

const URL_ALVO = 'http://127.0.0.1:54321';
let seq = 0;
const novoUuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

/** Banco e GoTrue falsos COM estado: a segunda execução enxerga o resultado da primeira. */
const montar = (usuarios: UsuarioParaSync[], goTrueInicial: SupabaseAdminUser[] = []) => {
    const banco = new Map(usuarios.map((u) => [u.id, { ...u }]));
    const goTrue = new Map(goTrueInicial.map((u) => [u.id, { ...u }]));
    const repo = {
        hasAuthUserIdColumn: jest.fn().mockResolvedValue(true),
        listForAuthSync: jest.fn(async () => [...banco.values()].map((u) => ({ ...u }))),
        linkAuthUser: jest.fn(async (id: number, uuid: string) => {
            const u = banco.get(id);
            if (u) u.authUserId = uuid;
        }),
    };
    const client = {
        isAdminConfigured: jest.fn().mockResolvedValue(true),
        adminListUsers: jest.fn(async () => [...goTrue.values()].map((u) => ({ ...u }))),
        adminCreateUser: jest.fn(async ({ email }: { email: string }) => {
            const u = { id: novoUuid(), email, banned: false };
            goTrue.set(u.id, u);
            return u;
        }),
        adminUpdateUser: jest.fn(async (id: string, m: { email?: string; banned?: boolean }) => {
            const u = goTrue.get(id);
            if (!u) throw new Error('404');
            if (m.email !== undefined) u.email = m.email;
            if (m.banned !== undefined) u.banned = m.banned;
            return { ...u };
        }),
    };
    const env = { getEnvironmentVars: jest.fn().mockResolvedValue({ supabaseUrl: URL_ALVO }) };
    const log = {
        info: jest.fn().mockResolvedValue(undefined),
        warn: jest.fn().mockResolvedValue(undefined),
        error: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SupabaseAuthSyncService(
        repo as never,
        client as never,
        env as never,
        log as never,
    );
    return { service, repo, client, banco, goTrue, log };
};

const usuario = (over: Partial<UsuarioParaSync>): UsuarioParaSync => ({
    id: 1,
    username: 'u',
    email: 'u@qa.local',
    ativo: true,
    passwordHash: '$2a$12$hash-que-nao-pode-vazar',
    ...over,
});

const CENARIO = () => [
    usuario({ id: 1, username: 'adm@qa.local', email: 'adm@qa.local' }),
    usuario({ id: 2, username: 'ana@qa.local', email: 'ana@qa.local' }),
    usuario({ id: 3, username: 'beto', email: 'beto@qa.local' }),
    usuario({ id: 4, username: 'caio', email: undefined, ativo: false }),
    usuario({ id: 5, username: 'dora', email: undefined }),
];

const acoes = (r: { linhas: { username: string; acao: string }[] }) =>
    Object.fromEntries(r.linhas.map((l) => [l.username, l.acao]));

describe('SupabaseAuthSyncService — dry-run (default)', () => {
    it('planeja sem escrever: nenhum método de escrita do client nem linkAuthUser', async () => {
        const { service, client, repo } = montar(CENARIO());
        const r = await service.executar({ execute: false });
        expect(acoes(r)).toEqual({
            'adm@qa.local': 'criar',
            'ana@qa.local': 'criar',
            beto: 'criar',
            caio: 'ignorado: inativo',
            dora: 'ignorado: sem e-mail',
        });
        expect(client.adminCreateUser).not.toHaveBeenCalled();
        expect(client.adminUpdateUser).not.toHaveBeenCalled();
        expect(repo.linkAuthUser).not.toHaveBeenCalled();
        expect(r.urlAlvo).toBe(URL_ALVO);
        expect(r.texto).toContain(URL_ALVO);
        expect(r.texto).toMatch(/nada foi alterado \(dry-run\)/);
        expect(r.codigoSaida).toBe(0);
        // O resumo do dry-run é o planejado: é o que o runbook confere antes do --execute.
        expect(r.resumo).toMatchObject({ criados: 3, ignorados: 2, conflitos: 0, falhas: 0 });
        expect(r.texto).toMatch(/resumo PLANEJADO: criados=3/);
    });
});

describe('SupabaseAuthSyncService — execução', () => {
    it('cria os ativos com o hash atual, vincula, e a segunda execução = zero ações', async () => {
        const { service, client, banco } = montar(CENARIO());
        const r1 = await service.executar({ execute: true });
        expect(r1.resumo).toMatchObject({ criados: 3, vinculados: 0, ignorados: 2, falhas: 0 });
        expect(client.adminCreateUser).toHaveBeenCalledWith({
            email: 'beto@qa.local',
            passwordHash: '$2a$12$hash-que-nao-pode-vazar',
        });
        expect(banco.get(3)?.authUserId).toBeDefined();
        expect(banco.get(4)?.authUserId).toBeUndefined();

        client.adminCreateUser.mockClear();
        client.adminUpdateUser.mockClear();
        const r2 = await service.executar({ execute: true });
        expect(r2.resumo).toMatchObject({ criados: 0, vinculados: 0, reconciliados: 0, falhas: 0 });
        expect(client.adminCreateUser).not.toHaveBeenCalled();
        expect(client.adminUpdateUser).not.toHaveBeenCalled();
        expect(r2.codigoSaida).toBe(0);
    });

    it('execução interrompida (criado no GoTrue, vínculo não gravado): vincula, nunca duplica', async () => {
        const uuid = novoUuid();
        const { service, client, banco, goTrue } = montar(
            [usuario({ id: 3, username: 'beto', email: 'beto@qa.local' })],
            [{ id: uuid, email: 'beto@qa.local', banned: false }],
        );
        const r = await service.executar({ execute: true });
        expect(acoes(r)).toEqual({ beto: 'vincular' });
        expect(client.adminCreateUser).not.toHaveBeenCalled();
        expect(banco.get(3)?.authUserId).toBe(uuid);
        expect(goTrue.size).toBe(1);
        expect(r.linhas[0].detalhe).toMatch(/senha do Supabase Auth mantida/);
    });

    it('com vínculo: reconcilia e-mail, bane inativo e desbane ativo', async () => {
        const [a, b, c] = [novoUuid(), novoUuid(), novoUuid()];
        const { service, goTrue } = montar(
            [
                usuario({ id: 1, username: 'ana', email: 'ana2@qa.local', authUserId: a }),
                usuario({
                    id: 2,
                    username: 'caio',
                    ativo: false,
                    authUserId: b,
                    email: 'c@qa.local',
                }),
                usuario({ id: 3, username: 'dora', authUserId: c, email: 'd@qa.local' }),
            ],
            [
                { id: a, email: 'ana@qa.local', banned: false },
                { id: b, email: 'c@qa.local', banned: false },
                { id: c, email: 'd@qa.local', banned: true },
            ],
        );
        const r = await service.executar({ execute: true });
        expect(r.resumo.reconciliados).toBe(3);
        expect(goTrue.get(a)?.email).toBe('ana2@qa.local');
        expect(goTrue.get(b)?.banned).toBe(true);
        expect(goTrue.get(c)?.banned).toBe(false);
    });

    it('desativado sem ban (pane na desativação): o sync aplica o ban', async () => {
        const uuid = novoUuid();
        const { service, goTrue } = montar(
            [
                usuario({
                    id: 7,
                    username: 'ex',
                    ativo: false,
                    authUserId: uuid,
                    email: 'ex@qa.local',
                }),
            ],
            [{ id: uuid, email: 'ex@qa.local', banned: false }],
        );
        await service.executar({ execute: true });
        expect(goTrue.get(uuid)?.banned).toBe(true);
    });

    it('vínculo órfão e e-mail vinculado a outro: reportados, não corrigidos; saída 1', async () => {
        const [orfao, doOutro] = [novoUuid(), novoUuid()];
        const { service, client } = montar(
            [
                usuario({ id: 1, username: 'orfa', authUserId: orfao, email: 'o@qa.local' }),
                usuario({ id: 2, username: 'dono', authUserId: doOutro, email: 'x@qa.local' }),
                usuario({ id: 3, username: 'intruso', email: 'x@qa.local' }),
            ],
            [{ id: doOutro, email: 'x@qa.local', banned: false }],
        );
        const r = await service.executar({ execute: true });
        expect(acoes(r)).toMatchObject({
            orfa: 'divergência: vínculo órfão',
            intruso: 'conflito',
        });
        expect(r.resumo.conflitos).toBe(2);
        expect(r.codigoSaida).toBe(1);
        expect(client.adminCreateUser).not.toHaveBeenCalled();
    });

    it('falha de um usuário não interrompe os outros; saída 1 e o resumo conta a falha', async () => {
        const { service, client, banco } = montar([
            usuario({ id: 1, username: 'a', email: 'a@qa.local' }),
            usuario({ id: 2, username: 'b', email: 'b@qa.local' }),
        ]);
        client.adminCreateUser.mockRejectedValueOnce(
            new SupabaseAuthUnavailableError('x', 'server_error', 503),
        );
        const r = await service.executar({ execute: true });
        expect(r.resumo).toMatchObject({ criados: 1, falhas: 1 });
        expect(banco.get(2)?.authUserId).toBeDefined();
        expect(r.codigoSaida).toBe(1);
    });

    it('senha e hash nunca aparecem no relatório', async () => {
        const { service } = montar(CENARIO());
        const r = await service.executar({ execute: true });
        expect(JSON.stringify(r)).not.toContain('hash-que-nao-pode-vazar');
    });
});

describe('SupabaseAuthSyncService — pré-checagens', () => {
    it('coluna auth_user_id ausente: erro mandando aplicar a 0067', async () => {
        const { service, repo } = montar([]);
        repo.hasAuthUserIdColumn.mockResolvedValue(false);
        await expect(service.executar({ execute: false })).rejects.toThrow(
            /aplique a migration 0067/,
        );
    });

    it('API admin não configurada: erro que nomeia as variáveis', async () => {
        const { service, client } = montar([]);
        client.isAdminConfigured.mockResolvedValue(false);
        await expect(service.executar({ execute: false })).rejects.toThrow(/SUPABASE_SECRET_KEY/);
    });

    it('nada no bootstrapAppContainer (gotcha dos ~58 jobs)', () => {
        const fonte = readFileSync(path.join(__dirname, '..', '..', 'appContainer.ts'), 'utf8');
        expect(fonte).not.toMatch(/SupabaseAuth|sync-supabase/);
    });

    it('o job é um script fino: dry-run por default, --execute para escrever', () => {
        const job = readFileSync(
            path.join(__dirname, '..', '..', '..', 'jobs', 'sync-supabase-auth.ts'),
            'utf8',
        );
        expect(job).toContain("'--execute'");
        expect(job).toContain('process.exit(');
    });
});

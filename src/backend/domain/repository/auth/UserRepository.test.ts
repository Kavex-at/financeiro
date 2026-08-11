import 'reflect-metadata';
import type PostgreeDatabaseClient from '../../client/database/PostgreeDatabaseClient.js';
import UserRepository, { UsernameAlreadyExistsError } from './UserRepository.js';

const buildDb = () =>
    ({
        insert: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(1),
        selectMany: jest.fn().mockResolvedValue([]),
        selectFirst: jest.fn().mockResolvedValue(null),
    }) as unknown as jest.Mocked<PostgreeDatabaseClient>;

describe('UserRepository', () => {
    it('findByUsername: mapeia ativo e é parametrizado', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            password_hash: 'h',
            role: 'admin',
            ativo: true,
        });
        const out = await new UserRepository(db).findByUsername('marilyn.mutafci@kavex.com');
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('SELECT id, username, password_hash, role, ativo');
        expect(sql).toContain('WHERE username = $username');
        expect(params).toEqual({ username: 'marilyn.mutafci@kavex.com' });
        expect(out).toEqual({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            passwordHash: 'h',
            role: 'admin',
            ativo: true,
        });
    });

    it('create: INSERT ... ON CONFLICT DO NOTHING RETURNING; devolve o público (sem hash)', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 8,
            username: 'novo@kavex.com',
            role: 'operador',
            ativo: true,
            convite_pendente: false,
            created_by: 'simone@kavex.com',
            created_at: '2026-07-10T12:00:00.000Z',
        });
        const out = await new UserRepository(db).create({
            username: 'novo@kavex.com',
            role: 'operador',
            createdBy: 'simone@kavex.com',
            authUserId: 'uuid-gotrue',
            ativo: true,
            convitePendente: false,
        });
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('INSERT INTO app_user');
        expect(sql).toContain('ON CONFLICT (username) DO NOTHING');
        expect(sql).toContain('RETURNING');
        // O RETURNING (o que sai do banco) nunca expõe o hash de senha.
        expect(sql.split('RETURNING')[1]).not.toContain('password_hash');
        expect(params).toMatchObject({ username: 'novo@kavex.com', role: 'operador' });
        expect(out).toMatchObject({
            id: 8,
            username: 'novo@kavex.com',
            createdBy: 'simone@kavex.com',
        });
        expect(out).not.toHaveProperty('passwordHash');
    });

    it('create: username duplicado (RETURNING vazio) lança UsernameAlreadyExistsError', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue(null);
        await expect(
            new UserRepository(db).create({
                username: 'marilyn.mutafci@kavex.com',
                role: 'operador',
                authUserId: 'uuid-gotrue',
                ativo: true,
                convitePendente: false,
            }),
        ).rejects.toBeInstanceOf(UsernameAlreadyExistsError);
    });

    it('getVinculoConexos: só devolve quando ativo e ambas as colunas preenchidas', async () => {
        const db = buildDb();
        const repo = new UserRepository(db);
        (db.selectFirst as jest.Mock)
            .mockResolvedValueOnce({
                conexos_username: 'MARILYN_MUTAFCI',
                conexos_password_enc: 'enc',
            })
            .mockResolvedValueOnce({ conexos_username: null, conexos_password_enc: null });
        expect(await repo.getVinculoConexos('marilyn@kavex.com')).toEqual({
            conexosUsername: 'MARILYN_MUTAFCI',
            conexosPasswordEnc: 'enc',
        });
        const [sql] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('ativo = true'); // inativo nunca opera no ERP
        expect(await repo.getVinculoConexos('sem@kavex.com')).toBeNull(); // colunas nulas
    });

    it('setVinculoConexos: grava cifrado; null limpa as duas colunas', async () => {
        const db = buildDb();
        const repo = new UserRepository(db);
        await repo.setVinculoConexos(6, { conexosUsername: 'X', conexosPasswordEnc: 'enc' });
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('SET conexos_username = $conexosUsername');
        expect(params).toEqual({ id: 6, conexosUsername: 'X', conexosPasswordEnc: 'enc' });
        await repo.setVinculoConexos(6, null);
        expect((db.update as jest.Mock).mock.calls[1][1]).toEqual({
            id: 6,
            conexosUsername: null,
            conexosPasswordEnc: null,
        });
    });

    it('setAtivo/updatePassword: parametrizados; false quando nenhuma linha afetada', async () => {
        const db = buildDb();
        (db.update as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        const repo = new UserRepository(db);
        expect(await repo.setAtivo(6, false)).toBe(true);
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('UPDATE app_user SET ativo = $ativo WHERE id = $id');
        expect(params).toEqual({ id: 6, ativo: false });
        expect(await repo.updatePassword(999, 'h')).toBe(false); // id inexistente
    });
});

// ── Identidade (ADR-0030) — o ponteiro para o GoTrue e o discriminador de convite ──────────
describe('UserRepository — identidade e convite (ADR-0030)', () => {
    it('findByAuthUserId: um único SELECT por auth_user_id, SEM filtro de ativo', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            role: 'admin',
            ativo: true,
            convite_pendente: false,
        });
        const out = await new UserRepository(db).findByAuthUserId(
            '0b6e5f2a-1111-4444-8888-aaaaaaaaaaaa',
        );
        expect(db.selectFirst as jest.Mock).toHaveBeenCalledTimes(1);
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('WHERE auth_user_id = $authUserId');
        // I-Usuario-9: o filtro `AND ativo` mataria a distinção entre 403-inativo e
        // 403-inexistente. As DUAS respostas são 403, mas o contexto tem de saber qual é
        // — sem isso o diagnóstico de "usuário sumiu" vira adivinhação.
        expect(sql).not.toMatch(/ativo\s*=\s*true/);
        expect(params).toEqual({ authUserId: '0b6e5f2a-1111-4444-8888-aaaaaaaaaaaa' });
        expect(out).toEqual({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            role: 'admin',
            ativo: true,
            convitePendente: false,
        });
    });

    it('findByAuthUserId: devolve a linha INATIVA (não a esconde) e null quando não existe', async () => {
        const db = buildDb();
        const repo = new UserRepository(db);
        (db.selectFirst as jest.Mock)
            .mockResolvedValueOnce({
                id: 7,
                username: 'desligado@kavex.com',
                role: 'operador',
                ativo: false,
                convite_pendente: false,
            })
            .mockResolvedValueOnce(null);
        // UUIDs REAIS: a guarda de forma (abaixo) recusa qualquer outra coisa antes de tocar
        // o banco, então placeholders como 'uuid-inativo' testariam a guarda, não o mapeamento.
        expect(await repo.findByAuthUserId('11111111-1111-4111-8111-111111111111')).toMatchObject({
            ativo: false,
            convitePendente: false,
        });
        expect(await repo.findByAuthUserId('22222222-2222-4222-8222-222222222222')).toBeNull();
    });

    /**
     * BACKSTOP ESTRUTURAL — Regis-Review `cutover-rollback-broken` / ADR-0030 §6.
     *
     * `auth_user_id` é `UUID` e não há cast em lugar nenhum. Um `sub` legado (o username)
     * chegando aqui fazia o Postgres recusar a sintaxe (22P02) e a request virar **500** —
     * no caminho de recuperação, onde o operador mais precisa de um erro legível.
     *
     * O roteamento correto é do `appUserContext` (por `authScheme`); esta guarda garante que
     * uma classificação errada custe um 403 diagnosticável em vez de derrubar toda request
     * autenticada. Fail-closed, nunca crash.
     */
    it('findByAuthUserId: um subject NÃO-UUID devolve null SEM tocar o banco (nunca 500)', async () => {
        const db = buildDb();
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const out = await new UserRepository(db).findByAuthUserId('marilyn.mutafci@kavex.com');

        expect(out).toBeNull();
        expect(db.selectFirst as jest.Mock).not.toHaveBeenCalled();
        // O log existe porque este caminho significa classificação errada — silêncio aqui
        // transformaria um bug de roteamento num "usuário sem permissão" inexplicável.
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it('findContextByUsername: o lookup do token LEGADO — mesmo contexto, chave diferente', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            role: 'admin',
            ativo: true,
            convite_pendente: false,
        });

        const out = await new UserRepository(db).findContextByUsername('marilyn.mutafci@kavex.com');

        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('WHERE username = $username');
        // Espelha `findByAuthUserId`, INCLUSIVE a ausência do filtro de ativo: as duas
        // respostas 403 (inativo × inexistente) continuam sendo diagnósticos distintos.
        expect(sql).not.toMatch(/ativo\s*=\s*true/);
        expect(params).toEqual({ username: 'marilyn.mutafci@kavex.com' });
        expect(out).toEqual({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            role: 'admin',
            ativo: true,
            convitePendente: false,
        });
    });

    it('linkAuthUser: UPDATE do ponteiro e NADA mais (não toca username/role/ativo)', async () => {
        const db = buildDb();
        const ok = await new UserRepository(db).linkAuthUser(6, 'uuid-novo');
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('SET auth_user_id = $authUserId');
        // Regra de `actions/usuario/migrar-para-supabase.md`: o job só preenche o ponteiro.
        // `username` é imutável (I-Usuario-2) E é o ator da trilha (I-Usuario-1) — um UPDATE
        // que o "normalizasse" partiria a auditoria de três frentes.
        expect(sql).not.toContain('username =');
        expect(sql).not.toContain('role =');
        expect(sql).not.toContain('ativo =');
        expect(params).toEqual({ id: 6, authUserId: 'uuid-novo' });
        expect(ok).toBe(true);
    });

    it('listPendingMigration: seleciona auth_user_id IS NULL — é o GATE da Fase 3', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            { id: 1, username: 'a@kavex.com', password_hash: '$2a$12$hash-a' },
            { id: 2, username: 'b@kavex.com', password_hash: null },
        ]);
        const out = await new UserRepository(db).listPendingMigration();
        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('auth_user_id IS NULL');
        expect(out).toEqual([
            { id: 1, username: 'a@kavex.com', passwordHash: '$2a$12$hash-a' },
            { id: 2, username: 'b@kavex.com' },
        ]);
    });

    it('markConviteAceito: ativa e limpa convite_pendente num ÚNICO UPDATE', async () => {
        const db = buildDb();
        const ok = await new UserRepository(db).markConviteAceito(6);
        expect(db.update as jest.Mock).toHaveBeenCalledTimes(1);
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('ativo = true');
        expect(sql).toContain('convite_pendente = false');
        expect(params).toEqual({ id: 6 });
        expect(ok).toBe(true);
    });

    it('setConvitePendente: parametrizado; false quando nenhuma linha afetada', async () => {
        const db = buildDb();
        (db.update as jest.Mock).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
        const repo = new UserRepository(db);
        expect(await repo.setConvitePendente(6, false)).toBe(true);
        const [sql, params] = (db.update as jest.Mock).mock.calls[0];
        expect(sql).toContain('SET convite_pendente = $convitePendente');
        expect(params).toEqual({ id: 6, convitePendente: false });
        expect(await repo.setConvitePendente(999, true)).toBe(false);
    });

    it('create: aceita authUserId/ativo/convitePendente e NÃO grava password_hash', async () => {
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            id: 9,
            username: 'convidado@kavex.com',
            role: 'operador',
            ativo: false,
            convite_pendente: true,
            created_by: 'simone@kavex.com',
            created_at: '2026-08-06T12:00:00.000Z',
        });
        const out = await new UserRepository(db).create({
            username: 'convidado@kavex.com',
            role: 'operador',
            createdBy: 'simone@kavex.com',
            authUserId: 'uuid-gotrue',
            ativo: false,
            convitePendente: true,
        });
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        // A custódia da credencial é do GoTrue (ADR-0030 §7): nem a coluna aparece no INSERT.
        expect(sql).not.toContain('password_hash');
        expect(params).toMatchObject({
            authUserId: 'uuid-gotrue',
            ativo: false,
            convitePendente: true,
        });
        expect(out).toMatchObject({ id: 9, ativo: false, convitePendente: true });
        expect(out).not.toHaveProperty('passwordHash');
    });

    it('listAll: expõe convitePendente e NUNCA password_hash / conexos_password_enc', async () => {
        const db = buildDb();
        (db.selectMany as jest.Mock).mockResolvedValue([
            {
                id: 9,
                username: 'convidado@kavex.com',
                role: 'operador',
                ativo: false,
                convite_pendente: true,
                created_by: 'simone@kavex.com',
                created_at: '2026-08-06T12:00:00.000Z',
                conexos_username: null,
            },
        ]);
        const out = await new UserRepository(db).listAll();
        const [sql] = (db.selectMany as jest.Mock).mock.calls[0];
        expect(sql).toContain('convite_pendente');
        expect(sql).not.toContain('password_hash');
        expect(sql).not.toContain('conexos_password_enc');
        expect(out[0]).toMatchObject({ convitePendente: true });
    });

    it('getVinculoConexos: intocado — mesma assinatura, mesmo SQL, mesmo filtro ativo = true', async () => {
        // Teste-guarda de NÃO-mudança. `conexosIdentityMiddleware` → ALS → ConexosSessionResolver
        // → getVinculoConexos(username) é a cadeia que assina a baixa fin010 no nome do humano.
        // Ela degrada para o robô SEM erro, SEM log e SEM alarme (integrations/supabase-auth.md).
        const db = buildDb();
        (db.selectFirst as jest.Mock).mockResolvedValue({
            conexos_username: 'MARILYN_MUTAFCI',
            conexos_password_enc: 'enc',
        });
        await new UserRepository(db).getVinculoConexos('marilyn@kavex.com');
        const [sql, params] = (db.selectFirst as jest.Mock).mock.calls[0];
        expect(sql).toContain('WHERE username = $username AND ativo = true');
        expect(params).toEqual({ username: 'marilyn@kavex.com' });
    });
});

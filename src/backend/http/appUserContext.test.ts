import 'reflect-metadata';
import type { NextFunction, Request, Response } from 'express';
import { container } from 'tsyringe';
import SupabaseAdminClient from '../domain/client/SupabaseAdminClient.js';
import UserRepository from '../domain/repository/auth/UserRepository.js';
import AppUserContextCache from '../domain/service/auth/AppUserContextCache.js';
import {
    APP_USER_CONTEXT_TTL_MS,
    DEV_BYPASS_USER,
    buildAppUserContextMiddleware,
} from './appUserContext.js';
import type { AuthEnv } from './authEnv.js';

// O middleware roda ANTES de qualquer rota, então ele mesmo garante o bootstrap. Nos
// testes o container é montado à mão — não há Postgres nem migrations para rodar.
jest.mock('../domain/appContainer.js', () => ({
    bootstrapAppContainer: jest.fn().mockResolvedValue(undefined),
}));

const authEnv = (partial: Partial<AuthEnv> = {}): AuthEnv => ({
    devBypass: false,
    legacyLoginEnabled: true,
    ...partial,
});

const mockRes = (): Response => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res) as unknown as Response['status'];
    res.json = jest.fn().mockReturnValue(res) as unknown as Response['json'];
    return res as Response;
};

const SUB = '0b6e5f2a-1111-4444-8888-aaaaaaaaaaaa';

const buildRepo = () =>
    ({
        findByAuthUserId: jest.fn().mockResolvedValue(null),
        findContextByUsername: jest.fn().mockResolvedValue(null),
        markConviteAceito: jest.fn().mockResolvedValue(true),
    }) as unknown as jest.Mocked<UserRepository>;

const run = async (
    middleware: ReturnType<typeof buildAppUserContextMiddleware>,
    req: Partial<Request> = { user: { sub: SUB, role: 'authenticated' } },
): Promise<{ req: Partial<Request>; res: Response; next: jest.Mock }> => {
    const res = mockRes();
    const next = jest.fn();
    await middleware(req as Request, res, next as unknown as NextFunction);
    return { req, res, next };
};

describe('appUserContext — fail-closed (I-Usuario-9)', () => {
    let repo: jest.Mocked<UserRepository>;

    beforeEach(() => {
        container.clearInstances();
        repo = buildRepo();
        container.registerInstance(UserRepository, repo as unknown as UserRepository);
    });

    it('JWT válido SEM linha em app_user → 403 (existir no GoTrue não é existir na plataforma)', async () => {
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(null);
        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()));

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        // Mensagem user-facing em PT-BR (convenção do repo: erros internos em inglês,
        // mensagens de tela em português).
        const body = (res.json as jest.Mock).mock.calls[0][0];
        expect(typeof body.error).toBe('string');
        expect(body.error).toMatch(/[áâãéêíóôõúç]/i);
    });

    it('JWT válido com ativo = false → 403 (I-Usuario-4: inativo não opera nem leitura)', async () => {
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue({
            id: 7,
            username: 'desligado@kavex.com',
            role: 'operador',
            ativo: false,
            convitePendente: false,
        });
        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()));

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('NENHUM dos dois casos responde 401 — 401 faria o front tentar refresh, 403 não', async () => {
        // A distinção não é cosmética. 401 significa "falta identidade" e dispara o fluxo de
        // refresh do cliente; aqui a identidade é legítima e o provedor está respondendo
        // corretamente — devolver 401 produziria um loop de refresh contra um provedor
        // saudável, escondendo do diagnóstico que o problema é de AUTORIZAÇÃO.
        // Ver business-rules/autorizacao-resolvida-do-banco.md.
        const middleware = buildAppUserContextMiddleware(authEnv());

        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(null);
        const semLinha = await run(middleware, { user: { sub: 'sub-sem-linha' } });
        expect(semLinha.res.status).not.toHaveBeenCalledWith(401);

        (repo.findByAuthUserId as jest.Mock).mockResolvedValue({
            id: 7,
            username: 'desligado@kavex.com',
            role: 'operador',
            ativo: false,
            convitePendente: false,
        });
        const inativo = await run(middleware, { user: { sub: 'sub-inativo' } });
        expect(inativo.res.status).not.toHaveBeenCalledWith(401);
    });

    it('sem req.user (rota pública montada por engano depois do auth) → 401, não 403', async () => {
        // Aqui sim falta IDENTIDADE — é o único caso 401 deste middleware.
        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()), {
            user: undefined,
        });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });
});

describe('appUserContext — a autorização SOBRESCREVE o token', () => {
    let repo: jest.Mocked<UserRepository>;

    beforeEach(() => {
        container.clearInstances();
        repo = buildRepo();
        container.registerInstance(UserRepository, repo as unknown as UserRepository);
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            role: 'admin',
            ativo: true,
            convitePendente: false,
        });
    });

    it('role: "authenticated" no token + app_user.role = "admin" → req.user.role === "admin"', async () => {
        // SOBRESCRITA, não merge. A claim `role` do GoTrue é sempre 'authenticated' (é o
        // role do Postgres, não um papel de negócio) e barraria TODO MUNDO em
        // requireRole('admin') no dia do cutover — 30+ rotas de mutação.
        const { req, next } = await run(buildAppUserContextMiddleware(authEnv()), {
            user: { sub: SUB, role: 'authenticated', email: 'marilyn.mutafci@kavex.com' },
        });

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user?.role).toBe('admin');
    });

    it('username vem de app_user; sub continua sendo o UUID do token', async () => {
        const { req } = await run(buildAppUserContextMiddleware(authEnv()), {
            user: { sub: SUB, role: 'authenticated' },
        });

        // I-Usuario-1: o ator da trilha é o e-mail. O UUID fica como chave de junção.
        expect(req.user?.username).toBe('marilyn.mutafci@kavex.com');
        expect(req.user?.sub).toBe(SUB);
        expect(req.user?.appUserId).toBe(6);
    });
});

describe('appUserContext — cache (I-Usuario-8)', () => {
    let repo: jest.Mocked<UserRepository>;

    beforeEach(() => {
        jest.useFakeTimers();
        container.clearInstances();
        repo = buildRepo();
        container.registerInstance(UserRepository, repo as unknown as UserRepository);
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            role: 'admin',
            ativo: true,
            convitePendente: false,
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('dois requests seguidos do mesmo auth_user_id fazem UM único SELECT', async () => {
        const middleware = buildAppUserContextMiddleware(authEnv());
        await run(middleware);
        await run(middleware);
        expect(repo.findByAuthUserId).toHaveBeenCalledTimes(1);
    });

    it('depois de APP_USER_CONTEXT_TTL_MS, relê do banco', async () => {
        const middleware = buildAppUserContextMiddleware(authEnv());
        await run(middleware);
        jest.advanceTimersByTime(APP_USER_CONTEXT_TTL_MS + 1);
        await run(middleware);
        expect(repo.findByAuthUserId).toHaveBeenCalledTimes(2);
    });

    it('invalidate(authUserId) zera a entrada SINCRONICAMENTE — o request seguinte relê', async () => {
        // É esta sincronicidade que faz o número "≤30 s" da revogação valer: `setAtivo`
        // invalida no MESMO processo que atende a request de desativação.
        const middleware = buildAppUserContextMiddleware(authEnv());
        await run(middleware);
        expect(repo.findByAuthUserId).toHaveBeenCalledTimes(1);

        container.resolve(AppUserContextCache).invalidate(SUB);

        await run(middleware);
        expect(repo.findByAuthUserId).toHaveBeenCalledTimes(2);
    });

    it('o 403 de "sem linha" TAMBÉM é cacheado — um token órfão em loop não vira 1 SELECT/request', async () => {
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(null);
        const middleware = buildAppUserContextMiddleware(authEnv());
        const a = await run(middleware, { user: { sub: 'sub-orfao' } });
        const b = await run(middleware, { user: { sub: 'sub-orfao' } });

        expect(repo.findByAuthUserId).toHaveBeenCalledTimes(1);
        expect(a.res.status).toHaveBeenCalledWith(403);
        expect(b.res.status).toHaveBeenCalledWith(403);
    });

    it('APP_USER_CONTEXT_TTL_MS é constante tipada de 30 s — nunca lida de process.env', () => {
        // "Um número de segurança que se muda por deploy é um número que se muda sem
        // revisão" (business-rules/revogacao-de-acesso.md).
        expect(APP_USER_CONTEXT_TTL_MS).toBe(30_000);
        const source = require('node:fs').readFileSync(
            require('node:path').join(__dirname, 'appUserContext.ts'),
            'utf8',
        );
        expect(source).not.toContain('process.env');
        const cacheSource = require('node:fs').readFileSync(
            require('node:path').join(
                __dirname,
                '..',
                'domain',
                'service',
                'auth',
                'AppUserContextCache.ts',
            ),
            'utf8',
        );
        expect(cacheSource).not.toContain('process.env');
    });
});

// ── U2 — aceite do convite, verificado NO PROVEDOR (Task 11 / ADR-0030 §7) ────────────────
describe('appUserContext — aceite do convite (U2)', () => {
    let repo: jest.Mocked<UserRepository>;
    let goTrue: jest.Mocked<SupabaseAdminClient>;

    const convidado = {
        id: 9,
        username: 'convidado@kavex.com',
        role: 'operador',
        ativo: false,
        convitePendente: true,
    };
    const revogado = {
        ...convidado,
        id: 7,
        username: 'desligado@kavex.com',
        convitePendente: false,
    };

    beforeEach(() => {
        jest.useFakeTimers();
        container.clearInstances();
        repo = buildRepo();
        goTrue = {
            getUserById: jest.fn().mockResolvedValue({ id: SUB }),
        } as unknown as jest.Mocked<SupabaseAdminClient>;
        container.registerInstance(UserRepository, repo as unknown as UserRepository);
        container.registerInstance(SupabaseAdminClient, goTrue as unknown as SupabaseAdminClient);
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('apresentar JWT válido NÃO ativa — o provedor é consultado', async () => {
        // O próprio link de convite abre sessão no GoTrue ANTES de a senha existir. Logo um
        // JWT válido não prova aceite nenhum; confirmação no provedor prova.
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(convidado);
        (goTrue.getUserById as jest.Mock).mockResolvedValue({ id: SUB }); // sem emailConfirmedAt

        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()));

        expect(goTrue.getUserById).toHaveBeenCalledWith(SUB);
        expect(repo.markConviteAceito).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.status).not.toHaveBeenCalledWith(401);
    });

    it('confirmado no provedor ⇒ markConviteAceito, cache atualizado e a request SEGUE', async () => {
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(convidado);
        (goTrue.getUserById as jest.Mock).mockResolvedValue({
            id: SUB,
            emailConfirmedAt: '2026-08-06T12:00:00.000Z',
        });

        const middleware = buildAppUserContextMiddleware(authEnv());
        const { req, next, res } = await run(middleware);

        expect(repo.markConviteAceito).toHaveBeenCalledWith(9);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user?.role).toBe('operador');
        expect(req.user?.username).toBe('convidado@kavex.com');

        // O request seguinte já enxerga o usuário ATIVO, sem novo SELECT nem nova chamada
        // Admin API — o cache foi reescrito com o estado pós-aceite, não apenas invalidado.
        await run(middleware);
        expect(repo.findByAuthUserId).toHaveBeenCalledTimes(1);
        expect(goTrue.getUserById).toHaveBeenCalledTimes(1);
    });

    it('REVOGADO (ativo=false, convite_pendente=false) NUNCA consulta o GoTrue', async () => {
        // A guarda contra reativar um desligado por um caminho de convite. Um usuário
        // desligado que ainda tem o e-mail corporativo NÃO pode voltar por aqui — é a mesma
        // porta dos fundos que `redefinir-senha.md` fecha explicitamente.
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(revogado);

        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()));

        expect(goTrue.getUserById).not.toHaveBeenCalled();
        expect(repo.markConviteAceito).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('o 403 do não-confirmado é cacheado no mesmo TTL (~2 chamadas Admin API por minuto)', async () => {
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(convidado);
        (goTrue.getUserById as jest.Mock).mockResolvedValue({ id: SUB });

        const middleware = buildAppUserContextMiddleware(authEnv());
        await run(middleware);
        await run(middleware);
        await run(middleware);

        // Três requests, uma consulta ao provedor: o convidado que fica recarregando a tela
        // não vira tráfego na Admin API.
        expect(goTrue.getUserById).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(APP_USER_CONTEXT_TTL_MS + 1);
        await run(middleware);
        expect(goTrue.getUserById).toHaveBeenCalledTimes(2);
    });

    it('CAMINHO QUENTE: usuário ativo NÃO gera nenhum tráfego à Admin API', async () => {
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue({
            id: 6,
            username: 'marilyn.mutafci@kavex.com',
            role: 'admin',
            ativo: true,
            convitePendente: false,
        });

        const { next } = await run(buildAppUserContextMiddleware(authEnv()));

        expect(next).toHaveBeenCalledTimes(1);
        expect(goTrue.getUserById).not.toHaveBeenCalled();
    });

    it('provedor indisponível ⇒ 403 fail-closed (nunca ativa "no escuro")', async () => {
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(convidado);
        (goTrue.getUserById as jest.Mock).mockRejectedValue(new Error('gotrue 503'));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()));

        expect(repo.markConviteAceito).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
        warn.mockRestore();
    });
});

/**
 * ROLLBACK DA FASE 2 (ADR-0030 §6) — Regis-Review `cutover-rollback-broken`.
 *
 * "O backend aceita os dois tokens" era verdade só na verificação da assinatura. A
 * autorização logo abaixo falava UUID: um `sub` legado (o username) chegava em
 * `WHERE auth_user_id = $1` e o Postgres recusava a sintaxe — **500 em toda request
 * autenticada**, no exato momento em que alguém acionou a escape-hatch.
 *
 * Estes testes travam o roteamento por `authScheme`. Vermelho aqui = rollback é ficção.
 */
describe('appUserContext — token LEGADO (authScheme: legacy)', () => {
    let repo: jest.Mocked<UserRepository>;

    const LEGACY_USER = 'marilyn.mutafci@kavex.com';
    const legacyReq = (): Partial<Request> => ({
        user: { sub: LEGACY_USER, authScheme: 'legacy', role: 'admin' },
    });

    beforeEach(() => {
        container.clearInstances();
        repo = buildRepo();
        container.registerInstance(UserRepository, repo as unknown as UserRepository);
        container.registerInstance(AppUserContextCache, new AppUserContextCache());
    });

    it('resolve por USERNAME e NUNCA chama o lookup por auth_user_id (o 500 do cast)', async () => {
        (repo.findContextByUsername as jest.Mock).mockResolvedValue({
            id: 3,
            username: LEGACY_USER,
            role: 'admin',
            ativo: true,
            convitePendente: false,
        });

        const { req, res, next } = await run(buildAppUserContextMiddleware(authEnv()), legacyReq());

        expect(repo.findContextByUsername).toHaveBeenCalledWith(LEGACY_USER);
        // A asserção que vale: o username JAMAIS pode alcançar a coluna UUID.
        expect(repo.findByAuthUserId).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toMatchObject({ role: 'admin', username: LEGACY_USER, appUserId: 3 });
    });

    it('sem linha em app_user → 403 (fail-closed vale igual nos dois esquemas)', async () => {
        (repo.findContextByUsername as jest.Mock).mockResolvedValue(null);

        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()), legacyReq());

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('inativo com convite pendente → 403 SEM falar com o GoTrue (o sub não é um id de lá)', async () => {
        // `getUserById(sub)` receberia um username. Além de não existir caso legítimo
        // (`AuthService.login` recusa `ativo = false`, e convidado não tem `password_hash`),
        // seria uma chamada garantidamente inútil à Admin API a cada request.
        const admin = { getUserById: jest.fn() };
        container.registerInstance(SupabaseAdminClient, admin as unknown as SupabaseAdminClient);
        (repo.findContextByUsername as jest.Mock).mockResolvedValue({
            id: 4,
            username: LEGACY_USER,
            role: 'operador',
            ativo: false,
            convitePendente: true,
        });

        const { res, next } = await run(buildAppUserContextMiddleware(authEnv()), legacyReq());

        expect(admin.getUserById).not.toHaveBeenCalled();
        expect(repo.markConviteAceito).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    it('a entrada de cache é namespaced — a mesma pessoa nos dois esquemas não colide', async () => {
        // Durante as fases 2–3 a mesma pessoa tem duas identidades vivas. Uma chave só faria
        // o contexto de um esquema responder pelo outro.
        const cache = container.resolve(AppUserContextCache);
        (repo.findContextByUsername as jest.Mock).mockResolvedValue({
            id: 3,
            username: LEGACY_USER,
            role: 'admin',
            ativo: true,
            convitePendente: false,
        });

        await run(buildAppUserContextMiddleware(authEnv()), legacyReq());

        expect(cache.get(cache.legacyKeyFor(LEGACY_USER))).toBeDefined();
        expect(cache.get(LEGACY_USER)).toBeUndefined();
    });

    it('req.user SEM authScheme (harness antigo) continua no caminho do provedor', async () => {
        // Compatibilidade dos harnesses existentes: a ausência não pode mudar o roteamento
        // silenciosamente. O que impede o 500 nesse caso é a guarda de UUID do repositório.
        (repo.findByAuthUserId as jest.Mock).mockResolvedValue(null);

        await run(buildAppUserContextMiddleware(authEnv()));

        expect(repo.findByAuthUserId).toHaveBeenCalledWith(SUB);
        expect(repo.findContextByUsername).not.toHaveBeenCalled();
    });
});

describe('appUserContext — DEV_AUTH_BYPASS', () => {
    let repo: jest.Mocked<UserRepository>;

    beforeEach(() => {
        container.clearInstances();
        repo = buildRepo();
        container.registerInstance(UserRepository, repo as unknown as UserRepository);
    });

    it('injeta o usuário sintético e NÃO toca o banco', async () => {
        // Hoje o bypass deixa `req.user` INDEFINIDO, e por isso `requireRole` devolve 401 em
        // TODA mutação em dev. O usuário sintético fecha isso.
        const { req, next, res } = await run(
            buildAppUserContextMiddleware(authEnv({ devBypass: true })),
            {
                user: undefined,
            },
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user?.role).toBe('admin');
        expect(repo.findByAuthUserId).not.toHaveBeenCalled();
    });

    it('o username do bypass é inconfundível — ele VAI vazar para executado_por', async () => {
        // Um bypass que grava um e-mail plausível é PIOR que um que grava lixo óbvio: o lixo
        // óbvio é detectado na primeira leitura da trilha; o plausível é atribuído a uma
        // pessoa de verdade (business-rules/ator-da-trilha-de-auditoria.md, corolário).
        const { req } = await run(buildAppUserContextMiddleware(authEnv({ devBypass: true })), {
            user: undefined,
        });

        expect(req.user?.username).toBe('dev-bypass@local');
        expect(DEV_BYPASS_USER.username).toBe('dev-bypass@local');
        expect(req.user?.username).not.toMatch(/@kavex\.(at|com)$/);
    });
});

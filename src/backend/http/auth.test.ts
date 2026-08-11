import type { NextFunction, Request, Response } from 'express';
import { type JWTVerifyGetKey, type KeyLike, SignJWT, generateKeyPair } from 'jose';
import type { AuthEnv } from './authEnv.js';
import { buildAuthMiddleware, extractBearerToken } from './auth.js';

/**
 * `AuthEnv` completo a partir do que o teste realmente varia. `legacyLoginEnabled` não
 * participa da verificação de token (é o switch de `POST /auth/login`), mas é campo
 * obrigatório do contrato — o builder evita repeti-lo em cada caso.
 */
const authEnv = (partial: Partial<AuthEnv> = {}): AuthEnv => ({
    devBypass: false,
    legacyLoginEnabled: true,
    ...partial,
});

const SUPABASE_URL = 'https://uvfcziscjpapjzpzlzuk.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const HS_SECRET = 'test-supabase-jwt-secret';

const mockRes = (): Response => {
    const res: Partial<Response> = {};
    res.status = jest.fn().mockReturnValue(res) as unknown as Response['status'];
    res.json = jest.fn().mockReturnValue(res) as unknown as Response['json'];
    return res as Response;
};

const runMiddleware = async (
    middleware: ReturnType<typeof buildAuthMiddleware>,
    req: Partial<Request>,
): Promise<{ res: Response; next: jest.Mock }> => {
    const res = mockRes();
    const next = jest.fn();
    await middleware(req as Request, res, next as unknown as NextFunction);
    return { res, next };
};

describe('extractBearerToken', () => {
    it('returns the token for a well-formed header', () => {
        expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    });

    it('returns undefined for a missing header', () => {
        expect(extractBearerToken(undefined)).toBeUndefined();
    });

    it('returns undefined when the scheme is not Bearer', () => {
        expect(extractBearerToken('Basic abc')).toBeUndefined();
    });

    it('returns undefined for an empty token', () => {
        expect(extractBearerToken('Bearer    ')).toBeUndefined();
    });
});

describe('buildAuthMiddleware — ES256 / JWKS path', () => {
    let privateKey: KeyLike;
    let publicKey: KeyLike;
    let keyResolver: JWTVerifyGetKey;

    const signEs256 = (
        claims: Record<string, unknown>,
        opts: {
            issuer?: string;
            audience?: string;
            subject?: string;
            expiresIn?: string;
            key?: KeyLike;
        } = {},
    ): Promise<string> =>
        new SignJWT(claims)
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setIssuer(opts.issuer ?? ISSUER)
            .setAudience(opts.audience ?? 'authenticated')
            .setSubject(opts.subject ?? 'user-123')
            .setExpirationTime(opts.expiresIn ?? '1h')
            .sign(opts.key ?? privateKey);

    beforeAll(async () => {
        const pair = await generateKeyPair('ES256');
        privateKey = pair.privateKey;
        publicKey = pair.publicKey;
        // Inject the public key as the resolver so no network fetch happens.
        keyResolver = (() => publicKey) as unknown as JWTVerifyGetKey;
    });

    it('accepts a valid token and attaches the user', async () => {
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const token = await signEs256({ email: 'a@b.com', role: 'authenticated' });
        const req: Partial<Request> = { headers: { authorization: `Bearer ${token}` } };

        const { res, next } = await runMiddleware(middleware, req);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toEqual({
            sub: 'user-123',
            email: 'a@b.com',
            role: 'authenticated',
            authScheme: 'provider',
        });
    });

    it('rejects a missing Authorization header with 401', async () => {
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const { res, next } = await runMiddleware(middleware, { headers: {} });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Missing or malformed Authorization header',
        });
    });

    it('rejects a tampered / wrong-signature token with 401', async () => {
        const other = await generateKeyPair('ES256');
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const token = await signEs256({ role: 'authenticated' }, { key: other.privateKey });
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects a token with the wrong issuer with 401', async () => {
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const token = await signEs256(
            { role: 'authenticated' },
            { issuer: 'https://evil.example.com/auth/v1' },
        );
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects a token with the wrong audience with 401', async () => {
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const token = await signEs256({ role: 'authenticated' }, { audience: 'anon' });
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects an expired token with 401 and "Token expired"', async () => {
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setIssuer(ISSUER)
            .setAudience('authenticated')
            .setSubject('user-123')
            .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
            .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
            .sign(privateKey);
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    });

    it('rejects a token missing the sub claim with 401', async () => {
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setIssuer(ISSUER)
            .setAudience('authenticated')
            .setExpirationTime('1h')
            .sign(privateKey);
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });
});

describe('buildAuthMiddleware — HS256 legacy fallback', () => {
    const signHs256 = (
        claims: Record<string, unknown>,
        opts: {
            secret?: string;
            expiresIn?: string | number;
            issuer?: string;
            audience?: string;
        } = {},
    ): Promise<string> => {
        const jwt = new SignJWT(claims)
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject('user-123')
            .setAudience(opts.audience ?? 'authenticated')
            .setExpirationTime(opts.expiresIn ?? '1h');
        if (opts.issuer) jwt.setIssuer(opts.issuer);
        return jwt.sign(new TextEncoder().encode(opts.secret ?? HS_SECRET));
    };

    it('accepts a valid HS256 token and attaches the user', async () => {
        const middleware = buildAuthMiddleware(authEnv({ jwtSecret: HS_SECRET }));
        const token = await signHs256({ email: 'a@b.com', role: 'authenticated' });
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
        });

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });

    it('rejects a wrong-secret HS256 token with 401', async () => {
        const middleware = buildAuthMiddleware(authEnv({ jwtSecret: HS_SECRET }));
        const token = await signHs256({ role: 'authenticated' }, { secret: 'a-different-secret' });
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects an expired HS256 token with "Token expired"', async () => {
        const middleware = buildAuthMiddleware(authEnv({ jwtSecret: HS_SECRET }));
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject('user-123')
            .setAudience('authenticated')
            .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
            .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
            .sign(new TextEncoder().encode(HS_SECRET));
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    });
});

describe('buildAuthMiddleware — alg-aware (both schemes configured)', () => {
    // Mirrors production: SUPABASE_URL (JWKS/ES256) AND SUPABASE_JWT_SECRET
    // (HS256) both set. The verifier is chosen per token by its `alg` header,
    // so a project that signs HS256 today and ES256 tomorrow both work without
    // redeploying. Regression guard for the real bug: a real Supabase HS256
    // login token was rejected because SUPABASE_URL forced the JWKS path.
    let privateKey: KeyLike;
    let publicKey: KeyLike;
    let keyResolver: JWTVerifyGetKey;

    beforeAll(async () => {
        const pair = await generateKeyPair('ES256');
        privateKey = pair.privateKey;
        publicKey = pair.publicKey;
        keyResolver = (() => publicKey) as unknown as JWTVerifyGetKey;
    });

    const dualEnv = authEnv({ supabaseUrl: SUPABASE_URL, jwtSecret: HS_SECRET });

    // ⚠️ Este teste NÃO é a guarda da regressão do modo dual — ele assina um `iss` que
    // NENHUM token real de produção tem (`AuthService.signToken` nunca chama `.setIssuer()`),
    // e por isso passava mesmo quando o issuer era exigido dos dois caminhos. Ele foi mantido
    // porque cobre o roteamento por `alg`; a guarda de verdade é o irmão logo abaixo, que
    // replica o token legado REAL — sem `iss`.
    it('accepts an HS256 token WITH an iss claim when SUPABASE_URL is set (alg routing only)', async () => {
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ email: 'a@b.com', role: 'authenticated' })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuer(ISSUER)
            .setAudience('authenticated')
            .setSubject('user-hs')
            .setExpirationTime('1h')
            .sign(new TextEncoder().encode(HS_SECRET));
        const req: Partial<Request> = { headers: { authorization: `Bearer ${token}` } };

        const { res, next } = await runMiddleware(middleware, req);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        // `authScheme: 'provider'` e não `'legacy'`: o discriminador é o `iss`, não o `alg`.
        // Um projeto Supabase ainda com chaves simétricas emite HS256 com `sub` = UUID —
        // classificá-lo por algoritmo o mandaria para o lookup por username e derrubaria
        // todos os usuários desse projeto.
        expect(req.user).toEqual({
            sub: 'user-hs',
            email: 'a@b.com',
            role: 'authenticated',
            authScheme: 'provider',
        });
    });

    /**
     * REGRESSÃO NOMEADA — a armadilha do `issuer` (ADR-0030 §6 e §"A armadilha do issuer").
     *
     * `baseOptions` era UM objeto espalhado nos DOIS verificadores. No instante em que
     * `SUPABASE_URL` fosse setado no Render, `issuer` passaria a ser exigido também do token
     * legado — que **nunca teve claim `iss`**, porque `AuthService.signToken`
     * (`AuthService.ts:71-77`) chama `.setSubject`/`.setAudience`/`.setIssuedAt`/
     * `.setExpirationTime` e **jamais** `.setIssuer`.
     *
     * Consequência: ligar o Supabase derrubaria TODAS as sessões vivas de uma só vez — e o
     * teste que se anunciava como guarda passaria intacto, porque assinava um `iss` sintético.
     *
     * O token abaixo replica exatamente o formato real de produção. Se ele ficar vermelho,
     * NÃO relaxe o teste: as opções de verificação voltaram a ser compartilhadas.
     */
    it('accepts a legacy HS256 token with NO iss claim after SUPABASE_URL is configured', async () => {
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        // Réplica byte-a-byte de AuthService.signToken — repare na AUSÊNCIA de .setIssuer().
        const token = await new SignJWT({ role: 'admin' })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject('marilyn.mutafci@kavex.com')
            .setAudience('authenticated')
            .setIssuedAt()
            .setExpirationTime('12h')
            .sign(new TextEncoder().encode(HS_SECRET));
        const req: Partial<Request> = { headers: { authorization: `Bearer ${token}` } };

        const { res, next } = await runMiddleware(middleware, req);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toMatchObject({ sub: 'marilyn.mutafci@kavex.com' });
    });

    /**
     * REGRESSÃO NOMEADA — o `sub` legado NÃO pode ir para o lookup por `auth_user_id`
     * (ADR-0030 §6; Regis-Review card `cutover-rollback-broken`).
     *
     * Aceitar a assinatura do token legado era só metade do "aceita os dois esquemas". A
     * camada de autorização logo abaixo fala UUID: `appUserContext` → `findByAuthUserId(sub)`
     * → `WHERE auth_user_id = $1` numa coluna `UUID`. Com `sub = 'marilyn@kavex.com'` o
     * Postgres recusa a sintaxe (22P02) e **toda request autenticada vira 500** — não um 403
     * legível — exatamente no instante em que alguém acionou o rollback da Fase 2.
     *
     * `authScheme` é o que roteia. Se este teste ficar vermelho, o rollback voltou a ser
     * ficção.
     */
    it('classifies a legacy HS256 token (no iss) as authScheme=legacy — routes to the username lookup', async () => {
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ role: 'admin' })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject('marilyn.mutafci@kavex.com')
            .setAudience('authenticated')
            .setIssuedAt()
            .setExpirationTime('12h')
            .sign(new TextEncoder().encode(HS_SECRET));
        const req: Partial<Request> = { headers: { authorization: `Bearer ${token}` } };

        await runMiddleware(middleware, req);

        expect(req.user?.authScheme).toBe('legacy');
    });

    it('classifies an ES256 provider token as authScheme=provider', async () => {
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ email: 'a@b.com', role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256' })
            .setIssuer(ISSUER)
            .setAudience('authenticated')
            .setSubject('0b6e5f2a-1111-4444-8888-aaaaaaaaaaaa')
            .setExpirationTime('1h')
            .sign(privateKey);
        const req: Partial<Request> = { headers: { authorization: `Bearer ${token}` } };

        await runMiddleware(middleware, req);

        expect(req.user?.authScheme).toBe('provider');
    });

    it('classifies HS256 as legacy when SUPABASE_URL is NOT configured (today’s production)', async () => {
        // Sem provedor configurado não existe token de provedor: todo HS256 é o nosso.
        const middleware = buildAuthMiddleware(authEnv({ jwtSecret: HS_SECRET }));
        const token = await new SignJWT({ role: 'admin' })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject('marilyn.mutafci@kavex.com')
            .setAudience('authenticated')
            .setExpirationTime('12h')
            .sign(new TextEncoder().encode(HS_SECRET));
        const req: Partial<Request> = { headers: { authorization: `Bearer ${token}` } };

        await runMiddleware(middleware, req);

        expect(req.user?.authScheme).toBe('legacy');
    });

    it('still rejects a legacy HS256 token with the WRONG audience (both paths enforce aud)', async () => {
        // `audience` continua exigido nos DOIS caminhos: as chaves `anon` e `service_role`
        // usam outras audiences e não podem passar por rota de usuário.
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ role: 'admin' })
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .setSubject('marilyn.mutafci@kavex.com')
            .setAudience('anon')
            .setIssuedAt()
            .setExpirationTime('12h')
            .sign(new TextEncoder().encode(HS_SECRET));
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/permutas',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('KEEPS requiring issuer on the ES256/JWKS path — a wrong iss is 401', async () => {
        // A contrapartida da regressão acima: afrouxar o issuer no caminho LEGADO não pode
        // afrouxá-lo no caminho do provedor, que é onde ele realmente prova a origem.
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setIssuer('https://evil.example.com/auth/v1')
            .setAudience('authenticated')
            .setSubject('user-es')
            .setExpirationTime('1h')
            .sign(privateKey);
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/permutas',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects an ES256 token with NO iss claim (the relaxation is legacy-only)', async () => {
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setAudience('authenticated')
            .setSubject('user-es')
            .setExpirationTime('1h')
            .sign(privateKey);
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/permutas',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects an ES256 token with the wrong audience even with the right issuer', async () => {
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setIssuer(ISSUER)
            .setAudience('anon')
            .setSubject('user-es')
            .setExpirationTime('1h')
            .sign(privateKey);
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/permutas',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('accepts an ES256 token via JWKS even when a secret is set', async () => {
        const middleware = buildAuthMiddleware(dualEnv, keyResolver);
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setIssuer(ISSUER)
            .setAudience('authenticated')
            .setSubject('user-es')
            .setExpirationTime('1h')
            .sign(privateKey);
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
        });

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('rejects an HS256 token when only SUPABASE_URL is configured (no secret)', async () => {
        const middleware = buildAuthMiddleware(authEnv({ supabaseUrl: SUPABASE_URL }), keyResolver);
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuer(ISSUER)
            .setAudience('authenticated')
            .setSubject('user-hs')
            .setExpirationTime('1h')
            .sign(new TextEncoder().encode(HS_SECRET));
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects an ES256 token when only the HS256 secret is configured (no JWKS)', async () => {
        const middleware = buildAuthMiddleware(authEnv({ jwtSecret: HS_SECRET }));
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setAudience('authenticated')
            .setSubject('user-es')
            .setExpirationTime('1h')
            .sign(privateKey);
        const { res, next } = await runMiddleware(middleware, {
            headers: { authorization: `Bearer ${token}` },
            method: 'GET',
            originalUrl: '/processes',
        });

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });
});

describe('buildAuthMiddleware — devBypass and config guards', () => {
    it('skips validation entirely when devBypass is on', async () => {
        const middleware = buildAuthMiddleware(authEnv({ devBypass: true }));
        const { res, next } = await runMiddleware(middleware, { headers: {} });

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('throws if built without supabaseUrl/secret and without devBypass', () => {
        expect(() => buildAuthMiddleware(authEnv())).toThrow(/SUPABASE_URL.*SUPABASE_JWT_SECRET/);
    });
});

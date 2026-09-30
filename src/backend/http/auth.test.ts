import type { NextFunction, Request, Response } from 'express';
import { type JWTVerifyGetKey, type KeyLike, SignJWT, generateKeyPair } from 'jose';
import type { AuthEnv } from './authEnv.js';
import { buildAuthMiddleware, buildVerifyAccessToken, extractBearerToken } from './auth.js';

const SUPABASE_URL = 'https://kngrpoqzaxtuzkcugsyl.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const APP_SECRET = 'test-app-jwt-secret';
const USER_UUID = '0b5c2d0e-6a0c-4c8e-9b8e-2b1d3c4e5f60';

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
    // Mesmo objeto: o teste lê `req.user` depois.
    Object.assign(req, { method: 'GET', originalUrl: '/x', ...req });
    await middleware(req as Request, res, next as unknown as NextFunction);
    return { res, next };
};

const env = (over: Partial<AuthEnv>): AuthEnv => ({
    provider: 'local',
    devBypass: false,
    ...over,
});

let privateKey: KeyLike;
let publicKey: KeyLike;
let keyResolver: JWTVerifyGetKey;

beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
    // Chave local injetada: nenhuma busca de JWKS na rede.
    keyResolver = (() => publicKey) as unknown as JWTVerifyGetKey;
});

/** Token no formato do GoTrue (ES256), com os claims que o projeto emite. */
const signSupabase = (
    over: {
        claims?: Record<string, unknown>;
        issuer?: string;
        audience?: string;
        subject?: string;
        key?: KeyLike;
        alg?: string;
        exp?: number | string;
    } = {},
): Promise<string> =>
    new SignJWT({
        role: 'authenticated',
        is_anonymous: false,
        email: 'x@columbiabr.com',
        ...over.claims,
    })
        .setProtectedHeader({ alg: over.alg ?? 'ES256', kid: 'test' })
        .setIssuer(over.issuer ?? ISSUER)
        .setAudience(over.audience ?? 'authenticated')
        .setSubject(over.subject ?? USER_UUID)
        .setIssuedAt()
        .setExpirationTime(over.exp ?? '1h')
        .sign(over.key ?? privateKey);

/** Token próprio (HS256), no formato do `AuthService`: sem `iss`. */
const signApp = (
    over: { secret?: string; exp?: number | string; audience?: string; subject?: string } = {},
): Promise<string> =>
    new SignJWT({ role: 'admin' })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(over.subject ?? 'fulano')
        .setAudience(over.audience ?? 'authenticated')
        .setIssuedAt()
        .setExpirationTime(over.exp ?? '12h')
        .sign(new TextEncoder().encode(over.secret ?? APP_SECRET));

const bearer = (token: string): Partial<Request> => ({
    headers: { authorization: `Bearer ${token}` },
});

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

describe('buildAuthMiddleware — caminho Supabase (ES256, I8)', () => {
    const supa = () => buildAuthMiddleware(env({ supabaseUrl: SUPABASE_URL }), keyResolver);

    it('aceita o token do GoTrue e marca o emissor; email e role do token não entram', async () => {
        const req = bearer(await signSupabase());
        const { res, next } = await runMiddleware(supa(), req);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toEqual({ sub: USER_UUID, emissor: 'supabase' });
    });

    const recusas: Array<[string, () => Promise<string>]> = [
        ['iss errado', () => signSupabase({ issuer: 'https://evil.supabase.co/auth/v1' })],
        ['aud errado', () => signSupabase({ audience: 'anon' })],
        ["role = 'anon'", () => signSupabase({ claims: { role: 'anon' } })],
        ["role = 'service_role'", () => signSupabase({ claims: { role: 'service_role' } })],
        ['role ausente', () => signSupabase({ claims: { role: undefined } })],
        ['is_anonymous = true', () => signSupabase({ claims: { is_anonymous: true } })],
        [
            'assinatura de outra chave',
            async () => signSupabase({ key: (await generateKeyPair('ES256')).privateKey }),
        ],
        [
            'RS256 (algoritmo fora da lista)',
            async () =>
                signSupabase({ alg: 'RS256', key: (await generateKeyPair('RS256')).privateKey }),
        ],
    ];
    for (const [caso, token] of recusas) {
        it(`recusa com 401 'Invalid token': ${caso}`, async () => {
            const { res, next } = await runMiddleware(supa(), bearer(await token()));
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
        });
    }

    it("recusa alg: none com 401 'Invalid token'", async () => {
        const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const token = `${b64({ alg: 'none' })}.${b64({
            sub: USER_UUID,
            iss: ISSUER,
            aud: 'authenticated',
            role: 'authenticated',
            exp: now + 3600,
        })}.`;
        const { res, next } = await runMiddleware(supa(), bearer(token));
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it("recusa token expirado com 401 'Token expired'", async () => {
        const token = await signSupabase({ exp: Math.floor(Date.now() / 1000) - 60 });
        const { res, next } = await runMiddleware(supa(), bearer(token));
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    });

    it('recusa token sem sub', async () => {
        const token = await new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test' })
            .setIssuer(ISSUER)
            .setAudience('authenticated')
            .setExpirationTime('1h')
            .sign(privateKey);
        const { res } = await runMiddleware(supa(), bearer(token));
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('sem SUPABASE_URL, todo token ES256 é recusado (caminho fechado)', async () => {
        const middleware = buildAuthMiddleware(env({ appJwtSecret: APP_SECRET }), keyResolver);
        const { res, next } = await runMiddleware(middleware, bearer(await signSupabase()));
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects a missing Authorization header with 401', async () => {
        const { res, next } = await runMiddleware(supa(), { headers: {} });
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Missing or malformed Authorization header',
        });
    });
});

describe('buildAuthMiddleware — caminho app (HS256, só com AUTH_JWT_SECRET)', () => {
    it('aceita o token próprio e marca o emissor app; sub = username', async () => {
        const middleware = buildAuthMiddleware(env({ appJwtSecret: APP_SECRET }));
        const req = bearer(await signApp());
        const { res, next } = await runMiddleware(middleware, req);
        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toEqual({ sub: 'fulano', emissor: 'app' });
    });

    it('regressão do defeito latente: com SUPABASE_URL E AUTH_JWT_SECRET, o HS256 sem iss PASSA', async () => {
        const middleware = buildAuthMiddleware(
            env({ appJwtSecret: APP_SECRET, supabaseUrl: SUPABASE_URL }),
            keyResolver,
        );
        const req = bearer(await signApp());
        const { res, next } = await runMiddleware(middleware, req);
        expect(res.status).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user).toEqual({ sub: 'fulano', emissor: 'app' });
    });

    it('com os dois configurados, o ES256 também passa (convivência)', async () => {
        const middleware = buildAuthMiddleware(
            env({ appJwtSecret: APP_SECRET, supabaseUrl: SUPABASE_URL }),
            keyResolver,
        );
        const req = bearer(await signSupabase());
        const { next } = await runMiddleware(middleware, req);
        expect(next).toHaveBeenCalledTimes(1);
        expect(req.user?.emissor).toBe('supabase');
    });

    it('sem AUTH_JWT_SECRET, o mesmo token HS256 que passava é recusado', async () => {
        const token = await signApp();
        const aberto = buildAuthMiddleware(env({ appJwtSecret: APP_SECRET }));
        expect((await runMiddleware(aberto, bearer(token))).next).toHaveBeenCalledTimes(1);

        const fechado = buildAuthMiddleware(
            env({ provider: 'supabase', supabaseUrl: SUPABASE_URL }),
            keyResolver,
        );
        const { res, next } = await runMiddleware(fechado, bearer(token));
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects a wrong-secret HS256 token with 401', async () => {
        const middleware = buildAuthMiddleware(env({ appJwtSecret: APP_SECRET }));
        const { res } = await runMiddleware(middleware, bearer(await signApp({ secret: 'outro' })));
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    });

    it('rejects an HS256 token with the wrong audience', async () => {
        const middleware = buildAuthMiddleware(env({ appJwtSecret: APP_SECRET }));
        const { res } = await runMiddleware(
            middleware,
            bearer(await signApp({ audience: 'anon' })),
        );
        expect(res.status).toHaveBeenCalledWith(401);
    });

    it('rejects an expired HS256 token with "Token expired"', async () => {
        const middleware = buildAuthMiddleware(env({ appJwtSecret: APP_SECRET }));
        const token = await signApp({ exp: Math.floor(Date.now() / 1000) - 60 });
        const { res } = await runMiddleware(middleware, bearer(token));
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token expired' });
    });

    it('o log de recusa é em português e não carrega o token', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        const middleware = buildAuthMiddleware(env({ appJwtSecret: APP_SECRET }));
        const token = await signApp({ secret: 'outro' });
        await runMiddleware(middleware, bearer(token));
        const logado = warn.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(logado).toMatch(/recusad/);
        expect(logado).not.toContain(token);
        warn.mockRestore();
    });
});

describe('buildVerifyAccessToken — reutilizável pela rota de logout (D2)', () => {
    it('devolve emissor e sub do token Supabase', async () => {
        const verify = buildVerifyAccessToken(env({ supabaseUrl: SUPABASE_URL }), keyResolver);
        await expect(verify(await signSupabase())).resolves.toEqual({
            sub: USER_UUID,
            emissor: 'supabase',
        });
    });

    it('devolve emissor app para o token próprio', async () => {
        const verify = buildVerifyAccessToken(env({ appJwtSecret: APP_SECRET }));
        await expect(verify(await signApp())).resolves.toEqual({ sub: 'fulano', emissor: 'app' });
    });

    it('lança para token inválido (mesmo comportamento do middleware)', async () => {
        const verify = buildVerifyAccessToken(env({ appJwtSecret: APP_SECRET }));
        await expect(verify('lixo')).rejects.toThrow();
    });
});

describe('buildAuthMiddleware — devBypass and config guards', () => {
    it('skips validation entirely when devBypass is on', async () => {
        const middleware = buildAuthMiddleware(env({ devBypass: true }));
        const { res, next } = await runMiddleware(middleware, { headers: {} });

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    it('lança se montado sem nenhum verificador e sem devBypass', () => {
        expect(() => buildAuthMiddleware(env({}))).toThrow(/AUTH_JWT_SECRET.*SUPABASE_URL/);
    });
});

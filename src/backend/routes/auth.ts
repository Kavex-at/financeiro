import 'reflect-metadata';
import { type NextFunction, type Request, type Response, Router } from 'express';
import { container } from 'tsyringe';
import { z } from 'zod';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import SupabaseAuthUnavailableError from '../domain/errors/SupabaseAuthUnavailableError.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import AuthService from '../domain/service/auth/AuthService.js';
import SupabaseSessionService from '../domain/service/auth/SupabaseSessionService.js';
import { type VerifyAccessToken, extractBearerToken } from '../http/auth.js';
import { asyncHandler } from '../http/asyncHandler.js';
import {
    MENSAGEM_MUITAS_TENTATIVAS,
    type SessionLimiterOptions,
    buildLoginLimiters,
    buildRefreshLimiter,
} from '../http/rateLimit.js';

/**
 * Zod no boundary — corpo do POST /login (Rule: validar inputs externos).
 *
 * `username` é o identificador: e-mail OU usuário legado (ADR-0051). O nome do campo não muda
 * (o `kavex-report-ciclo` e o front dependem dele). Normalizado aqui (trim + minúsculas).
 */
const loginBodySchema = z.object({
    username: z.string().trim().toLowerCase().min(1),
    password: z.string().min(1),
});

/** Zod no boundary — corpo do POST /refresh. */
const refreshBodySchema = z.object({ refreshToken: z.string().min(1) });

const MENSAGEM = {
    INVALIDA: 'Requisição inválida',
    CREDENCIAIS: 'Credenciais inválidas',
    SESSAO_EXPIRADA: 'Sessão expirada. Entre novamente.',
    INDISPONIVEL: 'Serviço de autenticação indisponível. Tente novamente em instantes.',
} as const;

export interface AuthRouterOptions {
    /** O mesmo verificador do middleware de auth (D2): o logout aceita os dois emissores. */
    verifyAccessToken: VerifyAccessToken;
    /** Só no teste: `skip: () => false` liga os limitadores sob o Jest. */
    limiters?: SessionLimiterOptions;
}

/** GoTrue fora/5xx/timeout → 503; GoTrue 429 → o mesmo 429 do nosso limitador (D5). */
const responderIndisponivel = (res: Response, error: unknown): boolean => {
    if (!(error instanceof SupabaseAuthUnavailableError)) return false;
    if (error.rateLimited) {
        res.status(429).json({ error: MENSAGEM_MUITAS_TENTATIVAS });
        return true;
    }
    res.status(503).json({ error: MENSAGEM.INDISPONIVEL });
    return true;
};

const modoAtual = async (): Promise<'local' | 'supabase'> =>
    (await container.resolve(EnvironmentProvider).getEnvironmentVars()).authProvider;

/**
 * Rotas de sessão — PÚBLICAS, montadas ANTES do middleware de auth (ADR-0057).
 *
 * - `POST /auth/login`: modo `local` (default) → `AuthService` (bcrypt + HS256 próprio, formato de
 *   hoje); modo `supabase` → `SupabaseSessionService` (proxy para o GoTrue; o identificador é
 *   resolvido no nosso banco antes). Os dois respondem o mesmo 401 genérico.
 * - `POST /auth/refresh`: só no modo `supabase`; em `local` responde 401 sem chamar o GoTrue (D1),
 *   para que um rollback por configuração não deixe sessões Supabase se renovando para sempre.
 * - `POST /auth/logout`: sempre 204 (idempotente, D2). Verifica o token com o MESMO verificador do
 *   middleware, sem `resolverAcesso` (desativado também encerra a sessão); só o token do Supabase
 *   tem o que revogar.
 */
export const buildAuthRouter = ({
    verifyAccessToken,
    limiters = {},
}: AuthRouterOptions): Router => {
    const router = Router();
    const login = buildLoginLimiters(limiters);

    router.post(
        '/login',
        login.porIp,
        // Parse ANTES do limitador por identificador: corpo inválido não gasta o balde de ninguém.
        (req: Request, res: Response, next: NextFunction) => {
            const parsed = loginBodySchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({ error: MENSAGEM.INVALIDA });
                return;
            }
            res.locals.login = parsed.data;
            next();
        },
        // Antes de chamar o GoTrue: o balde do projeto fica protegido (D4).
        login.porIdentificador,
        asyncHandler(async (_req, res) => {
            const credenciais = loginBodySchema.parse(res.locals.login);
            await bootstrapAppContainer();
            try {
                const result =
                    (await modoAtual()) === 'supabase'
                        ? await container.resolve(SupabaseSessionService).login(credenciais)
                        : await container.resolve(AuthService).login(credenciais);
                if (!result) {
                    res.status(401).json({ error: MENSAGEM.CREDENCIAIS });
                    return;
                }
                res.status(200).json(result);
            } catch (error) {
                if (!responderIndisponivel(res, error)) throw error;
            }
        }),
    );

    router.post(
        '/refresh',
        buildRefreshLimiter(limiters),
        asyncHandler(async (req, res) => {
            const parsed = refreshBodySchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({ error: MENSAGEM.INVALIDA });
                return;
            }
            if ((await modoAtual()) !== 'supabase') {
                res.status(401).json({ error: MENSAGEM.SESSAO_EXPIRADA });
                return;
            }

            await bootstrapAppContainer();
            try {
                const result = await container
                    .resolve(SupabaseSessionService)
                    .refresh(parsed.data.refreshToken);
                if (!result) {
                    res.status(401).json({ error: MENSAGEM.SESSAO_EXPIRADA });
                    return;
                }
                res.status(200).json(result);
            } catch (error) {
                if (!responderIndisponivel(res, error)) throw error;
            }
        }),
    );

    router.post(
        '/logout',
        asyncHandler(async (req, res) => {
            const token = extractBearerToken(req.headers.authorization);
            if (token) {
                const verificado = await verifyAccessToken(token).catch(() => undefined);
                if (verificado?.emissor === 'supabase') {
                    await bootstrapAppContainer();
                    await container.resolve(SupabaseSessionService).logout(token, verificado.sub);
                }
            }
            res.status(204).end();
        }),
    );

    return router;
};

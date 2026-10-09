import type { Request, Response as ExpressResponse } from 'express';
import rateLimit, { type RateLimitRequestHandler, type Store } from 'express-rate-limit';

/**
 * Rate limiters protecting the Express layer against request floods
 * (arch-review card security-6 / F-security-9). The strict limiter guards
 * the heavy report/analysis routes whose fan-out to the Conexos ERP can
 * exhaust its session pool.
 */

/**
 * Sob o ambiente de teste (jest seta `NODE_ENV=test`) os limiters são DESLIGADOS: a suíte dispara
 * dezenas de requisições do mesmo IP (`127.0.0.1`) na mesma janela de 60s e bateria no teto, gerando
 * 429 espúrios/flaky. Rate-limit é infra de borda, não unidade de teste de regra de negócio.
 */
const skipInTest = (): boolean => process.env.NODE_ENV === 'test';

/** Resposta dos limitadores de sessão e do 429 do GoTrue (D4/D5). */
export const MENSAGEM_MUITAS_TENTATIVAS =
    'Muitas tentativas. Aguarde alguns minutos e tente de novo.';

/**
 * Limites das rotas de sessão (D4, ADR-0057). Pelo proxy, o Supabase Auth vê todo login e refresh
 * vindo do IP do Render: sem um limitador NOSSO, uma força bruta em `/auth/login` esgotaria o balde
 * de login do projeto e trancaria todo mundo. Os números comportam o escritório da Columbia, que sai
 * por um IP só (NAT): meia dúzia de pessoas logando no mesmo minuto não pode dar 429.
 */
export const LOGIN_IP_LIMIT_PER_MINUTE = 20;
export const LOGIN_FAILURES_PER_IDENTIFIER = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
export const REFRESH_IP_LIMIT_PER_MINUTE = 30;
const ONE_MINUTE_MS = 60_000;

/** O que o teste injeta: `skip: () => false` exercita o limite; `store` isola o estado. */
export interface SessionLimiterOptions {
    skip?: () => boolean;
    store?: Store;
}

/** Identificador do login como o balde o conta: `trim().toLowerCase()`, como a rota normaliza. */
export const identificadorDoLogin = (req: Request): string => {
    const bruto = (req.body as { username?: unknown } | undefined)?.username;
    return typeof bruto === 'string' ? bruto.trim().toLowerCase() : '';
};

const sessionLimiter = (
    options: SessionLimiterOptions,
    config: Partial<Parameters<typeof rateLimit>[0]>,
): RateLimitRequestHandler =>
    rateLimit({
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: MENSAGEM_MUITAS_TENTATIVAS },
        skip: options.skip ?? skipInTest,
        ...(options.store ? { store: options.store } : {}),
        ...config,
    });

/**
 * `/auth/login` (D4): `porIp` = 20/min por IP; `porIdentificador` = 10 FALHAS (401) em 15 min por
 * identificador normalizado, venham de que IP vierem — só o 401 conta (login certo, 503 do GoTrue e
 * 429 não gastam o balde). O por-identificador roda DEPOIS do parse do corpo (corpo inválido não o
 * consome) e ANTES de chamar o GoTrue, nos dois modos.
 */
export const buildLoginLimiters = (
    options: SessionLimiterOptions = {},
): { porIp: RateLimitRequestHandler; porIdentificador: RateLimitRequestHandler } => ({
    porIp: sessionLimiter(options, {
        windowMs: ONE_MINUTE_MS,
        limit: LOGIN_IP_LIMIT_PER_MINUTE,
    }),
    porIdentificador: sessionLimiter(options, {
        windowMs: LOGIN_FAILURE_WINDOW_MS,
        limit: LOGIN_FAILURES_PER_IDENTIFIER,
        keyGenerator: (req: Request) => `login:${identificadorDoLogin(req)}`,
        skipSuccessfulRequests: true,
        requestWasSuccessful: (_req: Request, res: ExpressResponse) => res.statusCode !== 401,
    }),
});

/**
 * Troca da própria senha (ADR-0059): 5 FALHAS em 15 min por usuário autenticado. Só o 422
 * (`SENHA_ATUAL_INVALIDA`) conta; 204, 400 da política, 429 e 503 não gastam o balde. Montado
 * DEPOIS da validação do corpo (corpo malformado não o consome). Além de proteger a senha contra
 * adivinhação com uma sessão roubada, segura a sonda no balde de login do GoTrue (mesmo IP do
 * Render que o login usa). O `globalLimiter` continua valendo por cima.
 */
export const OWN_PASSWORD_FAILURES = 5;
export const OWN_PASSWORD_WINDOW_MS = 15 * 60_000;

export const buildOwnPasswordLimiter = (
    options: SessionLimiterOptions = {},
): RateLimitRequestHandler =>
    sessionLimiter(options, {
        windowMs: OWN_PASSWORD_WINDOW_MS,
        limit: OWN_PASSWORD_FAILURES,
        keyGenerator: (req: Request) => `senha:${req.user?.sub ?? ''}`,
        skipSuccessfulRequests: true,
        requestWasSuccessful: (_req: Request, res: ExpressResponse) => res.statusCode !== 422,
        handler: (_req: Request, res: ExpressResponse) => {
            res.status(429).json({
                codigo: 'MUITAS_TENTATIVAS',
                error: MENSAGEM_MUITAS_TENTATIVAS,
            });
        },
    });

/**
 * Busca de favorecido no cadastro do Conexos (`POST /sispag/favorecidos-autorizados/busca`): 30
 * buscas/min por USUÁRIO autenticado. Cada busca são até 2 leituras do `cmn025` na sessão que o
 * robô e os crons SISPAG também usam (teto de sessões; incidente de 23/09). O debounce do frontend
 * junta as teclas numa busca, então quem digita e refina fica longe do teto; uma rajada (script,
 * sessão roubada enumerando o cadastro) para em 60 leituras/min por usuário. Por usuário e não por
 * IP: o escritório da Columbia sai por um IP só. Toda requisição conta, inclusive a recusada. O
 * `globalLimiter` (100/min por IP) continua valendo por cima.
 */
export const PAYEE_SEARCH_LIMIT_PER_MINUTE = 30;
export const MENSAGEM_MUITAS_BUSCAS =
    'Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo.';

export const buildPayeeSearchLimiter = (
    options: SessionLimiterOptions = {},
): RateLimitRequestHandler =>
    sessionLimiter(options, {
        windowMs: ONE_MINUTE_MS,
        limit: PAYEE_SEARCH_LIMIT_PER_MINUTE,
        keyGenerator: (req: Request) => `busca-favorecido:${req.user?.sub ?? ''}`,
        handler: (_req: Request, res: ExpressResponse) => {
            res.status(429).json({ codigo: 'MUITAS_BUSCAS', error: MENSAGEM_MUITAS_BUSCAS });
        },
    });

/** `/auth/refresh` (D4): 30/min por IP. */
export const buildRefreshLimiter = (options: SessionLimiterOptions = {}): RateLimitRequestHandler =>
    sessionLimiter(options, { windowMs: ONE_MINUTE_MS, limit: REFRESH_IP_LIMIT_PER_MINUTE });

/** Global limiter — ~100 requests per minute per IP. */
export const globalLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60_000,
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests' },
    skip: skipInTest,
});

/** Strict limiter — ~10 requests per minute per IP, for heavy routes. */
export const heavyRouteLimiter: RateLimitRequestHandler = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests' },
    skip: skipInTest,
});

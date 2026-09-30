import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

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

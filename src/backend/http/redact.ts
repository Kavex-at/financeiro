/**
 * Redação de campos sensíveis para LOGS (security-3 / Bass: Limit Access).
 *
 * O request/response logger não pode despejar segredos no stdout (drains do
 * Render). Esta função devolve uma CÓPIA profunda do payload com os valores de
 * chaves sensíveis (password, token, authorization, secret, api_key, …)
 * substituídos por `[REDACTED]`. Comparação de chave é case-insensitive. Nunca
 * muta o objeto original. Primitivos passam direto.
 */
const DEFAULT_SENSITIVE_KEYS: ReadonlyArray<string> = [
    'password',
    'senha',
    'token',
    'accesstoken',
    'refreshtoken',
    'authorization',
    'secret',
    'api_key',
    'apikey',
    'jwt',
    // ── ADR-0030 §4 (estende ADR-0011 §2) ────────────────────────────────────────────────
    // A service-role key do GoTrue IGNORA RLS e pode criar usuários: vazá-la num drain de
    // log do Render equivale a vazar o banco inteiro. As chaves abaixo cobrem as grafias que
    // aparecem na prática — a snake_case do payload/env do provedor e a camelCase da nossa
    // configuração. (`apikey`, logo acima, já cobre o header `apikey` do PostgREST.)
    'service_role',
    'servicerole',
    'servicerolekey',
    'service_role_key',
    'supabase_service_role_key',
];

const REDACTED = '[REDACTED]';

export function redactBody(
    value: unknown,
    keys: ReadonlyArray<string> = DEFAULT_SENSITIVE_KEYS,
): unknown {
    const sensitive = new Set(keys.map((k) => k.toLowerCase()));

    const walk = (node: unknown): unknown => {
        if (Array.isArray(node)) return node.map(walk);
        if (node !== null && typeof node === 'object') {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
                out[k] = sensitive.has(k.toLowerCase()) ? REDACTED : walk(v);
            }
            return out;
        }
        return node;
    };

    return walk(value);
}

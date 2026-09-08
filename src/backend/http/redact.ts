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

/**
 * Reexport de compatibilidade.
 *
 * `redactErrorMessage` mudou-se para `domain/libs/redact/` (card `integrability-3`): três
 * consumidores FORA da camada HTTP — `StalenessDetector`, `JobExecucaoRepository` e
 * `conexosSessionStore` — importavam daqui, invertendo a camada. Código novo importa do novo
 * caminho; este reexport existe para não quebrar quem já importava.
 */
export { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';

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
 * Redação de MENSAGEM DE ERRO livre (ADR-0042, achado de segurança do Regis-Review).
 *
 * `redactBody` redige por CHAVE; isto aqui redige por PADRÃO DENTRO do texto, que é um problema
 * diferente. Mensagens de erro de infra carregam credencial no corpo da própria string:
 * `password authentication failed for user "financeiro"`, `connect ECONNREFUSED 10.0.0.5:5432`,
 * uma connection string inteira, ou um `Cookie: sid=…` vindo de um erro embrulhado.
 *
 * Essas strings iam parar em `job_execucao.error_message` e em `alerta.detalhe.erro`, ambos
 * renderizados no painel — e persistidos, que é pior que logados, porque ficam. A superfície é
 * admin-only, mas "admin" não é motivo para gravar segredo em tabela.
 *
 * Conservador de propósito: prefere redigir demais a deixar passar. Uma mensagem excessivamente
 * mascarada ainda diz ao operador QUE falhou e ONDE; uma que vaza credencial não tem conserto.
 */
const PADROES_SENSIVEIS: ReadonlyArray<readonly [RegExp, string]> = [
    // Connection strings completas (postgres://user:pass@host, mongodb://…, amqp://…).
    [/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, '[REDACTED_URL]@'],
    // password=… / senha=… / pwd=… / secret=… / token=… em query string ou texto.
    [/\b(?:password|senha|pwd|secret|token|api[_-]?key|jwt)\s*[=:]\s*\S+/gi, '[REDACTED]'],
    // Cabeçalho de cookie/sessão do Conexos.
    [/\b(?:cookie|set-cookie|sid|jsessionid)\s*[=:]\s*\S+/gi, '[REDACTED]'],
    // Bearer <token>.
    [/\bbearer\s+[\w-]{8,}\.?[\w.-]*/gi, 'Bearer [REDACTED]'],
    // Usuário citado por mensagem do Postgres.
    [/\bfor user\s+"[^"]*"/gi, 'for user "[REDACTED]"'],
    // Blocos longos de base64/hex soltos (chaves, tokens) — ≥32 chars para não pegar UUID/docCod.
    [/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, '[REDACTED]'],
];

/** Teto de tamanho: mensagem gigante é ruído no painel e no banco. */
const MAX_MENSAGEM = 500;

export function redactErrorMessage(mensagem: string): string {
    let saida = mensagem;
    for (const [padrao, substituto] of PADROES_SENSIVEIS) {
        saida = saida.replace(padrao, substituto);
    }
    return saida.length > MAX_MENSAGEM ? `${saida.slice(0, MAX_MENSAGEM)}… [truncado]` : saida;
}

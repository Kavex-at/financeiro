/**
 * Redação de MENSAGEM DE ERRO livre (ADR-0042, achado de segurança do Regis-Review).
 *
 * Redige por PADRÃO DENTRO do texto — problema diferente do `redactBody`, que redige por CHAVE.
 * Mensagens de erro de infra carregam segredo no corpo da própria string:
 * `password authentication failed for user "financeiro"`, uma connection string inteira, ou um
 * `Cookie: sid=…` vindo de um erro embrulhado.
 *
 * Essas strings iam parar em `job_execucao.error_message` e em `alerta.detalhe.erro`, ambos
 * renderizados no painel — e persistidos, que é pior que logados, porque ficam. A superfície é
 * admin-only, mas "admin" não é motivo para gravar segredo em tabela.
 *
 * Conservador de propósito: prefere redigir demais a deixar passar. Uma mensagem excessivamente
 * mascarada ainda diz ao operador QUE falhou e ONDE; uma que vaza credencial não tem conserto.
 *
 * **Mora em `domain/libs/` e não em `http/`** (card `integrability-3`): três consumidores fora da
 * camada HTTP — `StalenessDetector`, `JobExecucaoRepository` e `conexosSessionStore` — importavam
 * de `http/redact.js`, invertendo a camada. `http/redact.ts` reexporta para não quebrar quem já
 * importava de lá.
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
    // ── Topologia (card `security-2`) ────────────────────────────────────────────────────────
    // Não é credencial, mas entrega o desenho interno da rede para quem lê o drain de logs, que
    // sai do perímetro do processo. Os dois formatos abaixo são o que o `pg`/Node emitem quando o
    // pooler cai — justamente o caminho que passou a ser logado pelo session store.
    // `connect ECONNREFUSED 10.0.0.5:5432`, `EHOSTUNREACH 172.16.0.9`.
    [
        /\b(ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT)\s+\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/gi,
        '$1 [REDACTED_HOST]',
    ],
    // `getaddrinfo ENOTFOUND aws-0-sa-east-1.pooler.supabase.com`.
    [/\b(ENOTFOUND|EAI_AGAIN)\s+[\w.-]+/gi, '$1 [REDACTED_HOST]'],
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

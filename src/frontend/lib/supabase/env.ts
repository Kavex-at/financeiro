/**
 * As DUAS variáveis públicas do Supabase — e apenas elas.
 *
 * ⚠️ A `SUPABASE_SERVICE_ROLE_KEY` **nunca** aparece aqui nem em lugar nenhum de
 * `src/frontend/`: ela ignora RLS e pode criar usuários, então vive só no backend
 * (ADR-0030 §4). Há um teste-guarda no backend que varre este pacote inteiro atrás dela.
 *
 * A `anon key` é publicável **por desenho** — é ela que o browser usa para falar com o
 * GoTrue. O que a torna segura não é o segredo, é o RLS do lado do servidor.
 */

/** Erro de configuração — falha alto em vez de virar `undefined` silencioso. */
export class MissingSupabaseEnvError extends Error {
    constructor(missing: string[]) {
        super(
            `Configuração do Supabase ausente: ${missing.join(', ')}. ` +
                'Defina as variáveis no ambiente (Vercel) e no .env local — sem elas o app ' +
                'não consegue autenticar ninguém.',
        );
        this.name = 'MissingSupabaseEnvError';
    }
}

export interface SupabasePublicEnv {
    url: string;
    anonKey: string;
}

/**
 * Lê e valida as vars públicas.
 *
 * **Falha explicitamente quando faltam.** O `createBrowserClient` aceitaria `undefined` e
 * produziria um cliente que só quebra na primeira chamada de rede, com um erro que não
 * menciona configuração nenhuma — no meio de um cutover de identidade, esse é exatamente o
 * tipo de sintoma que custa horas para diagnosticar.
 *
 * Os nomes são referenciados COMO LITERAIS (`process.env.NEXT_PUBLIC_...`) porque o Next
 * substitui essas expressões em tempo de build: indexar dinamicamente devolveria `undefined`
 * no bundle do cliente.
 */
export const readSupabasePublicEnv = (): SupabasePublicEnv => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const missing: string[] = [];
    if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (missing.length > 0 || !url || !anonKey) {
        throw new MissingSupabaseEnvError(missing);
    }

    return { url, anonKey };
};

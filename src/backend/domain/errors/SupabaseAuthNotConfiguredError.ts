/**
 * Um job que PRECISA da API admin do Supabase Auth (seed em modo `supabase`, sync) rodou sem ela.
 * A mensagem nomeia as variáveis, nunca os valores (ADR-0057).
 */
export default class SupabaseAuthNotConfiguredError extends Error {
    constructor(contexto: string) {
        super(
            `${contexto}: defina SUPABASE_URL e SUPABASE_SECRET_KEY (a API admin do Supabase Auth ` +
                'não está configurada).',
        );
        this.name = 'SupabaseAuthNotConfiguredError';
    }
}

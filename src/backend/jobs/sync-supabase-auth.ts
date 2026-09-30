import 'reflect-metadata';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import SupabaseAuthSyncService from '../domain/service/auth/SupabaseAuthSyncService.js';

/**
 * Importa os usuários ATIVOS do `app_user` para o Supabase Auth e repara divergências (ADR-0054).
 *
 *   npm run job:sync-supabase-auth              → dry-run: imprime o plano, não escreve nada
 *   npm run job:sync-supabase-auth -- --execute → aplica
 *   node dist/jobs/sync-supabase-auth.js [--execute]   (Render Shell)
 *
 * Precisa de `databaseConnectionString`, `SUPABASE_URL` e `SUPABASE_SECRET_KEY`. A URL alvo sai no
 * topo do relatório: confira que é o projeto certo antes do `--execute`. Manual, sem scheduler.
 * O `SupabaseAuthClient` é resolvido sob demanda — o `bootstrapAppContainer` continua só o do banco.
 * Saída 1 se houver falha ou conflito.
 */
const main = async (): Promise<number> => {
    const execute = process.argv.includes('--execute');
    await bootstrapAppContainer();
    const relatorio = await container.resolve(SupabaseAuthSyncService).executar({ execute });
    console.log(relatorio.texto);
    return relatorio.codigoSaida;
};

main()
    .then((codigo) => process.exit(codigo))
    .catch((error) => {
        console.error(
            '[sync-supabase-auth] FALHOU:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });

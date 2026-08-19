import 'reflect-metadata';
import { container } from 'tsyringe';
import MigrationRunner from '../migrations/runMigrations.js';
import { buildLegacyConexosAdapter } from './client/legacyConexosAdapter.js';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from './client/ConexosBaseClient.js';
import ConexosSessionResolver from './client/ConexosSessionResolver.js';
import PostgreeDatabaseClient from './client/database/PostgreeDatabaseClient.js';
import EnvironmentProvider from './libs/environment/EnvironmentProvider.js';
import { registerAprovacoesPorts } from './aprovacoesContainer.js';
import { registerRecebimentosPorts } from './recebimentosContainer.js';

let bootstrapped = false;

const describeError = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

/**
 * Inicializa o Postgres e aplica as migrations ANTES de servir tráfego (P0-1).
 *
 * Fecha o anel de deploy: um ambiente novo ganha `permuta_eleicao_run`/
 * `schema_migrations` no boot, em vez de `relation does not exist` no 1º request.
 * Idempotente (`schema_migrations`). Fail-loud em produção; no skeleton sem DB
 * (dev/test) apenas warn, para o esqueleto rodar com rotas Conexos puras. NUNCA
 * roda dentro de um handler de rota.
 */
const initDatabaseAndMigrate = async (isProduction: boolean): Promise<void> => {
    try {
        await container.resolve(PostgreeDatabaseClient).init();
    } catch (error) {
        if (isProduction) throw error;
        console.warn('[appContainer] PostgreeDatabaseClient.init() skipped:', describeError(error));
        return; // sem DB → sem migrations (apenas no skeleton dev/test).
    }

    try {
        const applied = await container.resolve(MigrationRunner).run();
        if (applied.length > 0) {
            console.log(
                `[appContainer] applied ${applied.length} migration(s): ${applied.join(', ')}`,
            );
        }
    } catch (error) {
        if (isProduction) throw error;
        console.warn('[appContainer] MigrationRunner.run() skipped:', describeError(error));
    }
};

/**
 * Lazy bootstrap that wires the legacy Conexos adapter into the tsyringe
 * container. Called once before resolving any service/client that depends on
 * the Conexos ERP (e.g. the example `/conexos/filiais` route).
 *
 * No-op on subsequent calls.
 */
export const bootstrapAppContainer = async (): Promise<void> => {
    if (bootstrapped) return;
    const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();

    // O adapter resolve a sessão Conexos POR REQUEST (Fatia B): usuário logado
    // com vínculo válido → sessão dele; senão → robô. Fora de request (jobs/crons)
    // o resolver cai no robô. Decisão num único ponto — sub-clients não mudam.
    const resolver = container.resolve(ConexosSessionResolver);
    const adapter = buildLegacyConexosAdapter(() => resolver.resolve());

    container.register(LEGACY_CONEXOS_TOKEN, { useValue: adapter });
    container.resolve(ConexosBaseClient); // eager warm (shared auth/HTTP/pagination)

    // Frente IV — bind every port TOKEN to its stub/repo (idempotent, register-once).
    registerRecebimentosPorts();

    // Frente V — trilha de aprovação. O binding do gateway é o ponto de troca quando PV-07
    // liberar a varredura em massa do `fin103`.
    registerAprovacoesPorts();

    await initDatabaseAndMigrate(env.environment === 'production');

    bootstrapped = true;
};

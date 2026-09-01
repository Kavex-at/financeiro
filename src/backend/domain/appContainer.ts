import 'reflect-metadata';
import { container } from 'tsyringe';
import MigrationRunner from '../migrations/runMigrations.js';
import { buildLegacyConexosAdapter } from './client/legacyConexosAdapter.js';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from './client/ConexosBaseClient.js';
import ConexosSessionResolver from './client/ConexosSessionResolver.js';
import PostgreeDatabaseClient from './client/database/PostgreeDatabaseClient.js';
import EnvironmentProvider from './libs/environment/EnvironmentProvider.js';
import { registerOperacaoSinks } from './operacaoContainer.js';
import ConfigDoctor from './service/operacao/ConfigDoctor.js';
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
 * Roda o ConfigDoctor no boot **do servidor HTTP** (ADR-0042). Duas vars não configuradas já
 * produziram defeito visível em produção — `RECEBIMENTO_TITULARES_INTERNOS` (carteira contaminada)
 * e `COM297_GCD_NOTA_DEBITO` (a única falha real de valor da Frente IV). As duas falharam no
 * instante de tocar dinheiro, e não no deploy. Isto move a descoberta para o boot.
 *
 * ⚠️ **NÃO pertence ao `bootstrapAppContainer`** — 58 jobs o chamam, e jobs recebem env
 * deliberadamente estreito. O `detect-staleness`, por exemplo, passa APENAS
 * `databaseConnectionString`, porque não fala com o ERP. Diagnosticar ali faria cada rodada horária
 * emitir `config-ausente` para todos os `CONEXOS_*` — e como a janela de dedup é o instante do boot,
 * cada execução abriria janela nova: ~144 alertas falsos por dia, afogando o painel.
 *
 * Seria o próprio sistema de alerta produzindo o ruído que ele existe para evitar. Quem tem
 * configuração completa a diagnosticar é o SERVIDOR, e é só lá que isto roda.
 */
export const diagnosticarConfiguracao = async (): Promise<void> => {
    try {
        // Auto-suficiente de propósito: o `ConfigDoctor` depende do `NotificacaoService`, que
        // depende dos sinks. O `start()` do servidor NÃO chama `bootstrapAppContainer` (as rotas o
        // fazem sob demanda, por request), então sem esta linha o token `AlertSinks` não existe
        // ainda e o diagnóstico morre no boot — silenciosamente, porque o catch abaixo o protege.
        // `registerOperacaoSinks` é idempotente.
        registerOperacaoSinks();
        const diagnostico = await container.resolve(ConfigDoctor).verificarNoBoot();
        const { totalAusentesObrigatorias: obrig, totalAusentesSilenciosas: silenc } = diagnostico;
        if (obrig > 0 || silenc > 0) {
            console.warn(
                `[appContainer] config: ${obrig} obrigatória(s) ausente(s), ` +
                    `${silenc} que degrada(m) em silêncio. Ver /operacao.`,
            );
        }
    } catch (error) {
        console.warn('[appContainer] ConfigDoctor skipped:', describeError(error));
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

    // Painel de Operação — sinks de alerta (ADR-0042). Idempotente.
    registerOperacaoSinks();

    await initDatabaseAndMigrate(env.environment === 'production');

    bootstrapped = true;
};

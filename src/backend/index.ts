import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { diagnosticarConfiguracao } from './domain/appContainer.js';
import LogService from './domain/service/LogService.js';
import { buildApp } from './http/buildApp.js';
import { startServer } from './http/bootstrap.js';
import { registerGracefulShutdown } from './http/gracefulShutdown.js';
import { registerLastResortHandlers } from './http/lastResortHandlers.js';
import { closeProcessResources } from './http/processResources.js';
import BootMigrator from './migrations/BootMigrator.js';
import { MIGRATION_RUNNER_TOKEN } from './migrations/migrationRunnerPort.js';
import MigrationRunner from './migrations/runMigrations.js';
import { setSessionStorePoolEventSink } from './services/conexosSessionStore.js';

/**
 * Entrada do processo. Só WIRING: monta o app (`http/buildApp.ts`), amarra os canais de
 * observabilidade e entrega a sequência de boot ao `http/bootstrap.ts`. A ordem dos passos e a
 * montagem do app moram nos módulos deles, onde são testáveis — aqui não sobra lógica para
 * regredir em silêncio.
 */
const app = buildApp();

const PORT = process.env.PORT || 3001;

/**
 * Publica o estouro da drenagem no canal estruturado, para que uma rota que
 * SEMPRE force-exit apareça em `/operacao` em vez de morrer num `console.log`.
 * A ADR-0042 gastou um workflow inteiro para não deixar falha invisível.
 */
const publicarForceExit = async (reason: string): Promise<void> => {
    await container.resolve(LogService).warn({
        type: 'OPERATIONAL_WARN',
        message: 'shutdown force-exit — drenagem excedeu o teto',
        data: { reason },
    });
};

/**
 * Rede de último recurso (card `fault-tolerance-3`).
 *
 * Sem isto, uma `unhandledRejection` derruba o processo SEM passar pelo drain, cortando
 * requisições em voo pela única porta que o shutdown gracioso não cobria. Sai com 1 (falha do
 * programa), não 0 (ordem do orquestrador) — a distinção é o que faz o Render marcar o deploy
 * como quebrado.
 */
registerLastResortHandlers({
    closeResources: closeProcessResources,
    onExit: (code) => process.exit(code),
});

/**
 * Eventos do pool do session store no MESMO canal do force-exit (card `availability-1`).
 *
 * Sem isto a assimetria era gritante: shutdown estourado aparecia em `/operacao`, pool flapando
 * ficava só no stdout. Um pooler que reinicia clientes ociosos a cada 30s produziria dezenas de
 * rebuilds por hora afogados no drain de logs do Render. Amarrado só no boot do SERVIDOR — os ~58
 * jobs seguem com o `console.warn` default, que é o certo: painel de job é outra coisa.
 */
setSessionStorePoolEventSink((evento) => {
    void container.resolve(LogService).warn({
        type: 'OPERATIONAL_WARN',
        message: `conexos session store — ${evento.mensagem}`,
        data: { tipo: evento.tipo, rebuildsTotal: evento.rebuildsTotal },
    });
});

void startServer({
    runMigrations: async () => {
        // O amarramento token → classe vive AQUI, e não no `BootMigrator`, para que
        // `runMigrations.js` (que usa `import.meta`, incompatível com o Jest) fique fora do
        // alcance dos testes do boot.
        container.register(MIGRATION_RUNNER_TOKEN, { useClass: MigrationRunner });
        await container.resolve(BootMigrator).run();
    },
    // Diagnóstico de configuração (ADR-0042). Roda no boot do servidor, e não no
    // `bootstrapAppContainer`: aquele é compartilhado com 58 jobs, que recebem env estreito de
    // propósito, e diagnosticá-los encheria o painel de falso-positivo.
    diagnose: diagnosticarConfiguracao,
    listen: () =>
        app.listen(PORT, () => {
            console.log(`Financeiro backend on port ${PORT}`);
        }),
    // Todo deploy no Render manda SIGTERM. Sem isto o processo morria no ato, cortando as
    // requisições em voo — e uma delas interrompida entre o `createRun` e o `finishRun` deixa a
    // execução órfã em `reconciling`, que é o que o `reaper-sispag` varre de 15 em 15 minutos.
    registerShutdown: (server) =>
        registerGracefulShutdown({
            server,
            closeResources: closeProcessResources,
            onExit: (code) => process.exit(code),
            onForceExit: publicarForceExit,
        }),
}).catch((error: unknown) => {
    console.error(
        '[boot] FALHOU ao subir:',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exit(1);
});

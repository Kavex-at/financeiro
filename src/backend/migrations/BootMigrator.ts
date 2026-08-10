import { inject, injectable } from 'tsyringe';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { MIGRATION_RUNNER_TOKEN } from './migrationRunnerPort.js';
import type { MigrationRunnerInterface } from './migrationRunnerPort.js';

/**
 * Chave de advisory lock EXCLUSIVA da migração de boot — namespaced, distinta das de ingestão
 * (`726354819`/`726354820`), permutas (`918273645`), formação de lotes (`615243789`) e poller de
 * retorno (`528417963`).
 */
export const BOOT_MIGRATION_LOCK_KEY = 314159265;

/** Tentativas de aquisição do lock quando outra instância já está migrando. */
const LOCK_ATTEMPTS = 30;
const LOCK_RETRY_DELAY_MS = 2000;

/**
 * BootMigrator — aplica as migrações pendentes ANTES do servidor aceitar tráfego.
 *
 * ## Por que no boot, e não num passo de deploy
 *
 * O `preDeployCommand` do `render.yaml` **nunca rodou**: o serviço do Render foi configurado pelo
 * dashboard, não pelo Blueprint, e pre-deploy é recurso de plano pago. O resultado apareceu em
 * produção em 2026-08-10 — o código da ADR-0032 subiu calculando a chave natural nova enquanto o
 * banco ainda tinha as chaves antigas, e a `0044` só foi aplicada à mão, depois, pelo operador.
 *
 * Migrar no boot elimina a corrida **por construção**: é o mesmo processo que vai servir tráfego
 * aplicando o esquema antes do `listen()`. Não existe janela de código novo com banco velho.
 *
 * Um job separado (GitHub Actions no push) foi descartado: o `autoDeploy` do Render dispara no
 * mesmo push e o build dele leva ~50s — um runner subindo com `npm ci` dificilmente ganha essa
 * corrida, e o resultado seria migrar DEPOIS do deploy. Mesmo problema, mais difícil de enxergar.
 *
 * ## Falha é ALTA
 *
 * Migração que falha derruba o boot. Servir contra um esquema desconhecido é pior que não servir:
 * a primeira forma o operador vê no health check, a segunda ele descobre por dado errado na tela.
 *
 * ## Exceção: ambiente sem banco
 *
 * Sem `databaseConnectionString` configurada (dev local que só mexe no frontend), a migração é
 * PULADA com aviso em vez de travar o boot. Sem isso, `npm run dev` passaria a exigir Postgres —
 * regressão de DX para resolver um problema que só existe em produção, onde a env está sempre lá.
 */
@injectable()
export default class BootMigrator {
    public constructor(
        @inject(MIGRATION_RUNNER_TOKEN) private readonly runner: MigrationRunnerInterface,
        @inject(PostgreeDatabaseClient) private readonly db: PostgreeDatabaseClient,
        @inject(EnvironmentProvider) private readonly environmentProvider: EnvironmentProvider,
    ) {}

    /**
     * Aplica as migrações pendentes. LANÇA se falharem — o chamador (o boot) deve morrer.
     *
     * Devolve os nomes aplicados (vazio = esquema já em dia, o caso normal de todo deploy que não
     * traz migração nova).
     */
    public run = async (): Promise<string[]> => {
        const env = await this.environmentProvider.getEnvironmentVars();
        if (!env.databaseConnectionString) {
            console.warn(
                '[boot-migrate] databaseConnectionString ausente — migrações PULADAS. ' +
                    'Esperado em dev local sem Postgres; em produção isto é um erro de configuração.',
            );
            return [];
        }

        return this.comLock(async () => {
            const aplicadas = await this.runner.run();
            if (aplicadas.length === 0) console.log('[boot-migrate] esquema em dia');
            else
                console.log(
                    `[boot-migrate] aplicada(s) ${aplicadas.length}: ${aplicadas.join(', ')}`,
                );
            return aplicadas;
        });
    };

    /**
     * Serializa a migração entre instâncias.
     *
     * `pg_try_advisory_lock` não bloqueia, então "ocupado" é tratado com espera e nova tentativa —
     * NÃO com "segue sem migrar". Pular seria exatamente o bug que este módulo existe para impedir:
     * subir servindo contra um esquema que outra instância ainda está mudando. Quando a outra
     * termina, esta encontra o esquema em dia e o `run` vira no-op.
     *
     * Esgotadas as tentativas, LANÇA: uma migração presa por mais de um minuto é incidente, não
     * algo para o boot ignorar.
     */
    private comLock = async <T>(fn: () => Promise<T>): Promise<T> => {
        for (let tentativa = 1; tentativa <= LOCK_ATTEMPTS; tentativa++) {
            const resultado = await this.db.withAdvisoryLock<
                { ok: true; valor: T } | { ok: false }
            >(
                BOOT_MIGRATION_LOCK_KEY,
                async () => ({ ok: true, valor: await fn() }),
                async () => ({ ok: false }),
            );
            if (resultado.ok) return resultado.valor;

            console.log(
                `[boot-migrate] outra instância está migrando — aguardando (${tentativa}/${LOCK_ATTEMPTS})`,
            );
            await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
        }
        throw new Error(
            `[boot-migrate] advisory lock ocupado após ${LOCK_ATTEMPTS} tentativas ` +
                `(${(LOCK_ATTEMPTS * LOCK_RETRY_DELAY_MS) / 1000}s) — migração de outra instância travada?`,
        );
    };
}

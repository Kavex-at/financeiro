import 'reflect-metadata';
import type PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import BootMigrator, { BOOT_MIGRATION_LOCK_KEY } from './BootMigrator.js';
import type { MigrationRunnerInterface } from './migrationRunnerPort.js';

/** `withAdvisoryLock` real o bastante: concede o lock nas `concederApos` chamadas em diante. */
const buildDb = (concederApos = 0) => {
    let chamadas = 0;
    return {
        chamadas: () => chamadas,
        db: {
            withAdvisoryLock: jest.fn(
                async (
                    _key: number,
                    onAcquired: () => Promise<unknown>,
                    onBusy: () => Promise<unknown>,
                ) => {
                    const ocupado = chamadas < concederApos;
                    chamadas += 1;
                    return ocupado ? onBusy() : onAcquired();
                },
            ),
        } as unknown as jest.Mocked<PostgreeDatabaseClient>,
    };
};

const build = (o: { conn?: string; aplicadas?: string[]; concederApos?: number } = {}) => {
    const runner = {
        run: jest.fn().mockResolvedValue(o.aplicadas ?? []),
    } as unknown as jest.Mocked<MigrationRunnerInterface>;

    const environmentProvider = {
        getEnvironmentVars: jest.fn().mockResolvedValue({
            databaseConnectionString: o.conn ?? 'postgresql://x',
        }),
    } as unknown as jest.Mocked<EnvironmentProvider>;

    const { db, chamadas } = buildDb(o.concederApos ?? 0);
    return {
        runner,
        db,
        environmentProvider,
        chamadas,
        migrator: new BootMigrator(runner, db, environmentProvider),
    };
};

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('BootMigrator — caminho normal', () => {
    it('aplica as pendentes sob o advisory lock e devolve os nomes', async () => {
        const { migrator, runner, db } = build({ aplicadas: ['0045_x.sql'] });

        await expect(migrator.run()).resolves.toEqual(['0045_x.sql']);

        expect(runner.run).toHaveBeenCalledTimes(1);
        expect(db.withAdvisoryLock).toHaveBeenCalledTimes(1);
        // Chave PRÓPRIA: colidir com a da ingestão faria o boot e o cron se excluírem.
        expect(db.withAdvisoryLock.mock.calls[0]?.[0]).toBe(BOOT_MIGRATION_LOCK_KEY);
    });

    it('esquema em dia é no-op silencioso (o caso de todo deploy sem migração nova)', async () => {
        const { migrator, runner } = build({ aplicadas: [] });
        await expect(migrator.run()).resolves.toEqual([]);
        expect(runner.run).toHaveBeenCalledTimes(1);
    });
});

describe('BootMigrator — falha é ALTA', () => {
    it('PROPAGA o erro da migração para o boot morrer', async () => {
        // Servir contra um esquema desconhecido é pior que não servir: o Render mantém a versão
        // anterior no ar em vez de promover uma release que não sabe em que banco está falando.
        const { migrator } = build();
        (
            (migrator as unknown as { runner: MigrationRunnerInterface }).runner.run as jest.Mock
        ).mockRejectedValue(new Error('syntax error at or near "SELCT"'));

        await expect(migrator.run()).rejects.toThrow('SELCT');
    });
});

describe('BootMigrator — lock ocupado', () => {
    it('ESPERA a outra instância em vez de seguir sem migrar', async () => {
        // A armadilha que este teste fecha: tratar "ocupado" como "segue o baile" reintroduz
        // exatamente o bug — subir servindo contra esquema que outra instância está mudando.
        jest.useFakeTimers({ doNotFake: ['nextTick'] });
        const { migrator, runner, db } = build({ concederApos: 2, aplicadas: ['0045_x.sql'] });

        const p = migrator.run();
        await jest.advanceTimersByTimeAsync(10_000);

        await expect(p).resolves.toEqual(['0045_x.sql']);
        expect(db.withAdvisoryLock).toHaveBeenCalledTimes(3); // 2 ocupadas + 1 concedida
        expect(runner.run).toHaveBeenCalledTimes(1); // migrou UMA vez só
        jest.useRealTimers();
    });

    it('esgotadas as tentativas, LANÇA — lock preso é incidente, não detalhe', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick'] });
        const { migrator, runner } = build({ concederApos: Number.POSITIVE_INFINITY });

        const p = migrator.run();
        const assertion = expect(p).rejects.toThrow('advisory lock ocupado');
        await jest.advanceTimersByTimeAsync(30 * 2000 + 1000);

        await assertion;
        expect(runner.run).not.toHaveBeenCalled();
        jest.useRealTimers();
    });
});

describe('BootMigrator — ambiente sem banco', () => {
    it('sem connection string, PULA e deixa o boot seguir (dev local)', async () => {
        // Travar o boot aqui transformaria `npm run dev` numa exigência de Postgres, para resolver
        // um problema que só existe em produção — onde a env está sempre configurada.
        const { migrator, runner, db } = build({ conn: '' });

        await expect(migrator.run()).resolves.toEqual([]);

        expect(runner.run).not.toHaveBeenCalled();
        expect(db.withAdvisoryLock).not.toHaveBeenCalled();
    });
});

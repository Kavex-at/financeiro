import { type BootstrapDeps, type ServerHandle, startServer } from './bootstrap.js';

const serverHandle: ServerHandle = { close: jest.fn() };

const makeDeps = (
    order: string[],
    overrides: Partial<BootstrapDeps> = {},
): { deps: BootstrapDeps; spies: Record<string, jest.Mock> } => {
    const runMigrations = jest.fn(async () => {
        order.push('runMigrations');
    });
    const diagnose = jest.fn(async () => {
        order.push('diagnose');
    });
    const listen = jest.fn(() => {
        order.push('listen');
        return serverHandle;
    });
    const registerShutdown = jest.fn(() => {
        order.push('registerShutdown');
    });

    return {
        deps: { runMigrations, diagnose, listen, registerShutdown, ...overrides },
        spies: { runMigrations, diagnose, listen, registerShutdown },
    };
};

describe('startServer (testability-2)', () => {
    it('runs the five boot steps in the documented order', async () => {
        const order: string[] = [];
        const { deps } = makeDeps(order);

        await startServer(deps);

        expect(order).toEqual(['runMigrations', 'diagnose', 'listen', 'registerShutdown']);
    });

    /**
     * O incidente de 2026-08-10: código novo servindo contra banco velho. O
     * `listen` tem de ser inalcançável enquanto houver migração pendente.
     */
    it('aborts before listening when the migration fails', async () => {
        const order: string[] = [];
        const failure = new Error('migração 0044 pendente');
        const { deps, spies } = makeDeps(order, {
            runMigrations: jest.fn().mockRejectedValue(failure),
        });

        await expect(startServer(deps)).rejects.toThrow('migração 0044 pendente');

        expect(spies.listen).not.toHaveBeenCalled();
        expect(spies.diagnose).not.toHaveBeenCalled();
        expect(spies.registerShutdown).not.toHaveBeenCalled();
        expect(order).toEqual([]);
    });

    /**
     * `diagnosticarConfiguracao` grava alerta de `config-ausente`, que precisa da
     * tabela `alerta` — logo, só pode rodar depois das migrations.
     */
    it('diagnoses configuration only after migrations have run', async () => {
        const order: string[] = [];
        const { deps } = makeDeps(order);

        await startServer(deps);

        expect(order.indexOf('diagnose')).toBeGreaterThan(order.indexOf('runMigrations'));
    });

    it('does not listen when the diagnosis fails', async () => {
        const order: string[] = [];
        const { deps, spies } = makeDeps(order, {
            diagnose: jest.fn().mockRejectedValue(new Error('config ilegível')),
        });

        await expect(startServer(deps)).rejects.toThrow('config ilegível');

        expect(spies.listen).not.toHaveBeenCalled();
        expect(spies.registerShutdown).not.toHaveBeenCalled();
    });

    /** Registrar o drain sobre um servidor que ainda não existe não drena nada. */
    it('registers the shutdown after the server is listening, with that server', async () => {
        const order: string[] = [];
        const { deps, spies } = makeDeps(order);

        const server = await startServer(deps);

        expect(order.indexOf('registerShutdown')).toBeGreaterThan(order.indexOf('listen'));
        expect(spies.registerShutdown).toHaveBeenCalledWith(serverHandle);
        expect(server).toBe(serverHandle);
    });
});

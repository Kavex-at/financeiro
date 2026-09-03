import 'reflect-metadata';

const sessionStoreClose = jest.fn(async () => {});

jest.mock('../services/conexosSessionStore.js', () => ({
    closeConexosSessionStorePool: () => sessionStoreClose(),
}));

const postgresClose = jest.fn(async () => {});

jest.mock('../domain/client/database/PostgreeDatabaseClient.js', () => ({
    __esModule: true,
    default: class FakePostgreeDatabaseClient {
        public close = () => postgresClose();
    },
}));

import { closeProcessResources, processResources } from './processResources.js';

/**
 * A rede de segurança contra o esquecimento que criou este arquivo.
 *
 * O pool do `conexosSessionStore` ficou fora do SIGTERM porque a lista de recursos vivia
 * invisível no wiring do `index.ts`. Extrair para um módulo torna o próximo esquecimento
 * menos provável; um teste torna o próximo esquecimento **detectável**. Sem isto, nada
 * impede a segunda vez (card `integrability-2`).
 */
describe('processResources (integrability-2)', () => {
    beforeEach(() => {
        postgresClose.mockClear();
        sessionStoreClose.mockClear();
    });

    it('registra AMBOS os pools Postgres do processo', () => {
        const nomes = processResources().map((r) => r.nome);

        expect(nomes).toEqual(
            expect.arrayContaining(['postgres-pool', 'conexos-session-store-pool']),
        );
        // Trava o número: acrescentar recurso sem atualizar este teste falha aqui, que é
        // exatamente o alarme que faltava.
        expect(nomes).toHaveLength(2);
    });

    it('todo recurso registrado expõe close()', () => {
        for (const { nome, recurso } of processResources()) {
            expect(typeof recurso.close).toBe('function');
            expect(nome).not.toHaveLength(0);
        }
    });

    it('closeProcessResources fecha os dois', async () => {
        await closeProcessResources();

        expect(postgresClose).toHaveBeenCalledTimes(1);
        expect(sessionStoreClose).toHaveBeenCalledTimes(1);
    });

    it('um recurso que falha não impede o outro, e o log nomeia quem falhou', async () => {
        const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        postgresClose.mockRejectedValueOnce(new Error('pool already ended'));

        await expect(closeProcessResources()).resolves.toBeUndefined();

        expect(sessionStoreClose).toHaveBeenCalledTimes(1);
        expect(error.mock.calls.flat().join(' ')).toContain('postgres-pool');
        error.mockRestore();
    });
});

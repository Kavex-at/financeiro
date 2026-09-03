import { closeAll } from './lifecycle.js';

describe('closeAll (integrability-1)', () => {
    it('closes every closeable in the collection', async () => {
        const a = { close: jest.fn(async () => {}) };
        const b = { close: jest.fn(async () => {}) };

        const { errors } = await closeAll([a, b]);

        expect(a.close).toHaveBeenCalledTimes(1);
        expect(b.close).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([]);
    });

    /**
     * O ponto do módulo. Se um client quebrado impedisse os outros de fechar, o
     * shutdown travaria e a saída limpa viraria SIGKILL — o desfecho que o drain
     * existe para evitar.
     */
    it('still closes the others when one rejects, and never rejects itself', async () => {
        const boom = new Error('pool already ended');
        const first = { close: jest.fn(async () => {}) };
        const broken = { close: jest.fn().mockRejectedValue(boom) };
        const last = { close: jest.fn(async () => {}) };

        const { errors } = await closeAll([first, broken, last]);

        expect(first.close).toHaveBeenCalledTimes(1);
        expect(last.close).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([boom]);
    });

    it('skips closeables that do not implement close (the common case)', async () => {
        const stateless = {};
        const withClose = { close: jest.fn(async () => {}) };

        const { errors } = await closeAll([stateless, withClose]);

        expect(withClose.close).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([]);
    });

    it('resolves cleanly on an empty collection', async () => {
        await expect(closeAll([])).resolves.toEqual({ errors: [] });
    });
});

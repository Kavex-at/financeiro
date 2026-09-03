import { closeAll } from './lifecycle.js';

describe('closeAll (integrability-1)', () => {
    it('closes every closeable in the collection', async () => {
        const a = { close: jest.fn(async () => {}) };
        const b = { close: jest.fn(async () => {}) };

        const { errors } = await closeAll([
            { nome: 'a', recurso: a },
            { nome: 'b', recurso: b },
        ]);

        expect(a.close).toHaveBeenCalledTimes(1);
        expect(b.close).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([]);
    });

    /**
     * O ponto do módulo. Se um recurso quebrado impedisse os outros de fechar, o
     * shutdown travaria e a saída limpa viraria SIGKILL — o desfecho que o drain
     * existe para evitar.
     */
    it('still closes the others when one rejects, and never rejects itself', async () => {
        const boom = new Error('pool already ended');
        const first = { close: jest.fn(async () => {}) };
        const broken = { close: jest.fn().mockRejectedValue(boom) };
        const last = { close: jest.fn(async () => {}) };

        const { errors } = await closeAll([
            { nome: 'primeiro', recurso: first },
            { nome: 'quebrado', recurso: broken },
            { nome: 'ultimo', recurso: last },
        ]);

        expect(first.close).toHaveBeenCalledTimes(1);
        expect(last.close).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([{ nome: 'quebrado', erro: boom }]);
    });

    /** Sem o nome, o log do drain diz "algo não fechou" — inútil durante um incidente. */
    it('names the resource that failed', async () => {
        const { errors } = await closeAll([
            { nome: 'pool-postgres', recurso: { close: jest.fn().mockRejectedValue('x') } },
        ]);

        expect(errors).toHaveLength(1);
        expect(errors[0].nome).toBe('pool-postgres');
    });

    it('skips closeables that do not implement close (the common case)', async () => {
        const withClose = { close: jest.fn(async () => {}) };

        const { errors } = await closeAll([
            { nome: 'stateless', recurso: {} },
            { nome: 'com-close', recurso: withClose },
        ]);

        expect(withClose.close).toHaveBeenCalledTimes(1);
        expect(errors).toEqual([]);
    });

    it('resolves cleanly on an empty collection', async () => {
        await expect(closeAll([])).resolves.toEqual({ errors: [] });
    });
});

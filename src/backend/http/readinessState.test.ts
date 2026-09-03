import { isDraining, markDraining, resetReadinessForTests } from './readinessState.js';

describe('readinessState (availability-1)', () => {
    beforeEach(() => {
        resetReadinessForTests();
    });

    afterAll(() => {
        resetReadinessForTests();
    });

    it('starts ready', () => {
        expect(isDraining()).toBe(false);
    });

    it('reports draining once marked', () => {
        markDraining();

        expect(isDraining()).toBe(true);
    });

    it('is idempotent — a repeated signal keeps it draining', () => {
        markDraining();
        markDraining();

        expect(isDraining()).toBe(true);
    });

    /**
     * Invariante direcional: um processo que começou a descer não volta a se
     * declarar pronto. Se algum dia aparecer um `unmarkDraining`, este teste é o
     * lugar onde a decisão precisa ser revista.
     */
    it('exposes no way back to ready outside of tests', async () => {
        const moduleUnderTest = await import('./readinessState.js');

        expect(Object.keys(moduleUnderTest)).toEqual(
            expect.not.arrayContaining(['unmarkDraining', 'markReady']),
        );
    });
});

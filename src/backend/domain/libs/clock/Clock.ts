import { injectable, singleton } from 'tsyringe';

/**
 * Relógio injetável. Existe para que o TTL de um cache possa ser testado sem `setTimeout` real e
 * sem esperar o tempo passar: o teste entrega um relógio que ele mesmo avança.
 */
@singleton()
@injectable()
export default class Clock {
    /** Milissegundos desde a época (`Date.now()`). */
    public now = (): number => Date.now();
}

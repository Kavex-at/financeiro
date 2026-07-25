import { inject, injectable } from 'tsyringe';
import LogService from '../../LogService.js';
import type { MetricsEvent, MetricsPortInterface } from '../../../interface/recebimentos/ports.js';

/**
 * SKELETON stub — MetricsPortInterface (Módulo 6 seam). Reuses the shared `LogService` (NOT a
 * parallel logger) to emit a structured, PII-free event per stage under one correlation id.
 * `withCorrelationId` is a pass-through scope in the scaffold. Módulo 6 swaps this token for the
 * real CloudWatch/metrics emitter.
 */
@injectable()
export default class MetricsPortStub implements MetricsPortInterface {
    constructor(
        @inject(LogService)
        private logService: LogService,
    ) {}

    public emit = (event: MetricsEvent): void => {
        // No PII — stage/outcome/correlationId + numeric-or-flag attributes only.
        void this.logService.info({
            type: 'recebimentos.metrics',
            message: `stage=${event.stage} outcome=${event.outcome}`,
            qive_id: event.correlationId,
            data: { stage: event.stage, outcome: event.outcome, attributes: event.attributes },
        });
    };

    public withCorrelationId = <T>(_correlationId: string, fn: () => T): T => {
        return fn();
    };
}

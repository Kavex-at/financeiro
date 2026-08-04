import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê CONEXOS_USERNAME na construção, no import) — mesmo
// cuidado dos probes em `jobs/probe-*.ts`.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import IngestaoTransacoesService from '../domain/service/recebimentos/IngestaoTransacoesService.js';

/**
 * Job de ingestão do EXTRATO BANCÁRIO (Frente IV, Módulo 1). Espelha
 * `jobs/ingest-pagamentos.ts`: lê os créditos do Conexos (`fin133` → `fin095`),
 * normaliza, deduplica por chave natural e persiste em `transacao_bancaria` +
 * grava o run de auditoria. READ-ONLY no ERP.
 *
 * Janela e filiais vêm do `EnvironmentProvider`
 * (`RECEBIMENTO_INGEST_DIAS`, `RECEBIMENTO_INGEST_FIL_CODS`); `DIAS=` sobrescreve
 * pontualmente para backfill. A janela é sempre RECORTADA pelo piso
 * `CONEXOS_EXTRATO_SYNC_START_DATE` (default 2026-08-03) — nem o backfill alcança
 * lançamento anterior ao go-live (ADR-0028).
 *
 * CRON: DE HORA EM HORA, via `.github/workflows/ingest-extratos.yml` (`20 * * * *`).
 * O minuto :20 evita a disputa por sessão Conexos (`LOGIN_ERROR_MAX_SESSIONS`) com
 * os crons de Permutas e SISPAG, que rodam no minuto :00. O workflow tenta até 3×
 * com backoff; retentar é seguro porque a dedupe é por `natural_key` e o advisory
 * lock impede sobreposição.
 *
 * Exit non-zero em falha (fail-fast) para o agendador registrar o erro e retentar.
 */
const main = async (): Promise<void> => {
    const iniciadoEm = new Date();
    await bootstrapAppContainer();
    const service = container.resolve(IngestaoTransacoesService);

    const diasOverride = process.env.DIAS ? Number(process.env.DIAS) : undefined;
    const filCods = await service.resolverFilCods();
    const periodo = await service.resolverPeriodo(diasOverride);

    console.log(
        `[ingest-extratos] início ${iniciadoEm.toISOString()} · filiais=${filCods.join(',')} · ` +
            `janela=${periodo.de.toISOString().slice(0, 10)}..${periodo.ate.toISOString().slice(0, 10)}`,
    );

    const result = await service.runMany({
        filCods,
        periodo,
        correlationId: randomUUID(),
        triggeredBy: 'cron',
    });

    const finalizadoEm = new Date();
    const duracaoS = ((finalizadoEm.getTime() - iniciadoEm.getTime()) / 1000).toFixed(1);
    console.log(
        `[ingest-extratos] run ${result.runId} · fim ${finalizadoEm.toISOString()} (${duracaoS}s) · ` +
            `lidas=${result.total} inseridas=${result.inseridas} deduplicadas=${result.deduplicadas}`,
    );
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(
            '[ingest-extratos] ingestion FAILED:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });

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
 * pontualmente para backfill.
 *
 * CRON (NÃO configurado — entrada documentada apenas):
 *   30 6 * * *  cd /caminho/do/repo/src/backend && npm run job:ingest-extratos
 *
 * Exit non-zero em falha (fail-fast) para o agendador registrar o erro.
 */
const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const service = container.resolve(IngestaoTransacoesService);

    const diasOverride = process.env.DIAS ? Number(process.env.DIAS) : undefined;
    const filCods = await service.resolverFilCods();
    const periodo = await service.resolverPeriodo(diasOverride);

    const result = await service.runMany({
        filCods,
        periodo,
        correlationId: randomUUID(),
        triggeredBy: 'cron',
    });

    console.log(
        `[ingest-extratos] run ${result.runId} · filiais=${filCods.join(',')} · ` +
            `janela=${periodo.de.toISOString().slice(0, 10)}..${periodo.ate.toISOString().slice(0, 10)} · ` +
            `lidas=${result.total} deduplicadas=${result.deduplicadas}`,
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

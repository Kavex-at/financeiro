import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import SincronizarLotesSispagJob from './SincronizarLotesSispagJob.js';

/**
 * Sincroniza o status dos lotes SISPAG pela baixa do título no Conexos (L11, ADR-0055).
 *
 * READ-ONLY no ERP (I11a): lê o fin064 (prova de pagamento), o fin052 (agenda/rejeição) e o
 * PSQ_018 (trilha do borderô); grava só no nosso Postgres. Nunca carrega, processa nem baixa.
 *
 * CRON: `.github/workflows/sincronizar-lotes-sispag.yml` (de hora em hora, dias úteis, :35).
 * Trilha em `job_execucao` (pipeline `sispag-sincronizacao`) — o Painel de Operação a vigia.
 *
 * Nada deste job vai para o `bootstrapAppContainer`: ele é compartilhado por ~58 jobs.
 */
const main = async (): Promise<number> => {
    await bootstrapAppContainer();
    return container
        .resolve(SincronizarLotesSispagJob)
        .executar(process.env.TRIGGERED_BY ?? 'cron');
};

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error(
            '[sincronizar-lotes-sispag] FATAL:',
            redactErrorMessage(e instanceof Error ? e.message : String(e)),
        );
        process.exit(1);
    });

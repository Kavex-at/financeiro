import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';
import CalcularPerfilCanalJob from './CalcularPerfilCanalJob.js';

/**
 * Calcula o perfil de canal de cada favorecido (ADR-0063, I13i) — `perfil_canal_fornecedor`.
 *
 * READ-ONLY no ERP: lê borderôs/baixas de pagamento (fin010), contas (fin133) e débitos do extrato
 * (fin095). Grava só no nosso Postgres, numa transação; rodada com leitura falha não grava.
 *
 * CRON: `.github/workflows/calcular-perfil-canal.yml` (semanal, domingo 06:17 UTC).
 * Trilha em `job_execucao` (pipeline `sispag-perfil-canal`) — o Painel de Operação a vigia.
 *
 * Nada deste job vai para o `bootstrapAppContainer`: ele é compartilhado por ~58 jobs.
 */
const main = async (): Promise<number> => {
    await bootstrapAppContainer();
    return container.resolve(CalcularPerfilCanalJob).executar(process.env.TRIGGERED_BY ?? 'cron');
};

main()
    .then((code) => process.exit(code))
    .catch((e) => {
        console.error(
            '[calcular-perfil-canal] FATAL:',
            redactErrorMessage(e instanceof Error ? e.message : String(e)),
        );
        process.exit(1);
    });

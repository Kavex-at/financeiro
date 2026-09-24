import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton (ver ingest-pagamentos).
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import BoletoDdaService from '../domain/service/sispag/BoletoDdaService.js';

/**
 * Job de sincronização do pool de boletos DDA (`fin124`) para a aba "Boletos DDA" do SISPAG.
 * Incremental: arquivos novos + releitura dos importados nos últimos 60 dias. READ-ONLY no ERP.
 * O primeiro run lê o pool inteiro (~160 arquivos) — rode por aqui, não pelo botão.
 *
 * CRON (NÃO configurado — entrada documentada apenas; hoje é manual + botão na aba):
 *   30 9 * * 1-5  cd /caminho/do/repo/src/backend && npm run job:ingest-boletos-dda
 *
 * Exit non-zero em falha (fail-fast) para o agendador registrar o erro.
 */
const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const service = container.resolve(BoletoDdaService);
    const r = await service.sincronizar({ triggeredBy: 'job' });
    console.log(
        `[ingest-boletos-dda] arquivos novos=${r.arquivosNovos} relidos=${r.arquivosRelidos} ` +
            `boletos=${r.boletos} falhas=${r.falhas}`,
    );
    if (r.falhas > 0) process.exitCode = 1;
};

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error) => {
        console.error(
            '[ingest-boletos-dda] sincronização FALHOU:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });

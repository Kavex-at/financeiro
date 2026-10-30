import 'reflect-metadata';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import FormacaoLotesService from '../domain/service/sispag/FormacaoLotesService.js';

/**
 * Job de FORMAÇÃO AUTOMÁTICA de lotes SISPAG — roda LOGO APÓS a ingestão.
 * Monta lotes candidatos (RASCUNHO) com os títulos a vencer (≤7d), por filial × classe ×
 * banco, e desfaz os lotes automáticos que venceram. Escreve só no Postgres (READ-only no ERP).
 *
 * Roda no workflow `ingest-sispag.yml` depois de `job:ingest-pagamentos` (slots 05:07, 07:07 e
 * 12:13 BRT); o serviço pula fora de dia útil, antes das 06:30 BRT e se já formou hoje (v0.53.0).
 */
const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const service = container.resolve(FormacaoLotesService);
    // Cron = formação AUTOMÁTICA (dia útil, ≥ 06:30 BRT, uma por dia — o serviço decide). O
    // disparo manual do workflow passa `--manual` e forma sem trava, como a rota.
    const manual = process.argv.includes('--manual');
    const r = await service.formar({
        triggeredBy: manual ? 'manual' : 'cron',
        automatica: !manual,
    });
    if (r.pulado) {
        console.log(`[formar-lotes] pulada: ${r.pulado}`);
        return;
    }
    console.log(
        `[formar-lotes] lotes formados=${r.lotesFormados} títulos=${r.titulosLotados} ` +
            `desfeitos=${r.lotesDesfeitos}`,
    );
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(
            '[formar-lotes] formation FAILED:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });

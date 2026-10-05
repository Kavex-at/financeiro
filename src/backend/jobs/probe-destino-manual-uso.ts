import 'dotenv/config';
import 'reflect-metadata';
import { container } from 'tsyringe';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';

/**
 * Q4 da ADR-0061 (SOMENTE LEITURA): quanto do destino digitado por item (ADR-0054) existe no
 * banco. Decide o ramo da migration 0075: 0 = a coluna `destino_manual` fica inerte e nada é
 * convertido; > 0 = converter em exceção PENDENTE (nunca APROVADA), deduplicada por
 * favorecido + tipo, decisão do Yuri.
 *
 * Só `SELECT count(*)` e ids de lote. NENHUM valor de conta/chave é lido ou impresso (I10h).
 * Usa o banco do `.env` local do financeiro (não o MCP do Supabase, que é de outro projeto).
 *
 * NÃO toca o Conexos: sem login, a sessão do robô em `columbia-default` não é tocada.
 */
const main = async (): Promise<void> => {
    const env = await container.resolve(EnvironmentProvider).getEnvironmentVars();
    if (!env.databaseConnectionString) {
        console.log(
            '[probe-destino-manual-uso] databaseConnectionString ausente: Q4 NÃO medida. ' +
                'Rode com o .env que aponta para o banco do financeiro.',
        );
        process.exitCode = 2;
        return;
    }
    const db = container.resolve(PostgreeDatabaseClient);
    try {
        const itens = await db.selectFirst<{ n: string }>(
            'SELECT count(*)::text AS n FROM lote_pagamento_item WHERE destino_manual IS NOT NULL',
        );
        console.log(`itens com destino_manual não nulo: ${itens?.n ?? '?'}`);

        const trilha = await db.selectMany(
            `SELECT evento, count(*)::text AS n
               FROM lote_pagamento_item_destino_audit GROUP BY evento ORDER BY evento`,
        );
        if (trilha.length === 0) console.log('linhas na trilha destino_audit: 0');
        for (const r of trilha) console.log(`trilha destino_audit · ${r.evento}: ${r.n}`);

        const lotes = await db.selectMany(
            `SELECT l.id, l.fil_cod, count(*)::text AS itens
               FROM lote_pagamento l
               JOIN lote_pagamento_item i ON i.lote_id = l.id
              WHERE l.status = 'RASCUNHO' AND i.destino_manual IS NOT NULL
              GROUP BY l.id, l.fil_cod ORDER BY l.id`,
        );
        console.log(`lotes RASCUNHO com destino manual: ${lotes.length}`);
        for (const l of lotes) {
            console.log(`  lote ${l.id} (filial ${l.fil_cod}): ${l.itens} item(ns)`);
        }
    } finally {
        await db.close();
    }
};

main().catch((error: unknown) => {
    console.error(
        '[probe-destino-manual-uso] falhou:',
        redactErrorMessage(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
});

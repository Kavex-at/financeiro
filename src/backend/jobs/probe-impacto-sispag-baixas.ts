import 'dotenv/config';
import 'reflect-metadata';
import { container } from 'tsyringe';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';

/**
 * H2 — DESCOBERTA (read-only). Antes de minerar, descobrir se o `fin010/baixas/list/{borCod}`
 * devolve a data de vencimento do título. Sem isso não há como medir antecipação/atraso real.
 *
 * NÃO usa `bootstrapAppContainer()`: aquele caminho roda migrations contra a Supabase
 * compartilhada. Aqui só o mínimo para falar com o Conexos, e só endpoints de LEITURA.
 */

const FILIAIS = [1, 2];
const BORDEROS_AMOSTRA = 3;

async function main(): Promise<void> {
    await container.resolve(EnvironmentProvider).getEnvironmentVars();
    const resolver = container.resolve(ConexosSessionResolver);
    container.register(LEGACY_CONEXOS_TOKEN, {
        useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
    });
    const base = container.resolve(ConexosBaseClient);

    for (const filCod of FILIAIS) {
        console.log(`\n################ filial ${filCod}`);

        const borderos = await base.runWithRetry(() =>
            base.listGenericPaginated<Record<string, unknown>>(
                'fin010/list',
                {
                    fieldList: [],
                    filterList: { 'borVldTipo#EQ': 2, 'borVldFinalizado#EQ': 1 },
                    serviceName: 'fin010',
                    pageNumber: 1,
                    pageSize: 20,
                },
                { filCod },
            ),
        );
        console.log(`borderôs finalizados retornados: ${borderos.rows?.length ?? 0}`);
        const primeiro = borderos.rows?.[0];
        if (primeiro) console.log('CAMPOS do borderô:', Object.keys(primeiro).sort().join(', '));

        for (const row of (borderos.rows ?? []).slice(0, BORDEROS_AMOSTRA)) {
            const borCod = Number(row.borCod);
            if (!Number.isFinite(borCod)) continue;
            const baixas = await base.runWithRetry(() =>
                base.listGenericPaginated<Record<string, unknown>>(
                    `fin010/baixas/list/${borCod}`,
                    { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 20 },
                    { filCod },
                ),
            );
            const b = baixas.rows?.[0];
            console.log(
                `\n-- borderô ${borCod} (borDtaMvto=${row.borDtaMvto}) → ${baixas.rows?.length ?? 0} baixas`,
            );
            if (b) {
                console.log('   CAMPOS da baixa:', Object.keys(b).sort().join(', '));
                const datas = Object.entries(b).filter(([k]) => /dta|venc|date/i.test(k));
                console.log('   campos de DATA:', JSON.stringify(Object.fromEntries(datas)));
            }
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

import 'dotenv/config';
import 'reflect-metadata';
import { container } from 'tsyringe';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';

/**
 * SONDA READ-ONLY — raio-x de títulos a pagar suspeitos de duplicidade.
 * Para cada `fil:docCod`, lê a linha inteira do `fin064` (campos não-nulos) e TODAS as baixas
 * do título no `com308` (PSQ_018, sem filtrar borderô finalizado).
 *
 * Run:
 *   cd src/backend && PROBE_PRD=1 databaseConnectionString="" PROBE_DOCS="4:6173,4:6702" \
 *     npx tsx jobs/probe-titulo-detalhe.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const DOCS = (process.env.PROBE_DOCS ?? '')
    .split(',')
    .map((s) => s.trim().split(':'))
    .filter((p) => p.length === 2)
    .map(([fil, doc]) => ({ filCod: Number(fil), docCod: String(doc) }));

type Row = Record<string, unknown>;

const naoNulos = (r: Row): Row =>
    Object.fromEntries(
        Object.entries(r).filter(([, v]) => v !== null && v !== '' && v !== undefined),
    );

async function conectar(): Promise<ConexosBaseClient> {
    await container.resolve(EnvironmentProvider).getEnvironmentVars();
    const resolver = container.resolve(ConexosSessionResolver);
    container.register(LEGACY_CONEXOS_TOKEN, {
        useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
    });
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    return base;
}

const corpo = (serviceName: string, filterList: Row = {}): Row => ({
    fieldList: [],
    filterList,
    serviceName,
    pageNumber: 1,
    pageSize: 200,
});

async function main(): Promise<void> {
    const base = await conectar();
    for (const { filCod, docCod } of DOCS) {
        console.log(`\n================ fil ${filCod} · docCod ${docCod} ================`);
        const tit = await base.listGenericPaginated<Row>(
            'fin064/list',
            corpo('fin064', { 'docCod#EQ': docCod }),
            { filCod },
        );
        const linhas = tit.rows.filter((r) => String(r.docCod) === docCod);
        console.log(`fin064: ${linhas.length} linha(s) (count=${tit.count})`);
        for (const r of linhas) console.log(JSON.stringify(naoNulos(r), null, 1));
        for (const r of linhas) {
            const titCod = String(r.titCod ?? '1');
            try {
                const bx = await base.listGenericPaginated<Row>(
                    `com308/financeiroAPagar/baixas/list/${docCod}/${titCod}/0`,
                    corpo('com308'),
                    { filCod },
                );
                console.log(`com308 baixas tit ${titCod}: ${bx.rows.length} (count=${bx.count})`);
                for (const b of bx.rows) console.log(JSON.stringify(naoNulos(b), null, 1));
            } catch (err) {
                console.log(`com308 baixas tit ${titCod}: ERRO ${(err as Error).message}`);
            }
        }
    }
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(
            'sonda falhou:',
            redactErrorMessage(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
    },
);

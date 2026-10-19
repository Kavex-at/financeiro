import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';

/**
 * LEITURA HML — solicitações de desconto em título (`fin062`) e sua liberação (`fin063`).
 *
 * Pergunta: o fluxo nativo de desconto reduz o `fin064.totalAberto` do título antes do pagamento?
 * Se sim, é o caminho para o boleto ABAIXO do título (o J do `.REM` paga o valor do TÍTULO, não o
 * do item — HML 2026-10-19). Só `list`; nada é escrito. Mesmas travas do probe de centavos.
 *
 *   cd src/backend
 *   HML_ENV_FILE=... CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" npx tsx jobs/probe-hml-desconto-fin062.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') || !process.env.HML_ENV_FILE) {
    console.error('RECUSADO: só HML, com HML_ENV_FILE.');
    process.exit(1);
}
if (process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: rode com databaseConnectionString="".');
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 2);
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-fin062] ${s}`);

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);
    await base.ensureSid();
    for (const tela of ['fin062', 'fin063']) {
        try {
            const res = await base.listGenericPaginated<Row>(
                `${tela}/list`,
                { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 50, serviceName: tela },
                { filCod: FIL },
            );
            const rows = res.rows ?? [];
            log(`${tela}: ${res.count ?? rows.length} registros`);
            const status = new Map<string, number>();
            for (const r of rows) {
                const k = String(r.dfcVldStatus);
                status.set(k, (status.get(k) ?? 0) + 1);
            }
            log(`   por dfcVldStatus: ${JSON.stringify(Object.fromEntries(status))}`);
            for (const r of rows.slice(0, 6)) {
                const doc = String(r.docCod ?? '');
                const tit = String(r.titCod ?? '1');
                const aberto = doc ? await sispag.lerTotalAberto(FIL, doc, tit) : undefined;
                log(
                    `   doc=${doc}/${tit} tip=${String(r.docTip)} status=${String(r.dfcVldStatus)} valor=${String(r.dfcMnyValor)} borCod=${String(r.borCod)} ger=${String(r.gerNum)} aberto=${JSON.stringify(aberto)}`,
                );
            }
        } catch (e) {
            const err = e as { message?: string; response?: { status?: unknown; data?: unknown } };
            log(
                `${tela}: falhou ${String(err.response?.status)} ${JSON.stringify(err.response?.data ?? err.message).slice(0, 300)}`,
            );
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-fin062] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * LIMPEZA dos lotes de teste fin015 deixados em HML pelos harnesses
 * (`validate-fin015-tools.ts`, `validate-fin015-import.ts`).
 *
 * `GET fin015/cancelarLote/{filCodLote}/{bncCod}/{flpCod}` — o cancelamento nativo da
 * tela. Não apaga o registro (o ERP mantém histórico), põe em status CANCELADO.
 *
 * SEGURANÇA: recusa rodar fora de HML. Nunca aponte para produção — cancelar um lote
 * real de pagamento é destrutivo.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   FLPS=22,23,24,25 npx tsx jobs/cleanup-fin015-testes.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Cancelar lote é destrutivo.`);
    process.exit(1);
}

const FIL = Number(process.env.FLP_FIL ?? 1);
const BNC = Number(process.env.FLP_BNC ?? 4);
const FLPS = (process.env.FLPS ?? '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

async function main(): Promise<void> {
    if (FLPS.length === 0) {
        console.error('Nada a fazer: passe FLPS=22,23,24 (lotes de teste a cancelar).');
        process.exit(1);
    }
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    console.log(`BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC}`);
    console.log(`cancelando lotes: ${FLPS.join(', ')}\n`);

    for (const flpCod of FLPS) {
        try {
            await base.getGeneric(`fin015/cancelarLote/${FIL}/${BNC}/${flpCod}`, { filCod: FIL });
            console.log(`  flp ${flpCod} → CANCELADO`);
        } catch (e) {
            console.log(`  flp ${flpCod} → erro: ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    console.log('\nfim.');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

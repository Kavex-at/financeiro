import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosTitulosClient from '../domain/client/ConexosTitulosClient.js';
import { derivarPagoDosTitulos } from '../domain/service/permutas/EleicaoPermutasService.js';

/**
 * Ground-Truth Validation — `invoice-pago-detalhe` (v1).
 *
 * Compara o `pago` que a NOSSA lógica produz (a MESMA função da ingestão,
 * `derivarPagoDosTitulos`, alimentada pelo `listTitulosAPagar` real já com
 * `titMnyTotPago`) contra o ground truth nativo do ERP: `getDetalheTitulos`
 * (`GET com298/{docCod}` → `mnyTitAberto === 0`), que é o bloco RESUMO DOS TÍTULOS
 * que o analista enxerga na tela do Conexos.
 *
 * Importa a função de produção em vez de reimplementar a regra: um validador que
 * reescreve a fórmula valida a si mesmo, não o código que vai para produção.
 *
 * Tolerância: **ZERO divergências**. A regra é booleana e estrita — não há faixa
 * de erro aceitável, ou a invoice está quitada ou não está.
 *
 * READ-ONLY: `POST com298/list`, `POST com308/.../list/{docCod}`, `GET com298/{docCod}`.
 *
 * Run: PROBE_ALLOW_PRD=1 FILS=2 N=80 npx tsx jobs/validate-invoice-pago-detalhe-v1.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(`RECUSADO: base é PRODUÇÃO (${BASE}); rode com PROBE_ALLOW_PRD=1.`);
    process.exit(1);
}

const FILIAIS = (process.env.FILS ?? '2').split(',').map(Number);
const N = Number(process.env.N ?? 80);

const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const titulos = container.resolve(ConexosTitulosClient);

    let total = 0;
    let ok = 0;
    let semVeredito = 0;
    const divergencias: Array<Record<string, unknown>> = [];

    for (const filCod of FILIAIS) {
        const rows = await base.paginate<Record<string, unknown>>({
            endpoint: 'com298/list',
            bodyBase: {
                fieldList: [],
                filterList: { 'tpdCod#EQ': 128, 'vldStatus#IN': ['3'] },
                serviceName: 'com298',
            },
            opts: { filCod },
        });
        // Amostra espalhada pela lista (não só as N mais recentes) — invoices antigas
        // têm perfil de pagamento diferente das novas.
        const passo = Math.max(1, Math.floor(rows.length / N));
        const amostra = rows.filter((_, i) => i % passo === 0).slice(0, N);

        for (const row of amostra) {
            const docCod = String(row.docCod ?? '');
            total++;
            const [tits, det] = await Promise.all([
                titulos.listTitulosAPagar({ docCod, filCod }),
                titulos.getDetalheTitulos({ docCod, filCod }).catch(() => undefined),
            ]);
            const nosso = derivarPagoDosTitulos(tits);
            const erp = det?.pago;
            if (nosso === undefined || erp === undefined) {
                semVeredito++;
                continue;
            }
            if (nosso === erp) {
                ok++;
            } else {
                divergencias.push({
                    filCod,
                    docCod,
                    priCod: String(row.priCod ?? ''),
                    nosso: nosso ? 'PAGA' : 'ABERTA',
                    erp: erp ? 'PAGA' : 'ABERTA',
                    faceSomada: tits.reduce((a, t) => a + (t.valorBrl ?? 0), 0),
                    pagoSomado: tits.reduce((a, t) => a + (t.valorPago ?? 0), 0),
                    valorAbertoErp: det?.valorAberto,
                    titulos: tits.length,
                });
            }
        }
    }

    console.log('\n=== GROUND TRUTH — invoice-pago-detalhe v1 ===');
    console.log(
        `amostra=${total} concordam=${ok} divergem=${divergencias.length} semVeredito=${semVeredito}`,
    );
    if (divergencias.length > 0) {
        console.log(JSON.stringify(divergencias.slice(0, 20), null, 2));
        console.error('\nDIVERGENTE — gate P0. A derivação não reproduz o ERP.');
        process.exit(1);
    }
    console.log('\nCONFORME — 0 divergências contra o ground truth do Conexos.');
};

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

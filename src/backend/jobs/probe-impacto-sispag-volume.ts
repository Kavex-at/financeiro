import 'dotenv/config';
import 'reflect-metadata';
import { container } from 'tsyringe';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';

/**
 * Volume de pagamento manual (READ-ONLY, PRD) — responde "quantos títulos são pagos por
 * dia/semana", que a analista não soube estimar.
 *
 * Estratégia barata: contar borderôs finalizados por mês (1 chamada paginada) e medir a média
 * de baixas por borderô numa amostra pequena. Títulos/mês = borderôs/mês × média.
 *
 * Só endpoints de LEITURA. Não usa `bootstrapAppContainer()`.
 */

const FILIAIS = [1, 2, 3];
const PAGINAS_BORDERO = 6;
const PAGE_SIZE = 1000;
const AMOSTRA_BAIXAS = 40;

const mes = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 7);

async function main(): Promise<void> {
    await container.resolve(EnvironmentProvider).getEnvironmentVars();
    const resolver = container.resolve(ConexosSessionResolver);
    container.register(LEGACY_CONEXOS_TOKEN, {
        useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
    });
    const base = container.resolve(ConexosBaseClient);

    for (const filCod of FILIAIS) {
        console.log(`\n################ filial ${filCod}`);

        const borderos: Array<{ borCod: number; data: number }> = [];

        for (let pagina = 1; pagina <= PAGINAS_BORDERO; pagina++) {
            const page = await base.runWithRetry(() =>
                base.listGenericPaginated<Record<string, unknown>>(
                    'fin010/list',
                    {
                        fieldList: [],
                        filterList: { 'borVldTipo#EQ': 2, 'borVldFinalizado#EQ': 1 },
                        serviceName: 'fin010',
                        pageNumber: pagina,
                        pageSize: PAGE_SIZE,
                        orderList: { orderList: [{ propertyName: 'borDtaMvto', order: 'desc' }] },
                    },
                    { filCod },
                ),
            );
            const linhas = page.rows ?? [];
            for (const r of linhas) {
                const borCod = Number(r.borCod);
                const data = Number(r.borDtaMvto);
                if (Number.isFinite(borCod) && Number.isFinite(data) && data > 0) {
                    borderos.push({ borCod, data });
                }
            }
            if (linhas.length < PAGE_SIZE) break;
        }

        console.log(`borderôs finalizados lidos: ${borderos.length}`);

        const porMes = new Map<string, number>();
        for (const b of borderos) porMes.set(mes(b.data), (porMes.get(mes(b.data)) ?? 0) + 1);

        // Média de baixas por borderô, numa amostra dos mais recentes.
        let totalBaixas = 0;
        let amostrados = 0;
        for (const b of borderos.slice(0, AMOSTRA_BAIXAS)) {
            try {
                const page = await base.runWithRetry(() =>
                    base.listGenericPaginated<Record<string, unknown>>(
                        `fin010/baixas/list/${b.borCod}`,
                        { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 200 },
                        { filCod },
                    ),
                );
                totalBaixas += (page.rows ?? []).length;
                amostrados++;
            } catch {
                // borderô ilegível não invalida a amostra
            }
        }

        const media = amostrados > 0 ? totalBaixas / amostrados : Number.NaN;
        console.log(
            `amostra: ${amostrados} borderôs → ${totalBaixas} baixas · média ${media.toFixed(2)}/borderô`,
        );

        const meses = [...porMes.entries()].sort().slice(-14);
        console.table(
            meses.map(([m, n]) => ({
                mes: m,
                borderos: n,
                titulos_estimados: Number.isFinite(media) ? Math.round(n * media) : null,
                titulos_por_dia_util: Number.isFinite(media) ? ((n * media) / 21).toFixed(1) : null,
            })),
        );
    }
}

void main();

import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { container } from 'tsyringe';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';

/**
 * H2 — Antecipação / atraso de pagamento (READ-ONLY, PRD).
 *
 * `dias = vencimento(fin064) − data da baixa(fin010.borDtaMvto)`
 *   dias > 0 → pago ANTES do vencimento (antecipação, custo de float)
 *   dias < 0 → pago DEPOIS (atraso, exposição a multa/juros)
 *
 * A baixa do fin010 NÃO traz o vencimento (sondado em 2026-08-21), então o vencimento vem do
 * `fin064` e é cruzado por (docCod, titCod). Como `fin010/baixas` custa 1 chamada por borderô,
 * AMOSTRAMOS borderôs em vez de varrer tudo — a cobertura do cruzamento é reportada junto.
 *
 * NÃO usa `bootstrapAppContainer()` (aquele roda migrations na Supabase compartilhada).
 * Só endpoints de LEITURA.
 */

const FILIAIS = [1, 2];
const MAX_BORDEROS_POR_FILIAL = 150;
const PAGINAS_FIN064 = 12;
const PAGE_SIZE_FIN064 = 1000;
const DIA_MS = 86_400_000;

type Baixa = { docCod: string; titCod: string; valor: number; dataBaixa: number };

const pct = (n: number, total: number): string =>
    total > 0 ? `${((100 * n) / total).toFixed(1)}%` : '—';

const quantil = (ordenados: number[], q: number): number => {
    if (ordenados.length === 0) return Number.NaN;
    const i = Math.min(ordenados.length - 1, Math.floor(q * (ordenados.length - 1)));
    return ordenados[i] as number;
};

async function main(): Promise<void> {
    await container.resolve(EnvironmentProvider).getEnvironmentVars();
    const resolver = container.resolve(ConexosSessionResolver);
    container.register(LEGACY_CONEXOS_TOKEN, {
        useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
    });
    const base = container.resolve(ConexosBaseClient);
    const saida: Record<string, unknown> = {};

    for (const filCod of FILIAIS) {
        console.log(`\n################ filial ${filCod}`);

        // 1) Vencimentos: fin064 SEM filtro de não-pago, para alcançar o histórico já baixado.
        const vencimentos = new Map<string, number>();
        for (let pagina = 1; pagina <= PAGINAS_FIN064; pagina++) {
            const page = await base.runWithRetry(() =>
                base.listGenericPaginated<Record<string, unknown>>(
                    'fin064/list',
                    {
                        fieldList: [],
                        filterList: {},
                        serviceName: 'fin064',
                        pageNumber: pagina,
                        pageSize: PAGE_SIZE_FIN064,
                    },
                    { filCod },
                ),
            );
            const linhas = page.rows ?? [];
            for (const r of linhas) {
                const venc = Number(r.titDtaVencimento);
                if (!Number.isFinite(venc) || venc <= 0) continue;
                vencimentos.set(`${r.docCod}|${r.titCod ?? '1'}`, venc);
            }
            if (linhas.length < PAGE_SIZE_FIN064) break;
        }
        console.log(`fin064: ${vencimentos.size} títulos com vencimento mapeados`);

        // 2) Borderôs a-pagar finalizados, mais recentes primeiro.
        const borderos = await base.runWithRetry(() =>
            base.listGenericPaginated<Record<string, unknown>>(
                'fin010/list',
                {
                    fieldList: [],
                    filterList: { 'borVldTipo#EQ': 2, 'borVldFinalizado#EQ': 1 },
                    serviceName: 'fin010',
                    pageNumber: 1,
                    pageSize: MAX_BORDEROS_POR_FILIAL,
                    orderList: { orderList: [{ propertyName: 'borDtaMvto', order: 'desc' }] },
                },
                { filCod },
            ),
        );

        // 3) Baixas de cada borderô amostrado.
        const baixas: Baixa[] = [];
        for (const row of borderos.rows ?? []) {
            const borCod = Number(row.borCod);
            const dataBaixa = Number(row.borDtaMvto);
            if (!Number.isFinite(borCod) || !Number.isFinite(dataBaixa)) continue;
            try {
                const page = await base.runWithRetry(() =>
                    base.listGenericPaginated<Record<string, unknown>>(
                        `fin010/baixas/list/${borCod}`,
                        { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 200 },
                        { filCod },
                    ),
                );
                for (const b of page.rows ?? []) {
                    const valor = Number(b.bxaMnyValor ?? b.bxaMnyLiquido ?? 0);
                    if (!Number.isFinite(valor) || valor <= 0) continue;
                    baixas.push({
                        docCod: String(b.docCod),
                        titCod: String(b.titCod ?? '1'),
                        valor,
                        dataBaixa,
                    });
                }
            } catch {
                // borderô sem baixas legíveis não invalida a amostra
            }
        }

        // 4) Cruzamento e métrica.
        const casados = baixas.flatMap((b) => {
            const venc = vencimentos.get(`${b.docCod}|${b.titCod}`);
            if (venc === undefined) return [];
            return [{ ...b, dias: (venc - b.dataBaixa) / DIA_MS }];
        });

        const ordenados = casados.map((c) => c.dias).sort((a, b) => a - b);
        const antecipados = casados.filter((c) => c.dias > 1);
        const noPrazo = casados.filter((c) => c.dias >= -1 && c.dias <= 1);
        const atrasados = casados.filter((c) => c.dias < -1);
        const valorDias = antecipados.reduce((s, c) => s + c.valor * c.dias, 0);

        const resumo = {
            borderos_amostrados: borderos.rows?.length ?? 0,
            baixas_lidas: baixas.length,
            baixas_cruzadas: casados.length,
            cobertura_do_cruzamento: pct(casados.length, baixas.length),
            antecipados: `${antecipados.length} (${pct(antecipados.length, casados.length)})`,
            no_prazo_1d: `${noPrazo.length} (${pct(noPrazo.length, casados.length)})`,
            atrasados: `${atrasados.length} (${pct(atrasados.length, casados.length)})`,
            mediana_dias: ordenados.length ? quantil(ordenados, 0.5).toFixed(1) : '—',
            p10_dias: ordenados.length ? quantil(ordenados, 0.1).toFixed(1) : '—',
            p90_dias: ordenados.length ? quantil(ordenados, 0.9).toFixed(1) : '—',
            valor_x_dias_antecipados: valorDias.toFixed(2),
            custo_cdi_10: ((valorDias / 365) * 0.1).toFixed(2),
            custo_cdi_15: ((valorDias / 365) * 0.15).toFixed(2),
        };
        console.table(resumo);
        saida[`filial_${filCod}`] = resumo;
    }

    const destino = resolve(process.cwd(), '../../docs/impacto/dados');
    mkdirSync(destino, { recursive: true });
    writeFileSync(
        resolve(destino, 'h2-antecipacao.json'),
        `${JSON.stringify({ gerado_em: new Date().toISOString(), saida }, null, 2)}\n`,
    );
    console.log('\nJSON salvo em docs/impacto/dados/h2-antecipacao.json');
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

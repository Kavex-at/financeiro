import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY (HML) — como é um item DDA ASSOCIADO?
 *
 * `probe-fin124-dda.ts` achou em HML 3 itens do `fin124` com `docCod`/`titCod`/`flpCod`
 * preenchidos (em PRD são 0 de 297). Esses 3 são o GROUND TRUTH da associação: mostram
 * o estado final que queremos produzir, e de qual lote vieram.
 *
 * Também lê o item correspondente do lote (`FinItemSispag`) para comparar
 * `ditEspCodbar` (44) com `itsNumCodbar` (47) no MESMO boleto — prova a conversão.
 *
 * SEGURANÇA: só `/list`. Nenhuma escrita.
 * Run: cd src/backend && CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api npx tsx jobs/probe-dda-associado-hml.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: esta sonda é para HML (base atual: ${BASE}).`);
    process.exit(1);
}
const OUT = '/tmp/dda-associado-hml';
type Row = Record<string, unknown>;
const cheio = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    console.log(`BASE: ${BASE} (HML)\n`);

    const arquivos = await base.listGenericPaginated<Row>(
        'fin124/list',
        { fieldList: [], filterList: {}, serviceName: 'fin124', pageNumber: 1, pageSize: 100 },
        { filCod: 2 },
    );
    const associados: Row[] = [];
    for (const arq of arquivos.rows ?? []) {
        const itens = await base.listGenericPaginated<Row>(
            `fin124/itens/list/${arq.ddcCod}`,
            { fieldList: [], filterList: {}, serviceName: 'fin124', pageNumber: 1, pageSize: 500 },
            { filCod: 2 },
        );
        associados.push(...(itens.rows ?? []).filter((i) => cheio(i.docCod)));
    }
    console.log(`itens DDA ASSOCIADOS em HML: ${associados.length}`);
    writeFileSync(`${OUT}/itens-associados.json`, JSON.stringify(associados, null, 2));
    for (const a of associados) console.log(JSON.stringify(a));

    // Item do lote correspondente — compara barras 44 (DDA) × 47 (linha digitável)
    console.log('\n── item do lote correspondente ──');
    for (const a of associados) {
        const filCod = Number(a.filCod);
        const flpCod = Number(a.flpCod);
        const bncCod = Number(a.bncCod ?? 0);
        if (!flpCod) continue;
        for (const bnc of bncCod ? [bncCod] : [1, 2, 3, 4, 5, 6]) {
            try {
                const page = await base.listGenericPaginated<Row>(
                    `fin015/finItemSispag/list/${filCod}/${bnc}/${flpCod}`,
                    {
                        fieldList: [],
                        filterList: {},
                        serviceName: 'fin015',
                        pageNumber: 1,
                        pageSize: 200,
                    },
                    { filCod },
                );
                const match = (page.rows ?? []).find(
                    (r) =>
                        String(r.docCod) === String(a.docCod) &&
                        String(r.titCod) === String(a.titCod),
                );
                if (match) {
                    console.log(
                        `DDA  ditEspCodbar (${String(a.ditEspCodbar).length}): ${a.ditEspCodbar}`,
                    );
                    console.log(
                        `ITEM itsNumCodbar (${String(match.itsNumCodbar ?? '').length}): ${match.itsNumCodbar}`,
                    );
                    console.log(
                        `     modalidade=${match.itsVldModalidade} vldVinculoDda=${match.vldVinculoDda} itsNumBanco=${match.itsNumBanco}`,
                    );
                    writeFileSync(
                        `${OUT}/item-lote-${a.docCod}-${a.titCod}.json`,
                        JSON.stringify(match, null, 2),
                    );
                    break;
                }
            } catch {
                /* tenta o próximo bnc */
            }
        }
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});

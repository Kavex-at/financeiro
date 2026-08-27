import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';

/**
 * SONDA READ-ONLY — o `com308` (FinTituloFin) traz `titEspCodbar` a nível de CARTEIRA?
 *
 * Se sim, a coluna "tem boleto?" do painel sai de uma fonte que já lemos por título,
 * sem depender de casar o pool global do fin124 por valor+vencimento.
 * `FinTituloFin` declara `titEspCodbar` no OpenAPI (070-com3.json) — falta medir se
 * vem preenchido em produção.
 *
 * SEGURANÇA: só `/list`. Nenhuma escrita.
 * Run: cd src/backend && PROBE_PRD=1 npx tsx jobs/probe-com308-codbar.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/com308-codbar-probe';
const AMOSTRA = Number(process.env.AMOSTRA ?? 40);
type Row = Record<string, unknown>;
const cheio = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);
    console.log(`BASE: ${BASE}\n`);
    await base.ensureSid();

    for (const filCod of [1, 2]) {
        const titulos = (await sispag.listTitulosAPagar(filCod, {})).slice(0, AMOSTRA);
        console.log(`[com308] fil=${filCod}: sondando ${titulos.length} docs da carteira`);
        let comBarras = 0;
        let lidos = 0;
        let salvo = false;
        for (const t of titulos) {
            try {
                const rows = await base.callList<Row[]>(
                    `com308/financeiroAPagar/list/${t.docCod}`,
                    {
                        // fieldList VAZIO de propósito: quero ver TODOS os campos que o
                        // com308 devolve, não só os 6 que a variação cambial pede.
                        fieldList: [],
                        filterList: { 'titVldStatus#EQ': '1' },
                        serviceName: 'com308.finTituloFin',
                        pageNumber: 1,
                        pageSize: 100,
                        orderList: { orderList: [{ propertyName: 'titCod', order: 'asc' }] },
                    },
                    `com308/financeiroAPagar/list/${t.docCod}`,
                    undefined,
                    { filCod },
                );
                for (const r of rows ?? []) {
                    lidos += 1;
                    if (cheio(r.titEspCodbar)) {
                        comBarras += 1;
                        if (!salvo) {
                            writeFileSync(
                                `${OUT}/exemplo-com308-com-barras-fil${filCod}.json`,
                                JSON.stringify(r, null, 2),
                            );
                            salvo = true;
                        }
                    }
                }
                if (lidos > 0 && !salvo && rows?.[0]) {
                    writeFileSync(
                        `${OUT}/exemplo-com308-fil${filCod}.json`,
                        JSON.stringify(rows[0], null, 2),
                    );
                }
            } catch (err) {
                console.log(
                    `  doc ${t.docCod}: ${err instanceof Error ? err.message.slice(0, 90) : String(err)}`,
                );
            }
        }
        console.log(
            `[com308] fil=${filCod}: ${lidos} títulos lidos → comBarras=${comBarras} (${lidos ? Math.round((comBarras / lidos) * 100) : 0}%)\n`,
        );
    }
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});

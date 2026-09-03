import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * Sonda fin015 em HOMOLOGAÇÃO — testa login + (opcional) escrita p/ gerar um `.REM`.
 *
 * SEGURANÇA: RECUSA rodar se a base não for HML (guard anti-PRD). Escrita só com PROBE_WRITE=1.
 * Run (leitura): CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api tsx jobs/probe-fin015-hml.ts
 * Run (gerar):   ...  PROBE_WRITE=1 FLP=8 FLP_FIL=1 FLP_BNC=4 tsx jobs/probe-fin015-hml.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Aponte CONEXOS_BASE_URL p/ *-hml* antes.`);
    process.exit(1);
}

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const c = container.resolve(ConexosBaseClient);
    await c.ensureSid();
    console.log(`[hml] login OK · base=${BASE}`);

    // 1) LEITURA: lotes FINALIZADOS (situação=1) — candidatos p/ gerar remessa.
    const fil = Number(process.env.FLP_FIL ?? 1);
    const bnc = Number(process.env.FLP_BNC ?? 4);
    const lotes = await c.listGenericPaginated<Record<string, unknown>>(
        'fin015/list',
        {
            fieldList: [],
            filterList: { 'flpVldStatus#EQ': 1 },
            serviceName: 'fin015',
            pageNumber: 1,
            pageSize: 20,
        },
        { filCod: fil },
    );
    console.log(`[hml] lotes FINALIZADOS (fil ${fil}):`);
    for (const r of lotes.rows) {
        console.log(
            `   fil${r.filCod} bnc${r.bncCod} flp${r.flpCod} | ${r.layoutConta} | R$ ${r.soma}`,
        );
    }

    if (process.env.PROBE_WRITE !== '1') {
        console.log('[hml] READ-ONLY (PROBE_WRITE!=1) — nenhuma escrita. Fim.');
        return;
    }

    // 2) ESCRITA: gerarRemessa num lote finalizado (grbCodSeq=1 = REMESSA SISPAG - ITAÚ).
    const flp = Number(process.env.FLP);
    const body: Record<string, unknown> = {
        filCodLote: fil,
        bncCod: bnc,
        flpCod: flp,
        grbCodSeq: 1,
        seqNum: Number(process.env.SEQ ?? 90),
        gabEspNomeArquivo: process.env.NOME ?? 'PG090790.REM',
    };
    console.log('[hml] >>> gerarRemessa body:', JSON.stringify(body));
    try {
        const res = await c.postGeneric('fin015/gerArquivosBancos/gerarRemessa', body, {
            filCod: fil,
        });
        console.log('[hml] gerarRemessa OK:', JSON.stringify(res).slice(0, 400));
    } catch (e) {
        console.log('[hml] gerarRemessa ERRO:', e instanceof Error ? e.message : String(e));
    }

    // 3) lê o .REM gerado (gabLngDados) e salva.
    const files = await c.listGenericPaginated<Record<string, unknown>>(
        `fin015/gerArquivosBancos/list/${fil}`,
        {
            fieldList: [],
            filterList: { bncCod: bnc, flpCod: flp },
            serviceName: 'fin015',
            pageNumber: 1,
            pageSize: 20,
        },
        { filCod: fil },
    );
    const rem = files.rows.find((r) => r.gabLngDados);
    if (rem) {
        writeFileSync('/tmp/hml-gerado.REM', String(rem.gabLngDados));
        console.log(
            `[hml] .REM salvo em /tmp/hml-gerado.REM · nome=${rem.gabEspNomeArquivo} · gabCod=${rem.gabCod}`,
        );
    } else {
        console.log('[hml] nenhum .REM encontrado para esse lote.');
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

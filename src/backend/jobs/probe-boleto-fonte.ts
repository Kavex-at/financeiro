import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY — de ONDE vem o código de barras que o `.REM` usa?
 *
 * Duas perguntas que decidem o desenho inteiro:
 *   Q1. O grid de PENDENTES do fin015 (`TituloPendenteDTO`) já traz `titEspCodbar`?
 *       Se sim, o barcode chega até nós ANTES do import e não precisamos casar nada
 *       com o fin124 — basta usá-lo (hoje mandamos `?? ''`).
 *   Q2. As modalidades 6 e 7 (ambas 100% com barras nos lotes reais) se distinguem pelo
 *       BANCO EMISSOR do boleto? Hipótese: 6 = mesmo banco do lote (Itaú 341),
 *       7 = outro banco. Nosso `MODALIDADE_NATIVA.BOLETO` é 7 fixo — se a hipótese
 *       valer, mandamos a modalidade errada na maioria dos boletos.
 *
 * SEGURANÇA: só endpoints `/list` (leitura). Nenhuma escrita.
 *
 * Run:  cd src/backend && PROBE_PRD=1 tsx jobs/probe-boleto-fonte.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/boleto-fonte-probe';
type Row = Record<string, unknown>;
const cheio = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const log = (s: string): void => console.log(`[boleto-fonte] ${s}`);
const save = (n: string, d: unknown): void => {
    writeFileSync(`${OUT}/${n}`, JSON.stringify(d, null, 2));
    log(`  ↳ salvo ${OUT}/${n}`);
};

/** Lotes conhecidos com itens (medidos por probe-fin015-boleto-vinculo). */
const LOTES = [
    { filCod: 1, bncCod: 4, flpCod: 2 },
    { filCod: 2, bncCod: 4, flpCod: 10 },
    { filCod: 2, bncCod: 4, flpCod: 4 },
    { filCod: 4, bncCod: 4, flpCod: 1 },
    { filCod: 6, bncCod: 4, flpCod: 1 },
];

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}  ${IS_HML ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));
    await base.ensureSid();

    // ── Q1: o grid de pendentes traz barras? ────────────────────────────────
    log('\n── Q1: titEspCodbar no grid de PENDENTES (fin015) ──');
    const q1: Row[] = [];
    let exemploPendenteComBarras = false;
    for (const { filCod, bncCod, flpCod } of LOTES) {
        try {
            const page = await base.listGenericPaginated<Row>(
                `fin015/finItemSispag/titulosPendentes/list/${filCod}/${bncCod}/${flpCod}`,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 500,
                },
                { filCod },
            );
            const rows = page.rows ?? [];
            const comBarras = rows.filter((r) => cheio(r.titEspCodbar));
            const comAssoc = rows.filter((r) => Number(r.titVldReflexoDdaAssoc ?? 0) === 1);
            log(
                `fil=${filCod} flp=${flpCod}: ${page.count} pendentes no ERP, ${rows.length} lidos → comBarras=${comBarras.length} (${rows.length ? Math.round((comBarras.length / rows.length) * 100) : 0}%)  ddaAssoc=${comAssoc.length}`,
            );
            q1.push({
                filCod,
                flpCod,
                totalErp: page.count,
                lidos: rows.length,
                comBarras: comBarras.length,
                ddaAssoc: comAssoc.length,
            });
            if (comBarras.length > 0 && !exemploPendenteComBarras) {
                save('exemplo-pendente-com-barras.json', comBarras[0]);
                exemploPendenteComBarras = true;
            }
            if (rows.length > 0 && !cheio(rows[0].titEspCodbar))
                save(`exemplo-pendente-sem-barras-fil${filCod}.json`, rows[0]);
        } catch (err) {
            log(
                `fil=${filCod} flp=${flpCod}: FALHOU — ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
    save('q1-pendentes-barras.json', q1);

    // ── Q2: modalidade 6 vs 7 — é o banco emissor? ──────────────────────────
    log('\n── Q2: modalidade 6 × 7 vs banco emissor do barcode ──');
    const cruzamento: Row[] = [];
    for (const { filCod, bncCod, flpCod } of LOTES) {
        try {
            const page = await base.listGenericPaginated<Row>(
                `fin015/finItemSispag/list/${filCod}/${bncCod}/${flpCod}`,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 500,
                },
                { filCod },
            );
            for (const it of page.rows ?? []) {
                const barras = String(it.itsNumCodbar ?? '');
                if (!barras) continue;
                cruzamento.push({
                    filCod,
                    flpCod,
                    modalidade: Number(it.itsVldModalidade ?? -1),
                    bancoEmissor: barras.slice(0, 3),
                    itsNumBanco: it.itsNumBanco,
                    tamanho: barras.length,
                    vinculoDda: Number(it.vldVinculoDda ?? 0),
                    tributo: Number(it.itsVldTributo ?? 0),
                });
            }
        } catch {
            /* já reportado no Q1 */
        }
    }
    save('q2-modalidade-x-banco.json', cruzamento);

    const porMod = new Map<string, number>();
    for (const c of cruzamento) {
        const k = `mod=${c.modalidade} banco=${c.bancoEmissor} len=${c.tamanho} tributo=${c.tributo}`;
        porMod.set(k, (porMod.get(k) ?? 0) + 1);
    }
    console.log('='.repeat(78));
    console.table([...porMod.entries()].map(([chave, itens]) => ({ chave, itens })));
    console.table(q1);
    console.log('='.repeat(78));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

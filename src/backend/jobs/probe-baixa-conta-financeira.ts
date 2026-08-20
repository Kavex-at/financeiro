import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY — a baixa originada de RETORNO SISPAG carrega conta financeira?
 *
 * CONTEXTO: em HML, os dois borderôs gerados pelo `processar` do fin052 (248 e 249) vieram
 * com `gerNum`/`gerDes` NULOS, enquanto borderôs normais da mesma filial trazem `gerNum=38`.
 * Testado com conta pagadora quebrada E com a correta — mesmo resultado. Antes de reportar
 * como defeito do ERP, três verificações:
 *
 *   1. PRODUÇÃO — lotes fin015 com retorno processado (`itensRetorno > 0`) → itens → `borCod`
 *      → `fin010` → o borderô tem `gerNum`? Se em PRD tiver, o problema é do HML.
 *   2. PARÂMETROS por filial (`ger008`/`ger010`) — existe "conta financeira padrão de baixa"
 *      que ninguém configurou no HML?
 *   3. TIPO DE PROCESSAMENTO do fin052 — o PL/SQL usa o bind `:TIPO` e a tela tem esse
 *      filtro. Quais valores existem? (lido do `configList` da resposta do grid.)
 *
 * SEGURANÇA: exclusivamente `list`/`GET`. Nenhuma escrita.
 *
 * Run:
 *   cd src/backend
 *   PROBE_PRD=1 npx tsx jobs/probe-baixa-conta-financeira.ts          # produção, read-only
 *   CONEXOS_BASE_URL=...-hml... npx tsx jobs/probe-baixa-conta-financeira.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Read-only em PRD: passe PROBE_PRD=1.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/baixa-conta-financeira';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);

type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[baixa-cf] ${s}`);
const corpo = (e: unknown): string =>
    JSON.stringify(
        (e as { response?: { data?: unknown } })?.response?.data ??
            (e instanceof Error ? e.message : String(e)),
    ).slice(0, 200);

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE} ${IS_HML ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));
    await base.ensureSid();

    // ══ CHECK 1 — lotes com retorno processado → borderô → gerNum ═══════════
    console.log('\n### CHECK 1 — baixa de retorno SISPAG carrega conta financeira?\n');
    const achados: Row[] = [];
    for (const filCod of FILIAIS) {
        let lotes: Row[] = [];
        try {
            const r = await base.listGenericPaginated<Row>(
                'fin015/list',
                { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 100 },
                { filCod },
            );
            lotes = r.rows;
        } catch (e) {
            log(`fin015 fil=${filCod}: ${corpo(e)}`);
            continue;
        }
        const comRetorno = lotes.filter((l) => Number(l.itensRetorno) > 0);
        log(`fil ${filCod}: ${lotes.length} lote(s), ${comRetorno.length} com retorno processado`);

        for (const l of comRetorno.slice(0, 6)) {
            const bnc = Number(l.bncCod);
            const flp = Number(l.flpCod);
            try {
                const { rows: itens } = await base.listGenericPaginated<Row>(
                    `fin015/finItemSispag/list/${filCod}/${bnc}/${flp}`,
                    { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 50 },
                    { filCod },
                );
                const comBor = itens.filter((i) => i.borCod != null);
                log(
                    `  flp ${flp}: ${itens.length} item(ns), ${comBor.length} com borCod · itensRetorno=${l.itensRetorno}`,
                );
                for (const it of comBor.slice(0, 4)) {
                    const borCod = Number(it.borCod);
                    const tipo = Number(it.borVldTipo ?? 2);
                    const { rows: bors } = await base.listGenericPaginated<Row>(
                        'fin010/list',
                        {
                            fieldList: [],
                            filterList: { 'borVldTipo#EQ': tipo, 'borCod#EQ': borCod },
                            serviceName: 'fin010',
                            pageNumber: 1,
                            pageSize: 10,
                        },
                        { filCod },
                    );
                    const b = bors.find((x) => Number(x.borCod) === borCod);
                    const linha = {
                        filCod,
                        flpCod: flp,
                        borCod,
                        gerNum: b?.gerNum ?? null,
                        gerDes: b?.gerDes ?? null,
                        finalizado: b?.borVldFinalizado,
                    };
                    achados.push(linha);
                    console.log(
                        `     borderô ${borCod} → gerNum=${JSON.stringify(linha.gerNum)} ${linha.gerDes ? `"${linha.gerDes}"` : ''}`,
                    );
                }
            } catch (e) {
                log(`  flp ${flp}: ${corpo(e)}`);
            }
        }
    }
    writeFileSync(`${OUT}/10-borderos-de-retorno.json`, JSON.stringify(achados, null, 2));
    const comCf = achados.filter((a) => a.gerNum != null).length;
    console.log(
        `\n  VEREDITO CHECK 1: ${achados.length} borderô(s) de retorno inspecionado(s), ${comCf} com conta financeira.`,
    );

    // ══ CHECK 2 — parâmetros de filial: conta financeira padrão de baixa ════
    console.log('\n### CHECK 2 — parâmetro de conta financeira padrão\n');
    for (const svc of ['ger008', 'ger010']) {
        for (const filCod of FILIAIS.slice(0, 2)) {
            try {
                const { rows } = await base.listGenericPaginated<Row>(
                    `${svc}/list`,
                    { fieldList: [], filterList: {}, serviceName: svc, pageNumber: 1, pageSize: 5 },
                    { filCod },
                );
                if (rows.length === 0) continue;
                const campos = Object.entries(rows[0]).filter(([k]) => /ger(Num|Cod|Des)|conta|cco/i.test(k));
                console.log(`  ${svc} fil ${filCod}: ${campos.length} campo(s) de conta`);
                for (const [k, v] of campos) console.log(`     ${k.padEnd(28)} = ${JSON.stringify(v)}`);
                writeFileSync(`${OUT}/20-${svc}-fil${filCod}.json`, JSON.stringify(rows[0], null, 2));
                break;
            } catch (e) {
                log(`  ${svc} fil ${filCod}: ${corpo(e)}`);
            }
        }
    }

    // ══ CHECK 3 — enum "Tipo de Processamento" do fin052 ════════════════════
    console.log('\n### CHECK 3 — valores de "Tipo de Processamento" (fin052)\n');
    try {
        const raw = await base.postGeneric<Row>(
            'fin052/arquivosRetorno/list',
            {
                fieldList: [],
                filterList: { 'bncCod#EQ': 4, 'gtbCodSeq#EQ': 1 },
                serviceName: 'fin052',
                pageNumber: 1,
                pageSize: 1,
            },
            { filCod: FILIAIS[0] },
        );
        const cfg = (raw?.configList ?? []) as Array<Row>;
        writeFileSync(`${OUT}/30-fin052-configlist.json`, JSON.stringify(cfg, null, 2));
        const comOpcoes = cfg.filter((c) => Array.isArray(c.optionList) && (c.optionList as []).length);
        console.log(`  ${cfg.length} coluna(s) no configList, ${comOpcoes.length} com enum:`);
        for (const c of comOpcoes) {
            const ops = (c.optionList as Array<Row>).map((o) => `${o.value}=${o.description}`).join(' · ');
            console.log(`     ${String(c.name).padEnd(22)} ${ops}`);
        }
    } catch (e) {
        log(`  fin052 configList: ${corpo(e)}`);
    }

    console.log(`\nartefatos em ${OUT}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[baixa-cf] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

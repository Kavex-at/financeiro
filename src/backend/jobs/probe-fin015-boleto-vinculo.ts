import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY — como o BOLETO entra no lote nativo do `fin015`?
 *
 * CONTEXTO: `probe-fin124-dda.ts` mediu que o `FinDdaItem` tem 100% de `ditEspCodbar`
 * mas **0%** de `docCod`/`titCod` — o ERP NÃO guarda o vínculo boleto↔título na tela
 * do DDA. Ao mesmo tempo o `TituloPendenteDTO` tem `titVldReflexoDdaAssoc` e o
 * `FinItemSispag` tem `vldVinculoDda` + `itsNumCodbar`.
 *
 * HIPÓTESE: o vínculo é feito NO IMPORT do lote (fin015), não no fin124. O ERP casaria
 * o DDA com o título quando o item é importado, gravando `itsNumCodbar` + `vldVinculoDda=1`.
 *
 * MÉTODO: ler os itens dos lotes nativos REAIS (montados à mão pela analista) e medir,
 * por item: `itsVldModalidade` (7 = boleto), `itsNumCodbar` (barras gravada) e
 * `vldVinculoDda`. Se os itens boleto reais têm barras, a hipótese se confirma e o
 * conserto é uma flag no import — não um matching nosso.
 *
 * SEGURANÇA: só `fin015/list` e `fin015/finItemSispag/list/{fil}/{bnc}/{flp}` (leitura).
 * Nenhuma escrita.
 *
 * Run:
 *   cd src/backend
 *   PROBE_PRD=1 npx tsx jobs/probe-fin015-boleto-vinculo.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/fin015-boleto-probe';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
/** bncCod INTERNO do Conexos a varrer (não FEBRABAN). */
const BNCS = (process.env.PROBE_BNCS ?? '1,2,3,4,5,6')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
const MAX_LOTES = Number(process.env.MAX_LOTES ?? 6);

type Row = Record<string, unknown>;
const preenchido = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const log = (s: string): void => console.log(`[fin015-boleto] ${s}`);
const save = (n: string, d: unknown): void => {
    writeFileSync(`${OUT}/${n}`, JSON.stringify(d, null, 2));
    log(`  ↳ salvo ${OUT}/${n}`);
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}  ${IS_HML ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));
    await base.ensureSid();

    const porModalidade = new Map<
        number,
        { total: number; comBarras: number; comVinculoDda: number }
    >();
    const amostras: Row[] = [];
    let exemploBoletoSalvo = false;

    for (const filCod of FILIAIS) {
        for (const bncCod of BNCS) {
            let lotes: Row[] = [];
            try {
                const page = await base.listGenericPaginated<Row>(
                    'fin015/list',
                    {
                        fieldList: [],
                        filterList: { 'bncCod#EQ': bncCod, 'filCod#EQ': filCod },
                        serviceName: 'fin015',
                        pageNumber: 1,
                        pageSize: 500,
                    },
                    { filCod },
                );
                lotes = page.rows ?? [];
            } catch {
                continue;
            }
            const comItens = lotes
                .filter((l) => Number(l.titulosCount ?? 0) > 0)
                .sort((a, b) => Number(b.flpCod ?? 0) - Number(a.flpCod ?? 0))
                .slice(0, MAX_LOTES);
            if (comItens.length === 0) continue;
            log(
                `fil=${filCod} bnc=${bncCod}: ${lotes.length} lotes, ${comItens.length} com itens (amostrados)`,
            );

            for (const lote of comItens) {
                const flpCod = Number(lote.flpCod);
                let itens: Row[] = [];
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
                    itens = page.rows ?? [];
                } catch (err) {
                    log(
                        `  flp=${flpCod}: itens FALHOU — ${err instanceof Error ? err.message : String(err)}`,
                    );
                    continue;
                }
                for (const it of itens) {
                    const mod = Number(it.itsVldModalidade ?? -1);
                    const acc = porModalidade.get(mod) ?? {
                        total: 0,
                        comBarras: 0,
                        comVinculoDda: 0,
                    };
                    acc.total += 1;
                    if (preenchido(it.itsNumCodbar)) acc.comBarras += 1;
                    if (Number(it.vldVinculoDda ?? 0) === 1) acc.comVinculoDda += 1;
                    porModalidade.set(mod, acc);

                    if (preenchido(it.itsNumCodbar) && !exemploBoletoSalvo) {
                        save('exemplo-item-boleto.json', it);
                        exemploBoletoSalvo = true;
                    }
                }
                const comBarrasNoLote = itens.filter((i) => preenchido(i.itsNumCodbar)).length;
                log(
                    `  flp=${flpCod} status=${lote.flpVldStatus} itens=${itens.length} comBarras=${comBarrasNoLote} modalidades=${JSON.stringify([...new Set(itens.map((i) => i.itsVldModalidade))])}`,
                );
                amostras.push({
                    filCod,
                    bncCod,
                    flpCod,
                    status: lote.flpVldStatus,
                    itens: itens.length,
                    comBarras: comBarrasNoLote,
                    comVinculoDda: itens.filter((i) => Number(i.vldVinculoDda ?? 0) === 1).length,
                });
            }
        }
    }

    const tabela = [...porModalidade.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([modalidade, v]) => ({
            modalidade,
            rotulo:
                modalidade === 7
                    ? 'BOLETO'
                    : modalidade === 1
                      ? 'CRED.CONTA/TED'
                      : String(modalidade),
            itens: v.total,
            comBarras: v.comBarras,
            pctComBarras: v.total ? Math.round((v.comBarras / v.total) * 100) : 0,
            comVinculoDda: v.comVinculoDda,
        }));
    save('por-modalidade.json', tabela);
    save('lotes-amostrados.json', amostras);
    console.log('='.repeat(78));
    console.table(tabela);
    console.log('='.repeat(78));
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

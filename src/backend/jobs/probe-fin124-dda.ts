import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';

/**
 * SONDA READ-ONLY — o CÓDIGO DE BARRAS do boleto mora no `fin124` (Importação de Arquivo DDA)?
 *
 * CONTEXTO: `ConexosSispagClient.mapTitulo` deriva `temBoleto` de `fin064.titEspCodbar`, e o
 * `RemessaService` manda `titEspCodbar` no import do `fin015`. Mas `probe-fin064-destino.ts`
 * mediu **0 de 2000** títulos com `titEspCodbar` em PRD — a auto-detecção de boleto nunca
 * dispara, e o import sai com barras VAZIA (`RemessaService.ts` `titEspCodbar: … ?? ''`).
 *
 * HIPÓTESE: o barcode chega pelo arquivo DDA (fin124). O `FinDdaItem` do catálogo OpenAPI
 * traz `ditEspCodbar` (barras) + `filCod`/`docCod`/`titCod` (o vínculo com o título) +
 * `bncCod`/`flpCod`. Se `docCod`/`titCod` vierem preenchidos, o vínculo pagamento↔boleto
 * já existe no ERP e basta lermos.
 *
 * O QUE MEDE:
 *   1. quantos arquivos DDA existem e quantos estão ATIVOS (`ddcVldStatus`);
 *   2. taxa de preenchimento de `docCod`/`titCod` nos itens (= vínculo automático ou manual?);
 *   3. taxa de preenchimento de `ditEspCodbar`;
 *   4. quantos itens DDA casam com a carteira `fin064` que já lemos (interseção real);
 *   5. divergência de valor/vencimento entre o boleto e o título (decide o autoritativo);
 *   6. shape cru de 1 item (campos que o catálogo não documenta).
 *
 * SEGURANÇA: chama EXCLUSIVAMENTE `POST /fin124/list` e `POST /fin124/itens/list/{ddcCod}`
 * (protocolo de query do Conexos = leitura). Nenhum `importar`, nenhum `cancelar`, nenhum
 * PUT/DELETE. Um guard em `assertSomenteList` recusa qualquer path que não termine em `/list`.
 *
 * Run:
 *   cd src/backend
 *   PROBE_PRD=1 tsx jobs/probe-fin124-dda.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(
        `RECUSADO: base não é HML (${BASE}). Esta sonda é read-only; para rodar em PRD passe PROBE_PRD=1.`,
    );
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/fin124-dda-probe';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
const PAGE = Number(process.env.PAGE_SIZE ?? 500);
/** Quantos arquivos DDA (mais recentes) abrir por filial. */
const MAX_ARQUIVOS = Number(process.env.MAX_ARQUIVOS ?? 3);

type Row = Record<string, unknown>;

const preenchido = (v: unknown): boolean => v !== null && v !== undefined && v !== '';
const log = (s: string): void => console.log(`[fin124] ${s}`);
const save = (name: string, data: unknown): void => {
    writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2));
    log(`  ↳ salvo ${OUT}/${name}`);
};

/** Guard duro: esta sonda só fala com endpoints de LEITURA. */
const assertSomenteList = (endpoint: string): string => {
    if (!endpoint.endsWith('/list') && !endpoint.includes('/list/')) {
        throw new Error(`RECUSADO: sonda read-only tentou chamar '${endpoint}'`);
    }
    return endpoint;
};

const body = (serviceName: string, filterList: Row = {}): Row => ({
    fieldList: [],
    filterList,
    serviceName,
    pageNumber: 1,
    pageSize: PAGE,
});

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}  ${IS_HML ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));

    await base.ensureSid();
    log('login OK\n');

    const resumoFiliais: Row[] = [];
    let shapeSalvo = false;
    const divergencias: Row[] = [];

    for (const filCod of FILIAIS) {
        log(`── filial ${filCod} ──────────────────────────────────────`);

        // 1) arquivos DDA importados
        let arquivos: Row[] = [];
        try {
            const res = await base.listGenericPaginated<Row>(
                assertSomenteList('fin124/list'),
                body('fin124'),
                { filCod },
            );
            arquivos = res.rows;
            log(`arquivos DDA: ${res.count} no ERP, ${arquivos.length} lidos`);
        } catch (err) {
            log(`arquivos DDA: FALHOU — ${err instanceof Error ? err.message : String(err)}`);
            resumoFiliais.push({ filCod, erro: 'fin124/list falhou' });
            continue;
        }
        if (arquivos.length === 0) {
            resumoFiliais.push({ filCod, arquivos: 0, itens: 0 });
            log('nenhum arquivo DDA nesta filial\n');
            continue;
        }
        if (!shapeSalvo) save('shape-arquivo-dda.json', arquivos[0]);

        const ativos = arquivos.filter((a) => Number(a.ddcVldStatus) === 1);
        log(
            `  status: ${ativos.length} com ddcVldStatus=1; distintos: ${JSON.stringify([...new Set(arquivos.map((a) => a.ddcVldStatus))])}`,
        );

        // 2) itens dos N arquivos mais recentes (ddcCod desc)
        const escolhidos = [...arquivos]
            .sort((a, b) => Number(b.ddcCod ?? 0) - Number(a.ddcCod ?? 0))
            .slice(0, MAX_ARQUIVOS);

        const itens: Row[] = [];
        for (const arq of escolhidos) {
            const ddcCod = arq.ddcCod;
            try {
                const res = await base.listGenericPaginated<Row>(
                    assertSomenteList(`fin124/itens/list/${ddcCod}`),
                    body('fin124'),
                    { filCod },
                );
                log(
                    `  arquivo ${ddcCod} (${String(arq.ddcEspFilename ?? '—')}): ${res.count} itens, ${res.rows.length} lidos`,
                );
                itens.push(...res.rows);
            } catch (err) {
                log(
                    `  arquivo ${ddcCod}: itens FALHOU — ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
        if (itens.length === 0) {
            resumoFiliais.push({ filCod, arquivos: arquivos.length, itens: 0 });
            continue;
        }
        if (!shapeSalvo) {
            save('shape-item-dda.json', itens[0]);
            save(
                'shape-item-dda-com-vinculo.json',
                itens.find((i) => preenchido(i.docCod)) ?? null,
            );
            shapeSalvo = true;
        }

        // 3) taxas de preenchimento
        const comBarras = itens.filter((i) => preenchido(i.ditEspCodbar));
        const comDoc = itens.filter((i) => preenchido(i.docCod));
        const comTit = itens.filter((i) => preenchido(i.titCod));
        const comLote = itens.filter((i) => preenchido(i.flpCod));
        const pct = (n: number): number => Math.round((n / itens.length) * 100);

        log(
            `  itens=${itens.length}  barras=${comBarras.length} (${pct(comBarras.length)}%)  docCod=${comDoc.length} (${pct(comDoc.length)}%)  titCod=${comTit.length} (${pct(comTit.length)}%)  flpCod=${comLote.length} (${pct(comLote.length)}%)`,
        );

        // 4) interseção com a carteira que já lemos (fin064)
        let naCarteira = 0;
        let semVinculoMasCasaValor = 0;
        try {
            const titulos = await sispag.listTitulosAPagar(filCod, {});
            const porChave = new Map(titulos.map((t) => [`${t.docCod}:${t.titCod}`, t]));
            log(`  carteira fin064 (janela aberta): ${titulos.length} títulos`);

            for (const it of comDoc) {
                const chave = `${String(it.docCod)}:${String(it.titCod ?? '1')}`;
                const t = porChave.get(chave);
                if (!t) continue;
                naCarteira += 1;
                // 5) divergência boleto × título (decide o valor autoritativo)
                const vlrDda = Number(it.ditMnyValor ?? 0);
                const vlrTit = Number(t.valor ?? 0);
                const vcDda = Number(it.ditDtaVencimento ?? 0);
                const vcTit = Number(t.vencimento ?? 0);
                if (Math.abs(vlrDda - vlrTit) > 0.005 || vcDda !== vcTit) {
                    divergencias.push({
                        filCod,
                        docCod: it.docCod,
                        titCod: it.titCod,
                        valorBoleto: vlrDda,
                        valorTitulo: vlrTit,
                        deltaValor: Number((vlrDda - vlrTit).toFixed(2)),
                        vencBoleto: vcDda ? new Date(vcDda).toISOString().slice(0, 10) : null,
                        vencTitulo: vcTit ? new Date(vcTit).toISOString().slice(0, 10) : null,
                    });
                }
            }
            // Itens SEM vínculo: dá para casar por valor+vencimento? (mede se um matching
            // nosso seria viável caso o ERP não associe sozinho.)
            const semVinculo = itens.filter((i) => !preenchido(i.docCod));
            for (const it of semVinculo) {
                const vlr = Number(it.ditMnyValor ?? 0);
                const vc = Number(it.ditDtaVencimento ?? 0);
                const candidatos = titulos.filter(
                    (t) =>
                        Math.abs(Number(t.valor ?? 0) - vlr) < 0.005 &&
                        Number(t.vencimento ?? 0) === vc,
                );
                if (candidatos.length === 1) semVinculoMasCasaValor += 1;
            }
            log(
                `  vínculo: ${naCarteira}/${comDoc.length} itens com docCod estão na carteira lida`,
            );
            log(
                `  sem vínculo: ${semVinculo.length}; destes, ${semVinculoMasCasaValor} casariam por valor+vencimento de forma ÚNICA`,
            );
        } catch (err) {
            log(`  carteira fin064: FALHOU — ${err instanceof Error ? err.message : String(err)}`);
        }

        resumoFiliais.push({
            filCod,
            arquivos: arquivos.length,
            arquivosAtivos: ativos.length,
            itensLidos: itens.length,
            comBarras: comBarras.length,
            comDocCod: comDoc.length,
            comTitCod: comTit.length,
            comFlpCod: comLote.length,
            naCarteira,
            semVinculoMasCasaValor,
        });
        console.log('');
    }

    save('resumo-filiais.json', resumoFiliais);
    save('divergencias-boleto-x-titulo.json', divergencias);

    console.log('='.repeat(78));
    console.table(resumoFiliais);
    console.log(`divergências de valor/vencimento (boleto × título): ${divergencias.length}`);
    if (divergencias.length > 0) console.table(divergencias.slice(0, 10));
    console.log('='.repeat(78));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

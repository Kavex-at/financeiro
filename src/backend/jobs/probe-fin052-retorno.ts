import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * SONDA READ-ONLY — perna de RETORNO do SISPAG (`fin052`) e a ponte com a BAIXA.
 *
 * OBJETIVO: descobrir como LER um retorno já processado, que é o que a conciliação
 * precisa. Três frentes que a exploração de 2026-07-11 deixou em aberto:
 *
 *   (a) `arquivosRetornoDetalhe/list` deu `REQUIRED_FILTER_ERROR` e ninguém descobriu
 *       QUAL filtro falta. Aqui a sonda imprime o CORPO do erro verbatim — foi assim
 *       que o `SELECTION_ERROR` do fin015 entregou os 4 campos que faltavam.
 *   (b) `GET arquivosRetornoDetalhe/{bnc}/{gtb}/{gar}/{ard}/{flp}/{its}` — leitura por
 *       CHAVE, que contorna o filtro do list. Nunca tentada.
 *   (c) `fin015/finItemSispag/finItemSispagRet[Cab]/list/...` — o retorno visto pelo
 *       lado do LOTE, onde já temos `flpCod`. Nunca tentado.
 *
 * Também captura o `gtbLngSql` do `ger015`: o SCRIPT DE PARSE do layout de retorno.
 * Ele descreve o formato exato de `.RET` que o ERP espera — insumo para sintetizar um
 * arquivo de teste enquanto a Columbia não fornece um retorno real.
 *
 * SEGURANÇA: só `list`/`GET`. Nenhum `carregar`, `processar` ou `liberar`.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api npx tsx jobs/probe-fin052-retorno.ts
 *   PROBE_PRD=1 npx tsx jobs/probe-fin052-retorno.ts   # PRD, read-only
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Read-only em PRD: passe PROBE_PRD=1.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/fin052-retorno';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);

type Row = Record<string, unknown>;

const log = (s: string, v?: unknown): void =>
    console.log(`[fin052] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 500) : '');

const save = (name: string, data: unknown): void => {
    writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2));
    console.log(`[fin052]   ↳ ${OUT}/${name}`);
};

/** Corpo bruto do erro do Conexos — é onde o ERP diz o que falta. */
const corpoDoErro = (e: unknown): unknown =>
    (e as { response?: { data?: unknown } })?.response?.data ??
    (e instanceof Error ? e.message : String(e));

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE} ${IS_HML ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));
    await base.ensureSid();
    log('login OK\n');

    // ── 1) ger015 — configs de layout de retorno + o SCRIPT DE PARSE ─────────
    const configs: Row[] = [];
    for (const filCod of FILIAIS) {
        try {
            const { rows } = await base.listGenericPaginated<Row>(
                'ger015/list',
                { fieldList: [], filterList: {}, serviceName: 'ger015', pageNumber: 1, pageSize: 50 },
                { filCod },
            );
            for (const c of rows) {
                if (!configs.some((x) => x.bncCod === c.bncCod && x.gtbCodSeq === c.gtbCodSeq)) {
                    configs.push({ ...c, filCod });
                }
            }
        } catch (e) {
            log(`ger015 fil=${filCod} ERRO:`, corpoDoErro(e));
        }
    }
    log(`1) ger015 → ${configs.length} config(s) de layout`);
    for (const c of configs) {
        const sql = c.gtbLngSql;
        console.log(
            `   bnc=${c.bncCod} gtb=${c.gtbCodSeq} · ${c.gtbDesNome} · ${c.bncDesNome ?? ''} · parse=${typeof sql === 'string' ? `${sql.length} chars` : 'ausente'}`,
        );
        if (typeof sql === 'string' && sql.length > 0) {
            writeFileSync(`${OUT}/parse-bnc${c.bncCod}-gtb${c.gtbCodSeq}.sql`, sql);
        }
    }
    save('10-configs-ger015.json', configs);

    // ── 2) arquivosRetorno/list — exige bncCod E gtbCodSeq ───────────────────
    const arquivos: Row[] = [];
    for (const filCod of FILIAIS) {
        for (const c of configs) {
            try {
                const { rows } = await base.listGenericPaginated<Row>(
                    'fin052/arquivosRetorno/list',
                    {
                        fieldList: [],
                        filterList: { 'bncCod#EQ': c.bncCod, 'gtbCodSeq#EQ': c.gtbCodSeq },
                        serviceName: 'fin052',
                        pageNumber: 1,
                        pageSize: 50,
                    },
                    { filCod },
                );
                for (const a of rows) arquivos.push({ ...a, filCodConsulta: filCod });
            } catch (e) {
                log(`arquivosRetorno fil=${filCod} bnc=${c.bncCod} ERRO:`, corpoDoErro(e));
            }
        }
    }
    log(`\n2) arquivosRetorno → ${arquivos.length} arquivo(s)`);
    for (const a of arquivos) {
        console.log(
            `   fil=${a.filCod} bnc=${a.bncCod} gtb=${a.gtbCodSeq} gar=${a.garCodSeq} · ${a.garEspArquivo} · status=${a.garVldStatus}/${a.garVldProcStatus} · rejeitados=${a.titulosRejeitados} erros=${a.erro}`,
        );
    }
    save('20-arquivos-retorno.json', arquivos);
    if (arquivos.length === 0) {
        log('nenhum arquivo de retorno — o resto da sonda depende de um. Fim.');
        return;
    }

    // Alvo: por default o 1º; `ALVO_BNC`/`ALVO_GAR` escolhem outro (ex.: os .RET reais
    // do Bradesco, bnc 7). Dedup porque o list repete o arquivo por filial consultada.
    const alvo =
        arquivos.find(
            (a) =>
                (!process.env.ALVO_BNC || Number(a.bncCod) === Number(process.env.ALVO_BNC)) &&
                (!process.env.ALVO_GAR || Number(a.garCodSeq) === Number(process.env.ALVO_GAR)),
        ) ?? arquivos[0];
    const fil = Number(alvo.filCod ?? alvo.filCodConsulta);
    const bnc = Number(alvo.bncCod);
    const gtb = Number(alvo.gtbCodSeq);
    const gar = Number(alvo.garCodSeq);
    console.log(`\n── alvo: fil=${fil} bnc=${bnc} gtb=${gtb} gar=${gar} (${alvo.garEspArquivo})\n`);

    // ── 3) cabeçalho + log do arquivo ────────────────────────────────────────
    for (const [nome, path] of [
        ['header', `fin052/arquivosRetorno/${bnc}/${gtb}/${gar}`],
        ['log', `fin052/arquivosRetorno/log/${bnc}/${gtb}/${gar}`],
    ] as const) {
        try {
            const r = await base.getGeneric<unknown>(path, { filCod: fil });
            log(`3) GET ${nome} OK`);
            save(`30-${nome}.json`, r);
        } catch (e) {
            log(`3) GET ${nome} ERRO:`, corpoDoErro(e));
        }
    }

    // ── 4) O DETALHE — a ponte com a baixa fin010 (bxaCodSeq) ────────────────
    // (a) o list, variando os filtros; imprime o corpo do erro para descobrir o exigido.
    const tentativas: Array<{ nome: string; filtro: Row }> = [
        { nome: 'chave completa', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar } },
        { nome: '+ filCod', filtro: { 'filCod#EQ': fil, 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar } },
        { nome: 'só bnc+gtb', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb } },
        { nome: 'chave + flpCod=0', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar, 'flpCod#EQ': 0 } },
        { nome: 'sem filtro', filtro: {} },
        // O ERP exige `fbeEspCod` como FILTRO, mas talvez aceite um operador abrangente
        // em vez de um código exato — o que evita varrer os 153 códigos do banco.
        { nome: 'fbeEspCod#LIKE %', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar, 'fbeEspCod#LIKE': '%' } },
        { nome: 'fbeEspCod#NEQ ZZZ', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar, 'fbeEspCod#NEQ': 'ZZZ' } },
        { nome: 'fbeEspCod#NE ZZZ', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar, 'fbeEspCod#NE': 'ZZZ' } },
        { nome: 'fbeEspCod#GE 0', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar, 'fbeEspCod#GE': '0' } },
        { nome: 'fbeEspCod#EQ vazio', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar, 'fbeEspCod#EQ': '' } },
        { nome: 'fbeEspCod#IS_NOT_NULL', filtro: { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar, 'fbeEspCod#IS_NOT_NULL': true } },
    ];
    console.log('4) arquivosRetornoDetalhe/list — caçando o filtro exigido:');
    for (const t of tentativas) {
        try {
            const { rows, count } = await base.listGenericPaginated<Row>(
                'fin052/arquivosRetornoDetalhe/list',
                { fieldList: [], filterList: t.filtro, serviceName: 'fin052', pageNumber: 1, pageSize: 50 },
                { filCod: fil },
            );
            log(`   ✅ "${t.nome}" → count=${count} rows=${rows.length}`);
            if (rows.length > 0) {
                save('40-detalhe.json', rows);
                console.log('      campos:', Object.keys(rows[0]).sort().join(', '));
                for (const d of rows.slice(0, 5)) {
                    console.log(
                        `      doc=${d.docCod}/${d.titCod} evento=${d.fbeEspCod} "${d.fbeEspDescricao}" borCod=${d.borCod} bxaCodSeq=${d.bxaCodSeq} valor=${d.itsMnyVlrPgto}`,
                    );
                }
            }
            break;
        } catch (e) {
            log(`   ❌ "${t.nome}":`, corpoDoErro(e));
        }
    }

    // ── 4b) O FILTRO QUE FALTAVA: `fbeEspCod` (código do EVENTO BANCÁRIO) ────
    // O ERP nomeou o filtro exigido: `REQUIRED_FILTER_ERROR` → "O filtro 'fbeEspCod'
    // não foi encontrado". Os códigos válidos por banco vivem em `FinBancosErros`
    // (`fin050`/`fin056`, chave `bncCod + fbeEspCod + fbeVldTipo`). Sem um código
    // válido, o detalhe — que é a PONTE com a baixa (`bxaCodSeq`) — é inacessível.
    const eventos: Row[] = [];
    for (const svc of ['fin050', 'fin056']) {
        try {
            const { rows, count } = await base.listGenericPaginated<Row>(
                `${svc}/list`,
                {
                    fieldList: [],
                    filterList: { 'bncCod#EQ': bnc },
                    serviceName: svc,
                    pageNumber: 1,
                    pageSize: 300,
                },
                { filCod: fil },
            );
            log(`4b) ${svc}/list (bnc ${bnc}) → count=${count}`);
            if (rows.length > 0) {
                save(`45-eventos-${svc}-bnc${bnc}.json`, rows);
                for (const r of rows) eventos.push(r);
                break;
            }
        } catch (e) {
            log(`4b) ${svc}/list ERRO:`, corpoDoErro(e));
        }
    }

    const codigos = [...new Set(eventos.map((e) => e.fbeEspCod).filter((c) => c != null))];
    log(`4b) ${codigos.length} código(s) de evento bancário para o banco ${bnc}`);
    if (eventos[0]) {
        console.log('    exemplos:');
        for (const e of eventos.slice(0, 8)) {
            console.log(`      ${String(e.fbeEspCod).padEnd(6)} tipo=${e.fbeVldTipo} · ${e.fbeEspDescricao}`);
        }
    }

    // O erro diz "não foi encontrado, OU SEU TIPO DE FILTRO NÃO É O ESPECIFICADO".
    // `#NE`/`#IS_NOT_NULL` foram recusados como operadores inválidos, mas `#EQ`/`#LIKE`
    // não — logo o operador exigido para `fbeEspCod` é outro. Numa coluna de grid com
    // multi-seleção, o natural é `#IN` (lista). Tenta com TODOS os códigos de uma vez.
    const detalhes: Row[] = [];
    for (const [nome, filtroCod] of [
        ['#IN (todos os códigos)', { 'fbeEspCod#IN': codigos }],
        ['#IN (string separada por vírgula)', { 'fbeEspCod#IN': codigos.join(',') }],
    ] as const) {
        try {
            const { rows, count } = await base.listGenericPaginated<Row>(
                'fin052/arquivosRetornoDetalhe/list',
                {
                    fieldList: [],
                    filterList: {
                        'bncCod#EQ': bnc,
                        'gtbCodSeq#EQ': gtb,
                        'garCodSeq#EQ': gar,
                        ...filtroCod,
                    },
                    serviceName: 'fin052',
                    pageNumber: 1,
                    pageSize: 200,
                },
                { filCod: fil },
            );
            log(`4b) ✅ "${nome}" → count=${count} rows=${rows.length}`);
            detalhes.push(...rows);
            if (rows.length > 0) break;
        } catch (e) {
            log(`4b) ❌ "${nome}":`, corpoDoErro(e));
        }
    }

    for (const cod of detalhes.length > 0 ? [] : codigos) {
        for (const tipo of [...new Set(eventos.filter((e) => e.fbeEspCod === cod).map((e) => e.fbeVldTipo))]) {
            try {
                const { rows } = await base.listGenericPaginated<Row>(
                    'fin052/arquivosRetornoDetalhe/list',
                    {
                        fieldList: [],
                        filterList: {
                            'bncCod#EQ': bnc,
                            'gtbCodSeq#EQ': gtb,
                            'garCodSeq#EQ': gar,
                            'fbeEspCod#EQ': cod,
                            'fbeVldTipo#EQ': tipo,
                        },
                        serviceName: 'fin052',
                        pageNumber: 1,
                        pageSize: 100,
                    },
                    { filCod: fil },
                );
                if (rows.length > 0) {
                    log(`4b) ✅ detalhe com fbeEspCod=${cod} tipo=${tipo} → ${rows.length} linha(s)`);
                    detalhes.push(...rows);
                }
            } catch {
                // código inválido para este arquivo — segue.
            }
        }
    }

    if (detalhes.length > 0) {
        save('46-detalhe-por-evento.json', detalhes);
        console.log(`\n  >>> DETALHE DO RETORNO — ${detalhes.length} linha(s) <<<`);
        console.log('  campos:', Object.keys(detalhes[0]).sort().join(', '));
        for (const d of detalhes.slice(0, 10)) {
            console.log(
                `    doc=${d.docCod}/${d.titCod} fil=${d.filCod} evento=${d.fbeEspCod} "${d.fbeEspDescricao}" borCod=${d.borCod} bxaCodSeq=${d.bxaCodSeq} valor=${d.itsMnyVlrPgto ?? d.valor}`,
            );
        }
    } else {
        log('4b) nenhuma linha de detalhe encontrada com os códigos testados.');
    }

    // ── 5) erros de parse + títulos rejeitados ───────────────────────────────
    for (const [nome, path] of [
        ['erros', 'fin052/arquivosRetorno/erro/list'],
        ['liberacao', `fin052/arquivosRetornoLiberacaoTitulos/list/${bnc}/${gtb}/${gar}`],
    ] as const) {
        try {
            const { rows, count } = await base.listGenericPaginated<Row>(
                path,
                {
                    fieldList: [],
                    filterList:
                        nome === 'erros'
                            ? { 'bncCod#EQ': bnc, 'gtbCodSeq#EQ': gtb, 'garCodSeq#EQ': gar }
                            : {},
                    serviceName: 'fin052',
                    pageNumber: 1,
                    pageSize: 50,
                },
                { filCod: fil },
            );
            log(`5) ${nome} → count=${count}`);
            if (rows.length > 0) save(`50-${nome}.json`, rows);
        } catch (e) {
            log(`5) ${nome} ERRO:`, corpoDoErro(e));
        }
    }

    // ── 6) O RETORNO PELO LADO DO LOTE (fin015) — caminho nunca tentado ──────
    // Se funcionar, é MELHOR que o fin052: já sabemos o flpCod dos nossos lotes.
    const flpAlvo = Number(process.env.FLP ?? 26);
    const filLote = Number(process.env.FLP_FIL ?? 1);
    const bncLote = Number(process.env.FLP_BNC ?? 4);
    console.log(`\n6) retorno pelo LADO DO LOTE (flp ${flpAlvo}, fil ${filLote}, bnc ${bncLote}):`);
    try {
        const { rows } = await base.listGenericPaginated<Row>(
            `fin015/finItemSispag/list/${filLote}/${bncLote}/${flpAlvo}`,
            { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 50 },
            { filCod: filLote },
        );
        log(`   itens do lote: ${rows.length}`);
        for (const it of rows) {
            const its = Number(it.itsCodSeq);
            try {
                const cab = await base.listGenericPaginated<Row>(
                    `fin015/finItemSispag/finItemSispagRetCab/list/${filLote}/${bncLote}/${flpAlvo}/${its}`,
                    { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 50 },
                    { filCod: filLote },
                );
                log(`   ✅ finItemSispagRetCab(its ${its}) → count=${cab.count}`);
                if (cab.rows.length > 0) {
                    save(`60-retCab-its${its}.json`, cab.rows);
                    console.log('      campos:', Object.keys(cab.rows[0]).sort().join(', '));
                }
            } catch (e) {
                log(`   ❌ finItemSispagRetCab(its ${its}):`, corpoDoErro(e));
            }
        }
    } catch (e) {
        log('   ❌ itens do lote:', corpoDoErro(e));
    }

    console.log(`\nFIM — artefatos em ${OUT}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin052] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

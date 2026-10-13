import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import type { LoteNativoEstado } from '../domain/interface/sispag/Fin015Write.js';

/**
 * SONDA READ-ONLY — o flag DDA do grid de pendentes depende do CONTEXTO em que o grid é lido?
 *
 * PERGUNTA. A ingestão lê `fin015/finItemSispag/titulosPendentes/list/{fil}/{bnc}/{flp}` num
 * contexto ARBITRÁRIO: o primeiro banco da filial que tem lote nativo, no maior `flpCod` dele
 * (`listarSinaisDosPendentes`). O flag `titVldReflexoDdaAssoc` sai desse grid. Se o ERP associa o
 * boleto DDA em relação ao banco, à conta ou à data de débito do lote, parte dos títulos
 * "boleto sem DDA" é artefato da leitura — e o casamento por valor+vencimento nem seria preciso.
 * Medido em 2026-10-13: 207 de 875 títulos BOLETO sem DDA têm um boleto livre de mesmo valor e
 * mesmo dia no pool, e o ERP não os flagou.
 *
 * HIPÓTESES (o que a sonda separa):
 *   H1 banco do lote (`bncCod`)       — o pool DDA é da conta Itaú (ag 0641 / cc 55795)
 *   H2 conta do lote (`ccoCod`)       — mesma ideia, no nível da conta
 *   H3 data de débito (`flpDtaCredito`) — associação relativa à data em que o lote paga
 *   H4 estado do lote (`flpVldStatus`) — rascunho × finalizado
 *   H0 o flag NÃO depende do contexto — então a explicação é outra (beneficiário, pagador…)
 *
 * O QUE FAZ, por filial:
 *   1. lista os bancos (contas pagadoras) e os lotes nativos de cada um (`fin015/list`);
 *   2. escolhe até MAX_CONTEXTOS contextos DIVERSOS (bancos, contas, estados e datas distintos);
 *   3. lê o grid de pendentes inteiro em cada contexto;
 *   4. compara: mesmo conjunto de títulos? mesmo flag? quais campos do `raw` mudam com o contexto?
 *   5. (opcional, PROBE_DB_URL) cruza com o Postgres: dos candidatos "mesmo valor e mesmo dia"
 *      que o ERP não flagou, quantos aparecem flagados em ALGUM contexto.
 *
 * SEGURANÇA: só `fin015/list` e `fin015/.../titulosPendentes/list/...`. Um guard recusa qualquer
 * caminho que não seja leitura. Nenhuma escrita no ERP; o Postgres só é lido, e só com
 * `PROBE_DB_URL`. Leituras SERIAIS (cap de sessões do robô, ADR-0066 §3).
 *
 * Run (de src/backend):
 *   PROBE_PRD=1 PROBE_FILIAIS=2,4,6 databaseConnectionString="" \
 *     PROBE_DB_URL="$(grep ^databaseConnectionString= .env | cut -d= -f2-)" \
 *     npx tsx jobs/probe-flag-contexto.ts
 *
 * `databaseConnectionString=""` impede que o login do robô seja persistido no banco (ver a nota
 * de contaminação de sessão); o join usa outra variável, de propósito.
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD (read-only) passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/probe-flag-contexto';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '2,4,6')
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n));
const MAX_CONTEXTOS = Number(process.env.MAX_CONTEXTOS ?? 6);

type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[flag-contexto] ${s}`);
const dia = (ms?: number): string => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

/** Guard duro: leitura apenas. */
const assertSomenteLeitura = (path: string): string => {
    if (!/\/list(\/|$)/.test(path)) throw new Error(`RECUSADO: caminho não é de leitura: ${path}`);
    return path;
};

interface Contexto {
    filCod: number;
    bncCod: number;
    flpCod: number;
    status: number;
    ccoCod?: number;
    dataDebito?: number;
    titulosCount: number;
}
interface Leitura {
    ctx: Contexto;
    chaves: string[];
    flag: Map<string, boolean>;
    raw: Map<string, Row>;
    legiveis: number;
}

/** Contextos diversos: extremos de flpCod, uma conta de cada, um de cada estado, datas distintas. */
const escolherContextos = (lotes: Contexto[], max: number): Contexto[] => {
    const por = (f: (a: Contexto, b: Contexto) => number) => [...lotes].sort(f)[0];
    const candidatos: Array<Contexto | undefined> = [
        por((a, b) => b.flpCod - a.flpCod), // o que a ingestão usa hoje (por banco)
        por((a, b) => a.flpCod - b.flpCod),
        por((a, b) => (b.dataDebito ?? 0) - (a.dataDebito ?? 0)),
        por((a, b) => (a.dataDebito ?? 0) - (b.dataDebito ?? 0)),
    ];
    for (const status of new Set(lotes.map((l) => l.status))) {
        candidatos.push(
            lotes.filter((l) => l.status === status).sort((a, b) => b.flpCod - a.flpCod)[0],
        );
    }
    for (const cco of new Set(lotes.map((l) => l.ccoCod))) {
        candidatos.push(
            lotes.filter((l) => l.ccoCod === cco).sort((a, b) => b.flpCod - a.flpCod)[0],
        );
    }
    for (const bnc of new Set(lotes.map((l) => l.bncCod))) {
        candidatos.push(
            lotes.filter((l) => l.bncCod === bnc).sort((a, b) => b.flpCod - a.flpCod)[0],
        );
    }
    const escolhidos = new Map<number, Contexto>();
    for (const c of candidatos) {
        if (c && !escolhidos.has(c.flpCod)) escolhidos.set(c.flpCod, c);
        if (escolhidos.size >= max) break;
    }
    return [...escolhidos.values()];
};

async function lerFilial(
    filCod: number,
    sispag: ConexosSispagClient,
    fin015: ConexosSispagWriteClient,
): Promise<{ contextos: Contexto[]; leituras: Leitura[] }> {
    const contas = await sispag.listContasCorrentes(filCod);
    const bancos = [...new Set(contas.map((c) => c.bncCod))];
    log(`filial ${filCod}: ${contas.length} contas, bancos ${JSON.stringify(bancos)}`);
    const lotes: Contexto[] = [];
    for (const bncCod of bancos) {
        assertSomenteLeitura('fin015/list');
        const nativos: LoteNativoEstado[] = await fin015.listarLotesNativos({ filCod, bncCod });
        log(`  banco ${bncCod}: ${nativos.length} lotes nativos`);
        for (const l of nativos) {
            if (l.status === 2) continue; // cancelado não serve de contexto
            lotes.push({
                filCod,
                bncCod,
                flpCod: l.flpCod,
                status: l.status,
                ...(l.ccoCod !== undefined ? { ccoCod: l.ccoCod } : {}),
                ...(l.dataDebito !== undefined ? { dataDebito: l.dataDebito } : {}),
                titulosCount: l.titulosCount,
            });
        }
    }
    const contextos = escolherContextos(lotes, MAX_CONTEXTOS);
    log(`  contextos escolhidos: ${contextos.length} de ${lotes.length} lotes`);
    const leituras: Leitura[] = [];
    for (const ctx of contextos) {
        assertSomenteLeitura(
            `fin015/finItemSispag/titulosPendentes/list/${ctx.filCod}/${ctx.bncCod}/${ctx.flpCod}`,
        );
        const t0 = Date.now();
        const pend = await fin015.listarTitulosPendentes({
            filCod: ctx.filCod,
            bncCod: ctx.bncCod,
            flpCod: ctx.flpCod,
        });
        const flag = new Map<string, boolean>();
        const raw = new Map<string, Row>();
        for (const p of pend) {
            const k = `${p.filCod}:${p.docCod}:${p.titCod}`;
            flag.set(k, p.temBoletoDda);
            raw.set(k, p.raw);
        }
        const flagados = [...flag.values()].filter(Boolean).length;
        log(
            `  ctx bnc=${ctx.bncCod} flp=${ctx.flpCod} st=${ctx.status} cco=${ctx.ccoCod ?? '—'} ` +
                `débito=${dia(ctx.dataDebito)}: ${pend.length} títulos, ${flagados} flagados ` +
                `(${Date.now() - t0} ms)`,
        );
        leituras.push({
            ctx,
            chaves: [...flag.keys()],
            flag,
            raw,
            legiveis: pend.filter((p) => p.ddaLegivel).length,
        });
    }
    return { contextos, leituras };
}

function analisar(filCod: number, leituras: Leitura[]): Row {
    const todas = new Set<string>();
    for (const l of leituras) for (const k of l.chaves) todas.add(k);
    const uniao = [...todas];
    // 1) o conjunto de títulos muda com o contexto?
    const faltando = leituras.map((l) => uniao.length - l.chaves.length);
    // 2) estabilidade do flag
    const estaveis = { sempre: 0, nunca: 0, instavel: 0 };
    const instaveis: Array<{ chave: string; flags: Record<string, boolean | null> }> = [];
    const ganhoPotencial: string[] = [];
    for (const k of uniao) {
        const vals = leituras.map((l) => (l.flag.has(k) ? l.flag.get(k) === true : null));
        const vistos = vals.filter((v): v is boolean => v !== null);
        const sim = vistos.filter(Boolean).length;
        if (sim === vistos.length && sim > 0) estaveis.sempre += 1;
        else if (sim === 0) estaveis.nunca += 1;
        else {
            estaveis.instavel += 1;
            ganhoPotencial.push(k);
            if (instaveis.length < 15) {
                instaveis.push({
                    chave: k,
                    flags: Object.fromEntries(
                        leituras.map((l, i) => [
                            `bnc${l.ctx.bncCod}/flp${l.ctx.flpCod}`,
                            vals[i] ?? null,
                        ]),
                    ),
                });
            }
        }
    }
    // 3) o que, no contexto, acompanha o flag (taxa de flagados por atributo do lote)
    const taxa = (f: (l: Leitura) => string) => {
        const g = new Map<string, { n: number; flagados: number; contextos: number }>();
        for (const l of leituras) {
            const k = f(l);
            const o = g.get(k) ?? g.set(k, { n: 0, flagados: 0, contextos: 0 }).get(k);
            if (!o) continue;
            o.contextos += 1;
            o.n += l.chaves.length;
            o.flagados += [...l.flag.values()].filter(Boolean).length;
        }
        return Object.fromEntries(
            [...g].map(([k, o]) => [
                k,
                { ...o, pct: Number(((100 * o.flagados) / (o.n || 1)).toFixed(1)) },
            ]),
        );
    };
    // 4) vencimento do título × data de débito do lote (H3)
    const h3 = leituras
        .filter((l) => l.ctx.dataDebito)
        .map((l) => {
            const apos = { n: 0, f: 0 };
            const antes = { n: 0, f: 0 };
            for (const [k, r] of l.raw) {
                const v = Number(r.titDtaVencimento);
                if (!Number.isFinite(v) || !l.ctx.dataDebito) continue;
                const alvo = v >= l.ctx.dataDebito ? apos : antes;
                alvo.n += 1;
                if (l.flag.get(k)) alvo.f += 1;
            }
            return {
                ctx: `bnc${l.ctx.bncCod}/flp${l.ctx.flpCod}`,
                debito: dia(l.ctx.dataDebito),
                venc_ge_debito: apos,
                venc_lt_debito: antes,
            };
        });
    // 5) campos do raw que MUDAM entre contextos (para o mesmo título)
    const camposQueMudam: Record<string, number> = {};
    for (const k of uniao) {
        const rows = leituras.map((l) => l.raw.get(k)).filter((r): r is Row => r !== undefined);
        if (rows.length < 2) continue;
        const keys = new Set(rows.flatMap((r) => Object.keys(r)));
        for (const f of keys) {
            const vals = new Set(rows.map((r) => JSON.stringify(r[f] ?? null)));
            if (vals.size > 1) camposQueMudam[f] = (camposQueMudam[f] ?? 0) + 1;
        }
    }
    // 6) campos do raw com cara de DDA/boleto e taxa de preenchimento
    const todosCampos = new Set<string>();
    for (const l of leituras)
        for (const r of l.raw.values()) for (const f of Object.keys(r)) todosCampos.add(f);
    const ddaLike = [...todosCampos].filter((f) => /dda|boleto|codbar|barra|assoc|vincul/i.test(f));
    const preench: Record<string, string> = {};
    const base = leituras[0];
    for (const f of ddaLike) {
        let n = 0;
        let ok = 0;
        for (const r of base?.raw.values() ?? []) {
            n += 1;
            if (r[f] !== null && r[f] !== undefined && r[f] !== '' && r[f] !== 0) ok += 1;
        }
        preench[f] = `${ok}/${n}`;
    }
    return {
        filCod,
        contextos: leituras.length,
        titulosNaUniao: uniao.length,
        titulosFaltandoPorContexto: faltando,
        flag: estaveis,
        taxaPorBanco: taxa((l) => `bnc${l.ctx.bncCod}`),
        taxaPorConta: taxa((l) => `cco${l.ctx.ccoCod ?? '—'}`),
        taxaPorStatus: taxa((l) => `status${l.ctx.status}`),
        h3_vencimentoVsDebito: h3,
        camposQueMudamComOContexto: camposQueMudam,
        camposDdaLike: preench,
        exemplosInstaveis: instaveis,
        _ganhoPotencial: ganhoPotencial,
    };
}

/** Cruza com o Postgres: dos candidatos "mesmo valor+dia, livres, sem flag", quantos o ERP flaga em algum contexto? */
async function cruzarComBanco(leiturasPorFilial: Map<number, Leitura[]>): Promise<Row[]> {
    const url = process.env.PROBE_DB_URL;
    if (!url) return [];
    const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await db.connect();
    try {
        await db.query('SET default_transaction_read_only = on');
        const titulos = (
            await db.query(
                `SELECT fil_cod, doc_cod, tit_cod, credor, valor::float8 AS valor,
                        to_char(vencimento AT TIME ZONE 'UTC','YYYY-MM-DD') AS venc, tem_boleto
                   FROM titulo_a_pagar
                  WHERE ativo AND NOT pago AND forma_pagamento_conexos = 6`,
            )
        ).rows as Array<{
            fil_cod: number;
            doc_cod: string;
            tit_cod: string;
            credor: string;
            valor: number;
            venc: string;
            tem_boleto: boolean;
        }>;
        const boletos = (
            await db.query(
                `SELECT valor::float8 AS valor, to_char(vencimento,'YYYY-MM-DD') AS venc
                   FROM boleto_dda
                  WHERE tit_cod IS NULL AND vencimento >= current_date - 60`,
            )
        ).rows as Array<{ valor: number; venc: string }>;
        const livres = new Set(boletos.map((b) => `${Math.round(b.valor * 100)}|${b.venc}`));
        const out: Row[] = [];
        for (const [filCod, leituras] of leiturasPorFilial) {
            const doBanco = titulos.filter((t) => t.fil_cod === filCod);
            const candidatos = doBanco.filter(
                (t) => !t.tem_boleto && livres.has(`${Math.round(t.valor * 100)}|${t.venc}`),
            );
            const flagadoEmAlgum = (t: { fil_cod: number; doc_cod: string; tit_cod: string }) =>
                leituras.some((l) => l.flag.get(`${t.fil_cod}:${t.doc_cod}:${t.tit_cod}`) === true);
            const semFlagNoBanco = doBanco.filter((t) => !t.tem_boleto);
            const resgatados = candidatos.filter(flagadoEmAlgum);
            const porCredor = new Map<string, number>();
            for (const t of resgatados) porCredor.set(t.credor, (porCredor.get(t.credor) ?? 0) + 1);
            out.push({
                filCod,
                titulosBoletoSemFlagNoBanco: semFlagNoBanco.length,
                candidatosMesmoValorDia: candidatos.length,
                candidatosFlagadosEmAlgumContexto: resgatados.length,
                qualquerSemFlagFlagadoEmAlgumContexto: semFlagNoBanco.filter(flagadoEmAlgum).length,
                resgatadosPorCredor: Object.fromEntries(
                    [...porCredor].sort((a, b) => b[1] - a[1]).slice(0, 8),
                ),
            });
        }
        return out;
    } finally {
        await db.end();
    }
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);
    const fin015 = container.resolve(ConexosSispagWriteClient);
    console.log('='.repeat(78));
    console.log(
        `BASE ${BASE} (READ-ONLY) · filiais ${FILIAIS.join(',')} · ≤${MAX_CONTEXTOS} contextos`,
    );
    console.log('='.repeat(78));
    await base.ensureSid();
    log('login OK');

    const resumos: Row[] = [];
    const leiturasPorFilial = new Map<number, Leitura[]>();
    for (const filCod of FILIAIS) {
        try {
            const { contextos, leituras } = await lerFilial(filCod, sispag, fin015);
            leiturasPorFilial.set(filCod, leituras);
            const resumo = analisar(filCod, leituras);
            resumos.push(resumo);
            // grids enxutos (chave + flag + pagoPor) e uma amostra crua para ver os campos
            writeFileSync(
                `${OUT}/grids-fil${filCod}.json`,
                JSON.stringify(
                    leituras.map((l) => ({
                        ctx: l.ctx,
                        linhas: l.chaves.map((k) => ({
                            k,
                            f: l.flag.get(k) ? 1 : 0,
                            pp: l.raw.get(k)?.titVldPagopor ?? null,
                            v: l.raw.get(k)?.titDtaVencimento ?? null,
                        })),
                    })),
                ),
            );
            const amostra = leituras[0]?.raw.values().next().value;
            if (amostra)
                writeFileSync(
                    `${OUT}/raw-amostra-fil${filCod}.json`,
                    JSON.stringify(amostra, null, 2),
                );
            writeFileSync(`${OUT}/contextos-fil${filCod}.json`, JSON.stringify(contextos, null, 2));
        } catch (err) {
            log(`filial ${filCod}: FALHOU — ${err instanceof Error ? err.message : String(err)}`);
            resumos.push({ filCod, erro: err instanceof Error ? err.message : String(err) });
        }
    }
    const publicos = resumos.map(({ _ganhoPotencial, ...r }) => r);
    writeFileSync(`${OUT}/resumo.json`, JSON.stringify(publicos, null, 2));
    log(`resumo salvo em ${OUT}/resumo.json`);
    console.log(JSON.stringify(publicos, null, 2));

    const cruz = await cruzarComBanco(leiturasPorFilial);
    if (cruz.length > 0) {
        writeFileSync(`${OUT}/cruzamento-banco.json`, JSON.stringify(cruz, null, 2));
        console.log('\nCRUZAMENTO COM O BANCO (read-only):');
        console.log(JSON.stringify(cruz, null, 2));
    } else {
        log('sem PROBE_DB_URL: cruzamento com o Postgres pulado');
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(
            '[flag-contexto] FALHOU:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });

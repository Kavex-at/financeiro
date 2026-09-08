import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * VALIDAÇÃO DO `.REM` — última perna da IDA, sobre um lote QUE JÁ TEM ITENS.
 *
 *   finalizarLote → gerarRemessa → listarArquivosRemessa → baixarRemessa → imprime o CNAB
 *
 * Separado do `validate-fin015-import.ts` de propósito: o import CONSOME o título
 * (ele sai de `titulosPendentes`), então re-rodar o harness inteiro cria um lote novo e
 * pega outro título. Este job opera sobre um `flpCod` existente — é o passo que produz o
 * arquivo para conferência de leiaute.
 *
 * SEGURANÇA:
 *   - RECUSA rodar fora de HML sem `PERMITIR_PRD=1` (finalizar/gerar remessa é escrita).
 *   - `finalizarLote` valida R1 (data débito ≥ hoje) e R2 (≤ menor vencimento) no ERP.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   FLP=26 SEQ=93 tsx jobs/validate-fin015-remessa.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PERMITIR_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD, passe PERMITIR_PRD=1.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/fin015-remessa';
const FIL = Number(process.env.FLP_FIL ?? 1);
const BNC = Number(process.env.FLP_BNC ?? 4);
const FLP = Number(process.env.FLP ?? 0);
const SEQ = Number(process.env.SEQ ?? 93);

type Row = Record<string, unknown>;

const log = (s: string, v?: unknown): void =>
    console.log(`[fin015-remessa] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 400) : '');
const erroDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const save = (name: string, data: unknown): void => {
    writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2));
    console.log(`[fin015-remessa]   ↳ ${OUT}/${name}`);
};

/** Rótulo do registro CNAB 240 pela posição 8 (1-based). */
const tipoRegistro = (linha: string): string => {
    const t = linha.slice(7, 8);
    return (
        {
            '0': 'HEADER ARQUIVO',
            '1': 'HEADER LOTE',
            '3': 'DETALHE',
            '5': 'TRAILER LOTE',
            '9': 'TRAILER ARQUIVO',
        }[t] ?? `reg ${t}`
    );
};

async function main(): Promise<void> {
    if (!FLP) {
        console.error('Passe FLP=<flpCod> do lote a finalizar.');
        process.exit(1);
    }
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}${BASE.includes('-hml') ? ' (HML)' : ' (PRODUÇÃO)'}`);
    console.log(`LOTE: fil=${FIL} bnc=${BNC} flp=${FLP}   seqNum=${SEQ}`);
    console.log('='.repeat(78));

    await base.ensureSid();
    log('login OK');

    // ── 1) o que tem no lote ─────────────────────────────────────────────────
    const itens = await base.listGenericPaginated<Row>(
        `fin015/finItemSispag/list/${FIL}/${BNC}/${FLP}`,
        { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 100 },
        { filCod: FIL },
    );
    log(`1) lote ${FLP} tem ${itens.rows.length} item(ns)`);
    if (itens.rows.length === 0) {
        log('lote vazio — nada a finalizar.');
        return;
    }
    save(`10-itens-flp${FLP}.json`, itens.rows);
    for (const it of itens.rows) {
        console.log(
            `   doc=${it.docCod}/${it.titCod} fil=${it.filCod} fav=${String(it.itsEspNomeFav ?? '').slice(0, 30)} R$ ${it.itsMnyValor} venc=${typeof it.titDtaVencimento === 'number' ? new Date(it.titDtaVencimento).toISOString().slice(0, 10) : '?'} mod=${it.itsVldModalidade} banco=${it.itsNumBanco} ag=${it.agencia} cc=${it.conta}`,
        );
    }

    // ── 1b) cabeçalho do lote — a DATA DE DÉBITO que R2 compara ──────────────
    // R2 = "data de débito do lote ≤ menor vencimento dos itens". A data mora no
    // `flpDtaCredito`, gravada no `criarLote`. Sem ler isso, um erro de R2 é cego.
    try {
        const r = await base.getGeneric<Row>(`fin015/${FIL}/${BNC}/${FLP}`, { filCod: FIL });
        const lote = ((r as Row)?.data as Row) ?? (r as Row);
        save(`15-lote-flp${FLP}.json`, lote);
        const credito = lote?.flpDtaCredito;
        log(
            `1b) lote: flpDtaCredito=${typeof credito === 'number' ? new Date(credito).toISOString().slice(0, 10) : String(credito)} · status=${lote?.flpVldStatus} · titulosCount=${lote?.titulosCount} · soma=${lote?.soma}`,
        );
        const menorVenc = Math.min(
            ...itens.rows.map((i) => Number(i.titDtaVencimento)).filter((n) => Number.isFinite(n)),
        );
        if (Number.isFinite(menorVenc) && typeof credito === 'number') {
            console.log(
                `    R2: débito ${new Date(credito).toISOString().slice(0, 10)} ${credito <= menorVenc ? '≤' : '>'} menor vencimento ${new Date(menorVenc).toISOString().slice(0, 10)} → ${credito <= menorVenc ? 'OK' : 'VIOLADA'}`,
            );
        }
    } catch (e) {
        log('1b) leitura do lote ❌:', erroDe(e));
    }

    // ── 1c) sincronizar `itsDtaPgto` do item ─────────────────────────────────
    // A regra REAL do finalizar não compara o vencimento do TÍTULO: compara o
    // `itsDtaPgto` de cada ITEM com o `flpDtaCredito` do lote. E o `itsDtaPgto` é um
    // SNAPSHOT gravado no import — se o vencimento do título mudar depois, o item fica
    // defasado e o lote trava com "EXISTEM TÍTULOS QUE IRÃO VENCER ANTES DA DATA DE
    // PAGAMENTO DESTE LOTE". `PUT fin015/finItemSispag` reedita o item.
    if (process.env.FIX_ITEM_DTA === '1') {
        for (const it of itens.rows) {
            const venc = Number(it.titDtaVencimento);
            const pgto = Number(it.itsDtaPgto);
            if (!Number.isFinite(venc) || pgto === venc) continue;
            try {
                await base.ensureSid();
                await base.putGenericOnce<unknown>(
                    'fin015/finItemSispag',
                    { ...it, itsDtaPgto: venc },
                    { filCod: FIL },
                );
                log(
                    `1c) item doc=${it.docCod}/${it.titCod}: itsDtaPgto ${new Date(pgto).toISOString().slice(0, 10)} → ${new Date(venc).toISOString().slice(0, 10)} ✅`,
                );
            } catch (e) {
                log(`1c) item doc=${it.docCod}/${it.titCod} PUT ❌:`, erroDe(e));
            }
        }
    }

    // ── 2) finalizarLote (R1/R2 no ERP) ──────────────────────────────────────
    try {
        await write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod: FLP });
        log('2) finalizarLote ✅ OK');
    } catch (e) {
        log('2) finalizarLote ❌:', erroDe(e));
        return;
    }

    // ── 3) gerarRemessa ──────────────────────────────────────────────────────
    const hoje = new Date();
    const nome =
        process.env.NOME ??
        `PG${String(hoje.getUTCDate()).padStart(2, '0')}${String(hoje.getUTCMonth() + 1).padStart(2, '0')}${String(SEQ).padStart(2, '0')}.REM`;
    try {
        const rem = await write.gerarRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod: FLP,
            grbCodSeq: Number(process.env.GRB ?? 1),
            seqNum: SEQ,
            gabEspNomeArquivo: nome,
        });
        log(`3) gerarRemessa ✅ (${nome}) →`, rem);
    } catch (e) {
        log('3) gerarRemessa ❌:', erroDe(e));
    }

    // ── 4) baixar e imprimir o CNAB 240 ──────────────────────────────────────
    try {
        const arquivos = await write.listarArquivosRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod: FLP,
        });
        log(`4) listarArquivosRemessa → ${arquivos.length} arquivo(s)`);
        save(`20-arquivos-flp${FLP}.json`, arquivos);

        const rem = arquivos.find((a) => a.conteudo);
        if (!rem?.conteudo) {
            log('   nenhum arquivo com conteúdo (gabLngDados vazio).');
            return;
        }
        const caminho = `${OUT}/${rem.nomeArquivo ?? `flp${FLP}`}`;
        writeFileSync(caminho, rem.conteudo);

        console.log(`\n${'='.repeat(78)}`);
        console.log(
            `.REM — ${rem.nomeArquivo} · gabCod ${rem.gabCod} · ${rem.conteudo.length} chars`,
        );
        console.log(`arquivo: ${caminho}`);
        console.log('='.repeat(78));
        for (const linha of rem.conteudo.split(/\r?\n/)) {
            if (!linha.trim()) continue;
            console.log(`${tipoRegistro(linha).padEnd(16)}| ${linha}`);
        }
        console.log('='.repeat(78));

        // Conferência por download direto (caminho alternativo ao gabLngDados).
        try {
            const dl = await write.baixarRemessa({ filCod: FIL, gabCod: rem.gabCod });
            log(
                `5) baixarRemessa(gab ${rem.gabCod}) OK · ${dl.length} chars · idêntico ao gabLngDados: ${dl.trim() === rem.conteudo.trim()}`,
            );
        } catch (e) {
            log('5) baixarRemessa ❌:', erroDe(e));
        }
    } catch (e) {
        log('4) listarArquivosRemessa ❌:', erroDe(e));
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin015-remessa] FATAL:', erroDe(e));
        process.exit(1);
    });

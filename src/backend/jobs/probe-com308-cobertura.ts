import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê process.env.CONEXOS_USERNAME na construção, no import).
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';

/**
 * Sonda READ-ONLY do `com308/financeiroAPagar/list/{docCod}` — decide a forma do invariante
 * **I-Write-8a** (pré-checagem de cobertura antes do 1º POST da baixa), ADR-0043.
 *
 * ## Por que existe
 *
 * A ADR-0043 assumiu que `Σ titulos.usd` do `listTitulosAPagar` representava "o que ainda está
 * em aberto na invoice". O swagger versionado deste repo (`docs/conexos-api/070-com3.json`,
 * schema `FinTituloFin`) diz outra coisa:
 *
 *   titVldStatus : 1 ATIVO · 2 RENEGOCIADO · 3 CANCELADO   <- ciclo de vida do REGISTRO
 *   pago         : 1 TOTALMENTE PAGO · 2 PARCIALMENTE · 3 NÃO PAGO   <- a dimensão "em aberto"
 *
 * O client filtra `titVldStatus#EQ 1` e mapeia `usd: titMnyValorMneg` (FACE). Logo a soma é a
 * face bruta dos títulos ATIVOS — quitados inclusive. Uma pré-checagem sobre esse número nasce
 * sistematicamente FROUXA: aprova justamente o caso que deveria recusar.
 *
 * Corrigir subtraindo `titMnyTotPago` não é direto: ele vem em BRL e o lado alocado é moeda
 * negociada; o ERP não expõe `titMnyTotPagoMneg`. Derivar exigiria dividir pela taxa
 * (arredondada a 3 casas) — o mesmo ruído que obrigou a âncora I-Write-6 (teto R$1) a existir,
 * agora dentro de uma guarda que RECUSA. Guarda que erra por arredondamento barra baixa legítima.
 *
 * ## O que responde (nesta ordem de importância)
 *
 *  1. **`pago` é aceito como FILTRO?** (`'pago#NE': '1'`) Se sim, o ERP exclui os quitados na
 *     origem e a soma passa a valer sem aritmética de câmbio — é a opção preferida.
 *  2. **`pago` é aceito no `fieldList`?** (retornável, mesmo que não filtrável)
 *  3. **Truncamento é detectável?** O envelope devolve `count` != `rows.length`? O critério
 *     `rows.length === pageSize` é frágil: há medição (ConexosGerDocProcessoClient.ts:928-931)
 *     em que pedimos 500 e o ERP impôs 50 com `count: 86`.
 *  4. **Quão frouxa 8a seria na prática?** Em invoices REAIS já baixadas por nós, quanto
 *     `Σ face(ATIVO)` difere de `Σ (face − pago/taxa)`. Mede o tamanho do erro, não o supõe.
 *
 * ## Segurança
 *
 * SOMENTE leitura. Um único endpoint: `POST com308/financeiroAPagar/list/{docCod}` (é POST por
 * causa do corpo de filtro, não por escrever). Nenhum POST/PUT de criação, baixa, finalização
 * ou exclusão. Nenhuma escrita no Postgres local — só um SELECT para amostrar docCods reais.
 *
 * Run (PRD — não há ambiente HML neste tenant):
 *   PROBE_ALLOW_PRD=1 npx tsx jobs/probe-com308-cobertura.ts
 *   PROBE_ALLOW_PRD=1 AMOSTRA=25 npx tsx jobs/probe-com308-cobertura.ts
 *   PROBE_ALLOW_PRD=1 DOCS=14042:2,13871:2 npx tsx jobs/probe-com308-cobertura.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');

if (!IS_HML && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(
        `RECUSADO: base é PRODUÇÃO (${BASE}) e PROBE_ALLOW_PRD não está setado.\n` +
            'Rode com PROBE_ALLOW_PRD=1 para confirmar que a leitura em PRD é intencional.',
    );
    process.exit(1);
}

const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-com308-cobertura';
const AMOSTRA = Number(process.env.AMOSTRA ?? 20);
const SERVICE = 'com308.finTituloFin';

/** fieldList atual do `listTitulosAPagar` (ConexosTitulosClient.ts:245). */
const FIELDS_ATUAIS = [
    'titCod',
    'titFltTaxaMneg',
    'titMnyValorMneg',
    'titMnyValor',
    'titMnyTotPago',
    'moeCodMneg',
    'moeEspNome',
];

interface Achado {
    pergunta: string;
    resultado: unknown;
}
const achados: Achado[] = [];
const registrar = (pergunta: string, resultado: unknown): void => {
    achados.push({ pergunta, resultado });
    console.log(`\n### ${pergunta}`);
    console.log(JSON.stringify(resultado, null, 2).slice(0, 3000));
};

const num = (v: unknown): number | undefined => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : Number.NaN;
    return Number.isFinite(n) ? n : undefined;
};

/** Chama o com308 devolvendo o ENVELOPE (count + rows) — `listGeneric` desembrulharia. */
const chamar = async (
    base: ConexosBaseClient,
    docCod: string,
    filCod: number,
    body: Record<string, unknown>,
): Promise<
    { ok: true; count: number; rows: Array<Record<string, unknown>> } | { ok: false; erro: string }
> => {
    try {
        const r = await base.listGenericPaginated<Record<string, unknown>>(
            `com308/financeiroAPagar/list/${docCod}`,
            { serviceName: SERVICE, pageNumber: 1, pageSize: 100, ...body },
            { filCod },
        );
        return { ok: true, count: r.count, rows: r.rows ?? [] };
    } catch (err) {
        return { ok: false, erro: err instanceof Error ? err.message.slice(0, 300) : String(err) };
    }
};

const main = async (): Promise<void> => {
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const db = container.resolve(PostgreeDatabaseClient);

    // Amostra de invoices REAIS que já passaram pela nossa baixa — a população que importa.
    let alvos: Array<{ docCod: string; filCod: number }> = [];
    if (process.env.DOCS) {
        alvos = process.env.DOCS.split(',').map((p) => {
            const [d, f] = p.split(':');
            return { docCod: String(d), filCod: Number(f ?? 2) };
        });
    } else {
        const rows = await db.selectMany(
            `SELECT DISTINCT invoice_doc_cod, fil_cod
               FROM permuta_alocacao_execucao
              WHERE invoice_doc_cod IS NOT NULL AND fil_cod IS NOT NULL
              ORDER BY invoice_doc_cod DESC
              LIMIT $limite`,
            { limite: Math.max(1, Math.min(200, AMOSTRA)) },
        );
        alvos = rows.map((r: Record<string, unknown>) => ({
            docCod: String(r.invoice_doc_cod),
            filCod: Number(r.fil_cod),
        }));
    }
    registrar('amostra (invoices reais da trilha)', {
        total: alvos.length,
        alvos: alvos.slice(0, 8),
    });
    if (alvos.length === 0) {
        console.error('sem alvos — passe DOCS=docCod:filCod');
        process.exit(1);
    }

    const [primeiro] = alvos;
    if (!primeiro) return;

    // ── P1: `pago` é FILTRÁVEL? ────────────────────────────────────────────────────────────
    const comFiltroPago = await chamar(base, primeiro.docCod, primeiro.filCod, {
        fieldList: FIELDS_ATUAIS,
        filterList: { 'titVldStatus#EQ': '1', 'pago#NE': '1' },
        orderList: { orderList: [{ propertyName: 'titCod', order: 'asc' }] },
    });
    registrar('P1 — `pago#NE: 1` é aceito como FILTRO?', {
        doc: primeiro,
        aceito: comFiltroPago.ok,
        ...(comFiltroPago.ok
            ? { count: comFiltroPago.count, linhas: comFiltroPago.rows.length }
            : { erro: comFiltroPago.erro }),
    });

    // ── P2: `pago` é retornável no fieldList? ──────────────────────────────────────────────
    const comCampoPago = await chamar(base, primeiro.docCod, primeiro.filCod, {
        fieldList: [...FIELDS_ATUAIS, 'pago'],
        filterList: { 'titVldStatus#EQ': '1' },
        orderList: { orderList: [{ propertyName: 'titCod', order: 'asc' }] },
    });
    registrar('P2 — `pago` é aceito no fieldList?', {
        aceito: comCampoPago.ok,
        ...(comCampoPago.ok
            ? {
                  count: comCampoPago.count,
                  amostraRow: comCampoPago.rows[0] ?? null,
                  temCampoPago: comCampoPago.rows[0] ? 'pago' in comCampoPago.rows[0] : false,
              }
            : { erro: comCampoPago.erro }),
    });

    // ── P3: truncamento — `count` bate com `rows.length`? ──────────────────────────────────
    const pequeno = await chamar(base, primeiro.docCod, primeiro.filCod, {
        fieldList: FIELDS_ATUAIS,
        filterList: { 'titVldStatus#EQ': '1' },
        orderList: { orderList: [{ propertyName: 'titCod', order: 'asc' }] },
        pageSize: 1,
    });
    registrar('P3 — envelope expõe `count` != rows.length (detecção de truncamento)?', {
        pedidoPageSize: 1,
        ...(pequeno.ok
            ? {
                  count: pequeno.count,
                  linhasDevolvidas: pequeno.rows.length,
                  detectavel: pequeno.count !== pequeno.rows.length,
              }
            : { erro: pequeno.erro }),
    });

    // ── P4: quão frouxa 8a seria hoje (face vs face-menos-pago) ────────────────────────────
    const medidas: Array<Record<string, unknown>> = [];
    for (const alvo of alvos) {
        const r = await chamar(base, alvo.docCod, alvo.filCod, {
            fieldList: FIELDS_ATUAIS,
            filterList: { 'titVldStatus#EQ': '1' },
            orderList: { orderList: [{ propertyName: 'titCod', order: 'asc' }] },
        });
        if (!r.ok) {
            medidas.push({ ...alvo, erro: r.erro });
            continue;
        }
        let faceUsd = 0;
        let abertoUsdDerivado = 0;
        let titulosComPago = 0;
        for (const row of r.rows) {
            const face = num(row.titMnyValorMneg) ?? 0;
            const taxa = num(row.titFltTaxaMneg);
            const pagoBrl = num(row.titMnyTotPago) ?? 0;
            faceUsd += face;
            const pagoUsd = taxa && taxa > 0 ? pagoBrl / taxa : 0;
            abertoUsdDerivado += Math.max(0, face - pagoUsd);
            if (pagoBrl > 0) titulosComPago += 1;
        }
        medidas.push({
            ...alvo,
            titulos: r.rows.length,
            count: r.count,
            truncado: r.count !== r.rows.length,
            titulosComPago,
            faceUsd: Number(faceUsd.toFixed(2)),
            abertoUsdDerivado: Number(abertoUsdDerivado.toFixed(2)),
            folgaUsd: Number((faceUsd - abertoUsdDerivado).toFixed(2)),
        });
    }
    const comFolga = medidas.filter(
        (m) => typeof m.folgaUsd === 'number' && (m.folgaUsd as number) > 0.01,
    );
    registrar('P4 — folga da FACE sobre o aberto derivado (o quanto 8a seria frouxa)', {
        invoicesMedidas: medidas.length,
        comFolgaPositiva: comFolga.length,
        pctComFolga: medidas.length ? Math.round((comFolga.length / medidas.length) * 100) : 0,
        truncadas: medidas.filter((m) => m.truncado === true).length,
        piores: [...comFolga]
            .sort((a, b) => (b.folgaUsd as number) - (a.folgaUsd as number))
            .slice(0, 10),
    });

    const arquivo = `${OUT_DIR}/achados.json`;
    writeFileSync(
        arquivo,
        JSON.stringify(
            { base: BASE, geradoEm: new Date().toISOString(), achados, medidas },
            null,
            2,
        ),
    );
    console.log(`\n\nachados -> ${arquivo}`);
    process.exit(0);
};

main().catch((err) => {
    console.error('probe falhou:', err);
    process.exit(1);
});

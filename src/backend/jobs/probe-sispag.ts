import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * SISPAG live probe (READ-ONLY) — Escopo II diagnosis.
 *
 * Sonda o Conexos PRD para mapear a superfície NATIVA de pagamentos (fin015 lote,
 * fin052 retorno, fin143 Nexxera, fin010 borderô a-pagar, com308/com311 títulos +
 * flags de liberação/alçada). Objetivo: evidência empírica para decidir "precisa
 * Nexxera ou não" e confirmar como "aprovado para baixa" é representado.
 *
 * SEGURANÇA — INVIOLÁVEL:
 *   - APENAS leitura. A única superfície de rede usada é `listRO` (POST /list, o
 *     protocolo de QUERY do Conexos) e `getRO` (GET). NENHUM helper de escrita
 *     (postGenericOnce/deleteGeneric) é importado ou chamado.
 *   - Uma ASSERT_PATH bloqueia qualquer path que contenha um verbo mutante
 *     (gerar/importar/finalizar/cancelar/estornar/processar/carregar/liberar/
 *     confirmar/troca/regerar/baixas/remessa/excluir). Se algo escapar, o script
 *     ABORTA antes de tocar a rede.
 *   - Não escreve no Postgres (só o bootstrap toca o banco; em não-prod ele
 *     warn-and-continue se o banco estiver indisponível).
 *
 * Run:
 *   cd src/backend && tsx jobs/probe-sispag.ts
 *   (usa CONEXOS_BASE_URL do .env — hoje PRD columbiatrading.conexos.cloud)
 *
 * Saída: JSON por sonda + summary.md em PROBE_OUT (default /tmp/sispag-probe).
 */

const OUT = process.env.PROBE_OUT ?? '/tmp/sispag-probe';
mkdirSync(OUT, { recursive: true });

// ---- guard: só permite paths de leitura --------------------------------------
const FORBIDDEN =
    /(gerar|importar|finalizar|cancelar|estornar|processar|carregar|liberar|confirmar|troca|regerar|baixaAutomatica|excluir|remessa|\bbaixas\b)/i;
const assertReadPath = (path: string): void => {
    // exceção: `.../list/...` e `.../baixas/list/...` são QUERY (permitido);
    // mas nunca um POST cru a `baixas` sem `/list`.
    const isListQuery = /(^|\/)list(\/|$)/i.test(path) || /baixasTitulo.*\/list/i.test(path);
    if (FORBIDDEN.test(path) && !isListQuery) {
        throw new Error(`REFUSED (write-ish path in read-only probe): ${path}`);
    }
};

type ProbeResult = {
    name: string;
    method: 'POST/list' | 'GET';
    path: string;
    filCod?: number;
    ok: boolean;
    count?: number;
    sampleKeys?: string[];
    error?: string;
};

const results: ProbeResult[] = [];

const dump = (name: string, data: unknown): void => {
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
};

const keysOf = (rows: unknown): string[] => {
    if (Array.isArray(rows) && rows.length > 0 && typeof rows[0] === 'object' && rows[0]) {
        return Object.keys(rows[0] as Record<string, unknown>).sort();
    }
    return [];
};

const truncate = <T>(rows: T[], n = 10): T[] => rows.slice(0, n);

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: script de diagnóstico ad-hoc (read-only), fora do caminho de produção.
async function main(): Promise<void> {
    await bootstrapAppContainer();
    const conexos = container.resolve(ConexosBaseClient);

    const baseUrl = process.env.CONEXOS_BASE_URL ?? '(default PRD)';
    console.log(`[probe-sispag] target = ${baseUrl}`);
    console.log('[probe-sispag] READ-ONLY. Output ->', OUT);

    await conexos.ensureSid();
    const filiais = await conexos.getFiliais();
    const filCodDefault = await conexos.getFilCodDefault();
    dump('00-filiais', { filCodDefault, filiais });
    console.log(`[probe-sispag] filiais=${filiais.length} filCodDefault=${filCodDefault}`);

    const filCods = filiais.map((f) => f.filCod).filter((n): n is number => typeof n === 'number');
    const probeFilCods = filCods.length > 0 ? filCods : filCodDefault ? [filCodDefault] : [];

    /** POST /<endpoint> as a Conexos QUERY (list). Returns {count, rows}. */
    const listRO = async (
        name: string,
        endpoint: string,
        filterList: Record<string, unknown>,
        filCod?: number,
        pageSize = 50,
    ): Promise<Record<string, unknown>[]> => {
        assertReadPath(endpoint);
        try {
            const body = {
                fieldList: [],
                filterList,
                serviceName: endpoint.split('/')[0],
                pageNumber: 1,
                pageSize,
            };
            const { count, rows } = await conexos.listGenericPaginated<Record<string, unknown>>(
                endpoint,
                body,
                filCod ? { filCod } : undefined,
            );
            dump(name, { endpoint, filCod, count, sampleRows: truncate(rows) });
            results.push({
                name,
                method: 'POST/list',
                path: endpoint,
                filCod,
                ok: true,
                count,
                sampleKeys: keysOf(rows),
            });
            console.log(
                `[probe-sispag] OK  ${name} (${endpoint}) count=${count} filCod=${filCod ?? '-'}`,
            );
            return rows;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            dump(name, { endpoint, filCod, error });
            results.push({ name, method: 'POST/list', path: endpoint, filCod, ok: false, error });
            console.log(`[probe-sispag] ERR ${name} (${endpoint}): ${error.slice(0, 160)}`);
            return [];
        }
    };

    /** GET /<path> raw. */
    const getRO = async (name: string, path: string, filCod?: number): Promise<unknown> => {
        assertReadPath(path);
        try {
            const data = await conexos.getGeneric<unknown>(path, filCod ? { filCod } : undefined);
            dump(name, { path, filCod, data });
            results.push({ name, method: 'GET', path, filCod, ok: true });
            console.log(`[probe-sispag] OK  ${name} (GET ${path}) filCod=${filCod ?? '-'}`);
            return data;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            dump(name, { path, filCod, error });
            results.push({ name, method: 'GET', path, filCod, ok: false, error });
            console.log(`[probe-sispag] ERR ${name} (GET ${path}): ${error.slice(0, 160)}`);
            return undefined;
        }
    };

    const num = (row: Record<string, unknown>, ...keys: string[]): number | undefined => {
        for (const k of keys) {
            const v = row[k];
            if (typeof v === 'number') return v;
            if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
                return Number(v);
        }
        return undefined;
    };

    // ============================================================ NATIVE SISPAG
    // 1) fin015 — Lotes SISPAG (por filial). Evidência: existem lotes? qual banco/layout?
    const loteRows: Record<string, unknown>[] = [];
    for (const filCod of probeFilCods) {
        const rows = await listRO(`10-fin015-lotes-fil${filCod}`, 'fin015/list', {}, filCod);
        loteRows.push(...rows.map((r) => ({ ...r, __filCod: filCod })));
    }
    dump('10-fin015-lotes-ALL', { total: loteRows.length, sample: truncate(loteRows, 30) });

    // 1a) para um lote, listar arquivos de remessa já gerados (READ) — prova de uso nativo
    const firstLote = loteRows[0];
    if (firstLote) {
        const filCodLote = num(firstLote, '__filCod', 'filCod', 'filCodLote');
        const bncCod = num(firstLote, 'bncCod');
        const flpCod = num(firstLote, 'flpCod', 'flsCod', 'loteCod');
        if (filCodLote !== undefined) {
            await listRO(
                '11-fin015-remessas',
                `fin015/gerArquivosBancos/list/${filCodLote}`,
                {},
                filCodLote,
            );
            if (bncCod !== undefined && flpCod !== undefined) {
                await getRO(
                    '12-fin015-lote-detalhe',
                    `fin015/${filCodLote}/${bncCod}/${flpCod}`,
                    filCodLote,
                );
            }
        }
    }

    // 2) fin052 — Retorno de Bancos Pagfor (arquivos de retorno processados)
    for (const filCod of probeFilCods.slice(0, 3)) {
        await listRO(`20-fin052-retornos-fil${filCod}`, 'fin052/arquivosRetorno/list', {}, filCod);
    }

    // 3) fin143 — Importação Nexxera. CRUCIAL: está em uso? importa o quê?
    for (const filCod of probeFilCods.slice(0, 3)) {
        await listRO(`30-fin143-nexxera-fil${filCod}`, 'fin143/list', {}, filCod);
    }

    // 4) fin010 — Borderôs a-pagar (baixa). Como pagamentos são baixados hoje?
    for (const filCod of probeFilCods.slice(0, 3)) {
        await listRO(`40-fin010-borderos-fil${filCod}`, 'fin010/list', {}, filCod, 20);
    }

    // 5) fin064 / fin061 — Gestão / Envio de Pagamentos (existe uso?)
    for (const filCod of probeFilCods.slice(0, 2)) {
        await listRO(`50-fin064-gestao-pgto-fil${filCod}`, 'fin064/list', {}, filCod);
        await listRO(`51-fin061-envio-pgto-fil${filCod}`, 'fin061/list', {}, filCod);
    }

    // ==================================================== TÍTULOS + APROVAÇÃO
    // 6) com298 — documentos a-pagar FINALIZADOS (amostra) → colher docCod
    // vldStatus=3 (FINALIZADO), padrão de Permutas. Sem filtro de priCod.
    const docsAPagar = await listRO(
        '60-com298-apagar',
        'com298/list',
        { 'vldStatus#IN': ['3'] },
        filCodDefault ?? probeFilCods[0],
        30,
    );

    const sampleDocs = docsAPagar.slice(0, 5);
    let i = 0;
    for (const doc of sampleDocs) {
        i += 1;
        const docCod = num(doc, 'docCod');
        const fCod = num(doc, 'filCod') ?? filCodDefault ?? probeFilCods[0];
        if (docCod === undefined) continue;
        // 6a) com311 — títulos/parcelas do doc (GET list)
        await getRO(`70-com311-titulos-doc${docCod}`, `com311/list/${docCod}`, fCod);
        // 6b) com308 — detalhe do título a-pagar (flags de liberação/alçada, envio banco)
        await listRO(
            `71-com308-titulos-doc${docCod}`,
            `com308/financeiroAPagar/list/${docCod}`,
            {},
            fCod,
            50,
        );
        if (i >= 5) break;
    }

    // ============================================================ SUMMARY
    const summary = [
        '# SISPAG live probe — resultados (READ-ONLY, Conexos PRD)',
        '',
        `- Target: ${baseUrl}`,
        `- Filiais: ${filiais.length} (default ${filCodDefault})`,
        `- Lotes SISPAG (fin015) encontrados: ${loteRows.length}`,
        '',
        '| # | sonda | método | path | filCod | ok | count | erro |',
        '|---|-------|--------|------|--------|----|-------|------|',
        ...results.map(
            (r) =>
                `| ${r.name} | ${r.name} | ${r.method} | \`${r.path}\` | ${r.filCod ?? '-'} | ${r.ok ? '✅' : '❌'} | ${r.count ?? '-'} | ${r.error ? r.error.slice(0, 80).replace(/\|/g, '/') : ''} |`,
        ),
        '',
        '## Chaves de campo por sonda (sampleKeys)',
        ...results
            .filter((r): r is ProbeResult & { sampleKeys: string[] } =>
                Boolean(r.sampleKeys?.length),
            )
            .map((r) => `- **${r.name}** (\`${r.path}\`): ${r.sampleKeys.join(', ')}`),
    ].join('\n');
    writeFileSync(join(OUT, 'summary.md'), summary);
    dump('_results', results);

    const okCount = results.filter((r) => r.ok).length;
    console.log(
        `\n[probe-sispag] done: ${okCount}/${results.length} probes OK. See ${OUT}/summary.md`,
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(
            '[probe-sispag] FAILED:',
            error instanceof Error ? error.stack : String(error),
        );
        process.exit(1);
    });

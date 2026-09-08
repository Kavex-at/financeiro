import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * SONDA READ-ONLY — fecha o gap do `importarTitulos` (fin015, ferramenta 3).
 *
 * CONTEXTO: das 7 ferramentas do `ConexosSispagWriteClient`, 6 estão provadas ao vivo.
 * A que falta é o `importarTitulos`: a linha crua do `titulosPendentes/list` dá 400 no
 * `importar` porque falta `itsVldModalidade` + destino (agência/conta/barras/chave PIX).
 * Ver `ontology/_inbox/sispag-fin015-write-tools.md` §3.
 *
 * HIPÓTESE (do OpenAPI, ainda não sondada): a tela NÃO importa a linha do grid. Ela monta
 * um `FinItemSispag` (65 campos: `itsVldModalidade`, `agencia`, `conta`, `itsNumBanco`,
 * `itsNumCodbar`, `itsDesChavePix`, `vldOk`, `vldImporta`…) e passa pelos validadores
 * `finItemSispag/validacao/{modalidadeTed|modalidadePix|codigoBarras}` — que recebem UM
 * `FinItemSispag` e DEVOLVEM um `FinItemSispag` (= enriquecem). O item enriquecido é o
 * que vai pro `importar`.
 *
 * MÉTODO (sem escrever nada): ler os itens de um lote JÁ POPULADO
 * (`POST fin015/finItemSispag/list/{fil}/{bnc}/{flp}`) e comparar campo-a-campo com a
 * linha do `titulosPendentes/list`. O delta é exatamente o que o import precisa receber.
 *
 * SEGURANÇA: só chama LIST/GET. Nenhum POST de escrita, nenhum PUT, nenhum DELETE.
 * Roda em HML ou PRD (PRD tem os lotes reais); a base é impressa em destaque.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api tsx jobs/probe-fin015-import.ts
 *   # PRD (read-only, onde estão os 17 lotes reais):
 *   PROBE_PRD=1 tsx jobs/probe-fin015-import.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(
        `RECUSADO: base não é HML (${BASE}). Esta sonda é read-only; para rodar em PRD passe PROBE_PRD=1.`,
    );
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/fin015-import-probe';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));

const log = (s: string, v?: unknown): void =>
    console.log(`[fin015-import] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 600) : '');

const save = (name: string, data: unknown): void => {
    writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2));
    log(`  ↳ salvo ${OUT}/${name}`);
};

interface LoteRow extends Record<string, unknown> {
    filCod?: unknown;
    bncCod?: unknown;
    flpCod?: unknown;
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}   ${IS_HML ? '(HML)' : '(PRODUÇÃO — READ-ONLY)'}`);
    console.log('='.repeat(78));

    await base.ensureSid();
    log('login OK');

    // ── 1) Achar lotes COM itens (qualquer status) nas filiais alvo ────────────
    const lotes: LoteRow[] = [];
    for (const filCod of FILIAIS) {
        try {
            const page = await base.listGenericPaginated<LoteRow>(
                'fin015/list',
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 100,
                },
                { filCod },
            );
            log(`fin015/list fil=${filCod} → ${page.rows.length} lote(s)`);
            lotes.push(...page.rows.map((r) => ({ ...r, filCod: r.filCod ?? filCod })));
        } catch (e) {
            log(`fin015/list fil=${filCod} ERRO:`, e instanceof Error ? e.message : String(e));
        }
    }
    save('10-lotes.json', lotes);
    if (lotes.length === 0) {
        log('NENHUM lote encontrado — nada a inspecionar. Fim.');
        return;
    }

    // Campos de contagem variam por versão do ERP: tenta os candidatos conhecidos.
    const contagem = (l: LoteRow): number => {
        for (const k of ['titulosCount', 'qtdTitulos', 'itens', 'flpNumQtdTitulos']) {
            const v = Number(l[k]);
            if (Number.isFinite(v) && v > 0) return v;
        }
        return 0;
    };
    const comItens = lotes.filter((l) => contagem(l) > 0);
    log(`lotes com itens (por contagem no grid): ${comItens.length}/${lotes.length}`);
    if (comItens.length > 0) log('  campos do grid do lote:', Object.keys(comItens[0]).sort());

    // ── 2) O ALVO: itens JÁ IMPORTADOS de um lote populado (FinItemSispag real) ─
    // Se a contagem do grid não for confiável, varre todos os lotes até achar itens.
    const candidatos = comItens.length > 0 ? comItens : lotes;
    let itensEncontrados = false;

    for (const l of candidatos.slice(0, 12)) {
        const filCod = Number(l.filCod);
        const bncCod = Number(l.bncCod);
        const flpCod = Number(l.flpCod);
        if (![filCod, bncCod, flpCod].every(Number.isFinite)) continue;

        const path = `fin015/finItemSispag/list/${filCod}/${bncCod}/${flpCod}`;
        try {
            const page = await base.listGenericPaginated<Record<string, unknown>>(
                path,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 50,
                },
                { filCod },
            );
            log(
                `finItemSispag/list fil=${filCod} bnc=${bncCod} flp=${flpCod} → ${page.rows.length} item(ns)`,
            );
            if (page.rows.length === 0) continue;

            itensEncontrados = true;
            save(`20-itens-flp${flpCod}-fil${filCod}.json`, page.rows);

            const item = page.rows[0];
            console.log(`\n${'─'.repeat(78)}`);
            console.log(`ITEM IMPORTADO REAL — flp ${flpCod} (fil ${filCod}, bnc ${bncCod})`);
            console.log('─'.repeat(78));
            for (const k of Object.keys(item).sort()) {
                const v = item[k];
                if (v === null || v === undefined || v === '') continue;
                console.log(`  ${k.padEnd(28)} = ${JSON.stringify(v)}`);
            }

            // Os campos que o gap acusa — o que a tela preencheu e o grid não dá.
            console.log('\n  >>> CAMPOS-CHAVE DO IMPORT <<<');
            for (const k of [
                'itsVldModalidade',
                'itsNumBanco',
                'agencia',
                'conta',
                'itsNumCodbar',
                'itsDesChavePix',
                'itsVldChavePix',
                'itsEspNomeFav',
                'pctCodSeq',
                'fbtCod',
                'vldOk',
                'vldImporta',
                'itsMnyVlrPgto',
                'itsDtaPgto',
            ]) {
                console.log(`  ${k.padEnd(28)} = ${JSON.stringify(item[k] ?? null)}`);
            }

            // ── 3) A MESMA chave, vista do lado do grid de pendentes ───────────
            const docCod = item.docCod;
            const titCod = item.titCod;
            log(`\ncomparando com titulosPendentes (docCod=${docCod} titCod=${titCod})…`);
            try {
                const pend = await write.listarTitulosPendentes({
                    filCod,
                    bncCod,
                    flpCod,
                    pageSize: 200,
                });
                log(`titulosPendentes/list → ${pend.length} pendente(s)`);
                if (pend.length > 0) {
                    save(`30-pendentes-flp${flpCod}-fil${filCod}.json`, pend.slice(0, 20));
                    const camposPend = new Set(Object.keys(pend[0].raw));
                    const camposItem = Object.keys(item);
                    const soNoItem = camposItem.filter((k) => !camposPend.has(k));
                    const preenchidosSoNoItem = soNoItem.filter(
                        (k) => item[k] !== null && item[k] !== undefined && item[k] !== '',
                    );
                    console.log('\n  >>> DELTA — campos que o ITEM tem e o PENDENTE não <<<');
                    console.log(
                        '  (preenchidos):',
                        preenchidosSoNoItem.sort().join(', ') || '(nenhum)',
                    );
                    console.log(
                        '  (vazios):',
                        soNoItem
                            .filter((k) => !preenchidosSoNoItem.includes(k))
                            .sort()
                            .join(', ') || '(nenhum)',
                    );
                    save(`40-delta-flp${flpCod}.json`, {
                        soNoItem: soNoItem.sort(),
                        preenchidosSoNoItem: preenchidosSoNoItem.sort(),
                        camposPendente: [...camposPend].sort(),
                        camposItem: camposItem.sort(),
                    });
                }
            } catch (e) {
                log('titulosPendentes/list ERRO:', e instanceof Error ? e.message : String(e));
            }

            break; // um lote populado basta
        } catch (e) {
            log(
                `finItemSispag/list flp=${flpCod} ERRO:`,
                e instanceof Error ? e.message : String(e),
            );
        }
    }

    if (!itensEncontrados) {
        log('NENHUM lote com itens acessível — o `finItemSispag/list` não devolveu linhas.');
    }

    // ── 4) BÔNUS read-only: o log do lote mostra a sequência de ações da tela ───
    const alvo = candidatos[0];
    if (alvo) {
        const filCod = Number(alvo.filCod);
        const bncCod = Number(alvo.bncCod);
        const flpCod = Number(alvo.flpCod);
        try {
            const logLote = await base.getGeneric<unknown>(
                `fin015/log/${filCod}/${bncCod}/${flpCod}`,
                { filCod },
            );
            save('50-log-lote.json', logLote);
            log('fin015/log OK — trilha de ações do lote capturada.');
        } catch (e) {
            log('fin015/log ERRO:', e instanceof Error ? e.message : String(e));
        }
    }

    console.log(`\nFIM — artefatos em ${OUT}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin015-import] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

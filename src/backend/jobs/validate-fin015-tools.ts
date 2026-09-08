import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê process.env.CONEXOS_USERNAME na construção, no import).
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import type { ContaPagadora } from '../domain/interface/sispag/Fin015Write.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * VALIDAÇÃO EM HML das ferramentas do `ConexosSispagWriteClient` (fin015).
 *
 * Prova cada ferramenta AO VIVO pelo client real (não pela sonda), como fizemos em
 * 2026-07-09 com `probe-fin015-*.ts`. NÃO é o fluxo de produção — é o banco de provas
 * das integrações, para o fluxo real (pós-analista) só encaixar as peças prontas.
 *
 * SEGURANÇA:
 *   - RECUSA rodar se a base não for HML (guard anti-PRD).
 *   - Escrita (criar/importar/finalizar/gerar) só com FIN015_WRITE=1 (default: só leitura).
 *
 * Run (leitura):  CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api tsx jobs/validate-fin015-tools.ts
 * Run (escrita):  ... FIN015_WRITE=1 tsx jobs/validate-fin015-tools.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Aponte CONEXOS_BASE_URL p/ *-hml* antes.`);
    process.exit(1);
}

const FIL = Number(process.env.FLP_FIL ?? 1);
const BNC = Number(process.env.FLP_BNC ?? 4);
const ITAU_HML: ContaPagadora = {
    bncCod: BNC,
    bncNumCodbanco: 341,
    ccoCod: 1,
    ccoNumConta: 55795,
    ccoEspDvconta: '4',
    ccoEspAgcod: '0641',
    conta: '55795-4',
    layoutConta: 'AG:0641/CT:55795-4',
};

const log = (s: string, v?: unknown) =>
    console.log(`[fin015-tools] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 400) : '');

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const write = container.resolve(ConexosSispagWriteClient);
    const base = container.resolve(ConexosBaseClient);
    log(`base=${BASE} · fil=${FIL} bnc=${BNC}`);

    // ── SEMPRE (seguro): login + valida as ferramentas de LEITURA contra um lote
    //    FINALIZADO já existente em HML. Prova conectividade + reads sem escrever nada.
    await base.ensureSid();
    log('login HML OK');
    const finalizados = await base.listGenericPaginated<Record<string, unknown>>(
        'fin015/list',
        {
            fieldList: [],
            filterList: { 'flpVldStatus#EQ': 1 },
            serviceName: 'fin015',
            pageNumber: 1,
            pageSize: 20,
        },
        { filCod: FIL },
    );
    log(`lotes FINALIZADOS em HML (fil ${FIL}): ${finalizados.rows.length}`);
    const alvoLeitura = finalizados.rows
        .map((r) => Number(r.flpCod))
        .filter((n) => Number.isFinite(n))[0];
    if (alvoLeitura) {
        const arquivos = await write.listarArquivosRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod: alvoLeitura,
        });
        log(`READ listarArquivosRemessa(flp ${alvoLeitura}) OK · ${arquivos.length} arquivo(s)`);
        const comConteudo = arquivos.find((a) => a.conteudo);
        if (comConteudo) {
            const dl = await write.baixarRemessa({ filCod: FIL, gabCod: comConteudo.gabCod });
            log(`READ baixarRemessa(gab ${comConteudo.gabCod}) OK · ${dl.length} chars`);
        }
    }

    if (process.env.FIN015_WRITE !== '1') {
        log(
            'READ-ONLY (FIN015_WRITE!=1) — ferramentas de leitura validadas; nenhuma escrita. Fim.',
        );
        return;
    }

    // ── 1) criarLote ─────────────────────────────────────────────────────────
    const dataDebito = Date.parse('2026-07-20T00:00:00Z');
    let flpCod: number | undefined;
    try {
        const lote = await write.criarLote({ filCod: FIL, conta: ITAU_HML, dataDebito });
        flpCod = lote.flpCod;
        log('1) criarLote OK →', lote);
    } catch (e) {
        log('1) criarLote ERRO:', e instanceof Error ? e.message : String(e));
        return;
    }
    if (!flpCod) return;

    // ── 2) listarTitulosPendentes ────────────────────────────────────────────
    let pendentes: Awaited<ReturnType<typeof write.listarTitulosPendentes>> = [];
    try {
        pendentes = await write.listarTitulosPendentes({ filCod: FIL, bncCod: BNC, flpCod });
        log(`2) listarTitulosPendentes OK · count=${pendentes.length}`, pendentes[0]?.docCod);
    } catch (e) {
        log('2) listarTitulosPendentes ERRO:', e instanceof Error ? e.message : String(e));
    }

    // ── 3) importarTitulos — 1 tentativa enriquecida (chaves do lote no item) + inventário ─
    const alvo = pendentes.find((p) => p.itsVldModalidade != null) ?? pendentes[0];
    if (alvo) {
        // Inventário dos campos do pendente (para montar o item de import no fluxo real).
        log(`3) campos do pendente docCod=${alvo.docCod}:`, Object.keys(alvo.raw).sort());
        const itemEnriquecido = { ...alvo.raw, filCodLote: FIL, bncCod: BNC, flpCod };
        try {
            await write.importarTitulos({
                filCod: FIL,
                bncCod: BNC,
                flpCod,
                itens: [itemEnriquecido],
            });
            log('3) importarTitulos OK →', alvo.docCod);
        } catch (e) {
            log(
                '3) importarTitulos ERRO (item precisa de mais enriquecimento — gap p/ analista):',
                e instanceof Error ? e.message : String(e),
            );
        }
    } else {
        log('3) importarTitulos PULADO — nenhum pendente em HML.');
    }

    // ── 4) finalizarLote (valida R1/R2 no ERP) ───────────────────────────────
    try {
        await write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod });
        log('4) finalizarLote OK');
    } catch (e) {
        log(
            '4) finalizarLote ERRO (esperado R1/R2 se sem título válido):',
            e instanceof Error ? e.message : String(e),
        );
    }

    // ── 5) gerarRemessa ──────────────────────────────────────────────────────
    try {
        const rem = await write.gerarRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod,
            grbCodSeq: 1,
            seqNum: Number(process.env.SEQ ?? 88),
            gabEspNomeArquivo: process.env.NOME ?? 'PG090788.REM',
        });
        log('5) gerarRemessa →', rem);
    } catch (e) {
        log('5) gerarRemessa ERRO:', e instanceof Error ? e.message : String(e));
    }

    // ── 6) listarArquivosRemessa + salvar o .REM ─────────────────────────────
    try {
        const arquivos = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod });
        log(`6) listarArquivosRemessa OK · count=${arquivos.length}`);
        const rem = arquivos.find((a) => a.conteudo);
        if (rem?.conteudo) {
            writeFileSync('/tmp/fin015-tools-gerado.REM', rem.conteudo);
            log(
                `   .REM salvo em /tmp/fin015-tools-gerado.REM · nome=${rem.nomeArquivo} · gabCod=${rem.gabCod}`,
            );
            // 7) baixarRemessa (download por gabCod)
            try {
                const conteudo = await write.baixarRemessa({ filCod: FIL, gabCod: rem.gabCod });
                log(`7) baixarRemessa OK · ${conteudo.length} chars`);
            } catch (e) {
                log('7) baixarRemessa ERRO:', e instanceof Error ? e.message : String(e));
            }
        }
    } catch (e) {
        log('6) listarArquivosRemessa ERRO:', e instanceof Error ? e.message : String(e));
    }

    log(`FIM — lote de teste flp=${flpCod} em HML.`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin015-tools] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

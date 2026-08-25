import 'reflect-metadata';
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import ConciliacaoRetornoService from '../domain/service/sispag/ConciliacaoRetornoService.js';

/**
 * GATE — a retomada da CONCILIAÇÃO não reprocessa? (P0 do Regis-Review: fault-tolerance-2)
 *
 * A perna de IDA passou por um gate igual a este e revelou SEIS defeitos de produção que
 * nenhum mock pegava. A VOLTA compartilha a doutrina — "perguntar ao ERP em vez de supor" —
 * mas estava apoiada só em mock. E é a VOLTA que grava baixa IRREVERSÍVEL no fin010: o
 * `arquivosRetorno/processar` não tem undo.
 *
 * ── O QUE ESTE GATE MEDE ────────────────────────────────────────────────────────────────
 * O critério não é "não deu erro": é **o `processar` foi chamado quantas vezes?**. Uma
 * retomada que reprocessa é o dano que o ledger existe para evitar, e ela devolveria 200
 * feliz. Por isso o job conta as chamadas e compara com o esperado.
 *
 * ── SEGURANÇA ───────────────────────────────────────────────────────────────────────────
 * Recusa rodar fora de HML sem `PERMITIR_PRD=1`. Default é DRY (só inspeciona). O cenário
 * que de fato chama `processar` exige `--executar` E um arquivo escolhido a dedo.
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString=<postgres local> \
 *   npx tsx jobs/validate-conciliacao-retorno-v1.ts            # inspeciona
 *   ... CONEXOS_WRITE_ENABLED=true CONEXOS_DRY_RUN=false SISPAG_LIVE_WRITE_ENABLED=true \
 *       VAL_GAR=<garCodSeq> npx tsx jobs/validate-conciliacao-retorno-v1.ts --executar
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const EXECUTAR = process.argv.includes('--executar');
const FIL = Number(process.env.VAL_FIL ?? 2);

if (!BASE.includes('-hml') && process.env.PERMITIR_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD, passe PERMITIR_PRD=1.`);
    process.exit(1);
}

const log = (s: string): void => console.log(`[val-conciliacao] ${s}`);
const erroDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

interface Resultado {
    cenario: string;
    esperado: string;
    obtido: string;
    ok: boolean;
}

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const retorno = container.resolve(ConexosSispagRetornoClient);
    const servico = container.resolve(ConciliacaoRetornoService);
    const db = container.resolve(PostgreeDatabaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}${BASE.includes('-hml') ? ' (HML)' : ' (PRODUÇÃO)'}`);
    console.log(`MODO: ${EXECUTAR ? 'EXECUTAR' : 'DRY (só inspeciona)'} · filial ${FIL}`);
    console.log('='.repeat(78));

    // ── Achar um arquivo de retorno JÁ PROCESSADO ────────────────────────────
    // É o insumo do cenário mais importante: se o ERP já processou, a retomada tem que
    // PULAR o `processar` e seguir da leitura.
    const configs = await retorno.listConfigsRetorno({ filCod: FIL });
    let alvo:
        | { bncCod: number; gtbCodSeq: number; garCodSeq: number; processadoEm?: number }
        | undefined;
    for (const c of configs) {
        const arquivos = await retorno.listArquivosRetorno({
            filCod: FIL,
            bncCod: c.bncCod,
            gtbCodSeq: c.gtbCodSeq,
            pageSize: 200,
        });
        const escolhido = process.env.VAL_GAR
            ? arquivos.find((a) => a.garCodSeq === Number(process.env.VAL_GAR))
            : arquivos.find((a) => a.processadoEm);
        if (escolhido) {
            alvo = {
                bncCod: c.bncCod,
                gtbCodSeq: c.gtbCodSeq,
                garCodSeq: escolhido.garCodSeq,
                ...(escolhido.processadoEm !== undefined
                    ? { processadoEm: escolhido.processadoEm }
                    : {}),
            };
            break;
        }
    }

    if (!alvo) {
        console.error(
            `ABORTADO: nenhum arquivo de retorno processado na filial ${FIL}. ` +
                'Carregue e processe um .RET em HML (fin052) e rode de novo, ou passe VAL_GAR.',
        );
        process.exit(1);
    }
    log(
        `arquivo alvo: bnc=${alvo.bncCod} gtb=${alvo.gtbCodSeq} gar=${alvo.garCodSeq} ` +
            `processadoEm=${alvo.processadoEm ? new Date(alvo.processadoEm).toISOString().slice(0, 10) : 'NÃO'}`,
    );

    if (!EXECUTAR) {
        log('DRY — nada foi chamado. Rode com --executar contra HML para exercitar.');
        return;
    }

    const chave = {
        filCod: FIL,
        bncCod: alvo.bncCod,
        gtbCodSeq: alvo.gtbCodSeq,
        garCodSeq: alvo.garCodSeq,
    };
    const key = `conciliacao:${FIL}:${alvo.bncCod}:${alvo.gtbCodSeq}:${alvo.garCodSeq}`;
    const limparLedger = async (): Promise<void> => {
        await db.update(`DELETE FROM conciliacao_execucao WHERE idempotency_key = $key`, { key });
    };

    // Conta quantas vezes o `processar` REALMENTE foi chamado. É a métrica do gate.
    const original = retorno.processarArquivoRetorno;
    let chamadas = 0;
    (retorno as unknown as Record<string, unknown>).processarArquivoRetorno = async (
        p: unknown,
    ) => {
        chamadas += 1;
        return original(p as Parameters<typeof original>[0]);
    };

    const resultados: Resultado[] = [];
    const registrar = (r: Resultado): void => {
        resultados.push(r);
        console.log(`   ${r.ok ? 'OK  ' : 'FALHA'} · ${r.obtido}`);
    };

    // ── C1: ERP já processou → a retomada NÃO pode chamar `processar` de novo ──
    log('── C1 · arquivo já processado no ERP (não pode reprocessar)');
    try {
        await limparLedger();
        chamadas = 0;
        const r = await servico.conciliar({ ...chave, ator: 'val-conciliacao', processar: true });
        registrar({
            cenario: 'ja-processado-no-erp',
            esperado: '0 chamadas ao processar',
            obtido: `processar chamado ${chamadas}× · ${r.totalLinhas} linha(s) lidas · processado=${r.processado}`,
            ok: chamadas === 0 && r.processado === true,
        });
    } catch (e) {
        registrar({
            cenario: 'ja-processado-no-erp',
            esperado: '0 chamadas',
            obtido: `ERRO: ${erroDe(e)}`,
            ok: false,
        });
    }

    // ── C2: ledger `settled` → curto-circuito, nem lê o ERP ───────────────────
    log('── C2 · ledger já settled (curto-circuito idempotente)');
    try {
        chamadas = 0;
        const r = await servico.conciliar({ ...chave, ator: 'val-conciliacao', processar: true });
        registrar({
            cenario: 'ledger-settled',
            esperado: 'jaConciliado=true, 0 chamadas',
            obtido: `jaConciliado=${r.jaConciliado} · processar chamado ${chamadas}×`,
            ok: chamadas === 0 && r.jaConciliado === true,
        });
    } catch (e) {
        registrar({
            cenario: 'ledger-settled',
            esperado: 'curto-circuito',
            obtido: `ERRO: ${erroDe(e)}`,
            ok: false,
        });
    }

    // ── C3: órfão `reconciling` → consulta o ERP e decide, sem reprocessar ────
    log('── C3 · ledger órfão em reconciling (retomada por consulta)');
    try {
        await db.update(
            `UPDATE conciliacao_execucao
             SET status = 'reconciling', dry_run = FALSE, processou = TRUE, atualizado_em = now()
             WHERE idempotency_key = $key`,
            { key },
        );
        chamadas = 0;
        const r = await servico.conciliar({ ...chave, ator: 'val-conciliacao', processar: true });
        registrar({
            cenario: 'orfao-reconciling',
            esperado: '0 chamadas (o ERP diz que já processou)',
            obtido: `processar chamado ${chamadas}× · ${r.totalLinhas} linha(s)`,
            ok: chamadas === 0,
        });
    } catch (e) {
        registrar({
            cenario: 'orfao-reconciling',
            esperado: '0 chamadas',
            obtido: `ERRO: ${erroDe(e)}`,
            ok: false,
        });
    }

    (retorno as unknown as Record<string, unknown>).processarArquivoRetorno = original;

    console.log('');
    console.log('='.repeat(78));
    for (const r of resultados)
        console.log(`${r.ok ? '✅' : '❌'} ${r.cenario.padEnd(24)} ${r.obtido}`);
    const todosOk = resultados.every((r) => r.ok);
    console.log(todosOk ? 'GATE OK — nenhuma retomada reprocessou o arquivo.' : 'GATE REPROVADO.');
    console.log('='.repeat(78));
    if (!todosOk) process.exit(1);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[val-conciliacao] FATAL:', erroDe(e));
        process.exit(1);
    });

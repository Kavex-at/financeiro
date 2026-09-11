import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosTitulosClient from '../domain/client/ConexosTitulosClient.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import PermutaAlocacaoRepository from '../domain/repository/permutas/PermutaAlocacaoRepository.js';
import ReconciliacaoPermutaService from '../domain/service/permutas/ReconciliacaoPermutaService.js';

/**
 * RETENTATIVA ASSISTIDA de uma permuta que falhou — com PRÉ-VOO read-only.
 *
 * Contexto: o fix de 2026-09-11 (I-Write-9) fez a baixa distribuir o valor alocado pelo
 * EM-ABERTO de cada parcela e pular parcela já quitada. As permutas que quebraram com
 * "título <inv>/1 sem valor em aberto no ERP" ficaram pendentes no painel; esta sonda
 * re-executa UMA delas sob revisão humana.
 *
 * DOIS MODOS:
 *
 *   PRÉ-VOO (padrão, `MODE` ausente ou `preflight`) — **nenhuma escrita**. Lê as parcelas da
 *   invoice no ERP, aplica a MESMA regra do fix (`aberto = face − pago/taxa`, pula ≈0) e
 *   imprime em qual parcela cada centavo cairia. É o que confirma o conserto ANTES do POST:
 *   o `dryRun` do serviço monta o payload por outro caminho (`buildPreviewPayload`) e NÃO
 *   mostra o roteamento por parcela — por isso o pré-voo existe.
 *
 *   EXECUÇÃO (`MODE=execute`) — escrita REAL no `fin010`: cria borderô, posta a(s) baixa(s).
 *   Irreversível pelo app (o estorno é manual, no Conexos). Só rode com o analista junto.
 *
 * Run:
 *   cd src/backend
 *   PERMUTA_ADTO=4471 npx tsx jobs/retry-permuta-com-erro.ts                  # pré-voo
 *   PERMUTA_ADTO=4471 MODE=execute npx tsx jobs/retry-permuta-com-erro.ts     # escreve
 *   # data do borderô (período contábil aberto): PERMUTA_DATA=2026-09-11
 */
const ADTO = process.env.PERMUTA_ADTO ?? '';
const MODE = process.env.MODE ?? 'preflight';
const EXECUTADO_POR = process.env.PERMUTA_EXECUTADO_POR ?? 'retry-assistido@kavex.com';
/** Epsilon do fechamento em moeda negociada — o mesmo do serviço. */
const TOLERANCIA = 0.005;

const round2 = (n: number): number => Math.round(n * 100) / 100;

const num = (n: unknown, casas = 2): string =>
    Number(n ?? 0).toLocaleString('pt-BR', {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
    });

/** Meia-noite UTC do dia informado (ou de hoje) — mesma convenção do `criarBordero`. */
const dataMovtoEpoch = (): number => {
    const iso = process.env.PERMUTA_DATA;
    const d = iso ? new Date(`${iso}T00:00:00.000Z`) : new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const main = async (): Promise<void> => {
    if (!ADTO) throw new Error('defina PERMUTA_ADTO=<adiantamentoDocCod>');
    await bootstrapAppContainer();
    const titulos = container.resolve(ConexosTitulosClient);
    const alocacaoRepository = container.resolve(PermutaAlocacaoRepository);
    const db = container.resolve(PostgreeDatabaseClient);

    const dataMovto = dataMovtoEpoch();
    console.log('═'.repeat(78));
    console.log(`RETENTATIVA — adiantamento ${ADTO}`);
    console.log(
        `modo: ${MODE.toUpperCase()} · data do borderô: ${new Date(dataMovto).toISOString().slice(0, 10)}`,
    );
    console.log('═'.repeat(78));

    // ── Estado atual no nosso ledger ────────────────────────────────────────────
    const execs = await db.selectMany(
        `SELECT idempotency_key, invoice_doc_cod, fil_cod, status, bor_cod, valor_baixado,
                erro_mensagem, criado_em
           FROM permuta_alocacao_execucao
          WHERE adiantamento_doc_cod = $adto
          ORDER BY criado_em`,
        { adto: ADTO },
    );
    console.log(`\nledger (${execs.length} execução/ões):`);
    for (const e of execs) {
        console.log(
            `  · inv ${e.invoice_doc_cod}  ${e.status}  bor ${e.bor_cod ?? '—'}  ` +
                `${new Date(e.criado_em).toISOString().slice(0, 10)}` +
                (e.erro_mensagem ? `\n      ${String(e.erro_mensagem).slice(0, 100)}` : ''),
        );
    }

    const alocacoes = (await alocacaoRepository.listAtivas()).filter(
        (a) => a.adiantamentoDocCod === ADTO,
    );
    if (alocacoes.length === 0) throw new Error(`sem alocação ativa para o adiantamento ${ADTO}`);

    // ── PRÉ-VOO — a decisão de roteamento por parcela, sem tocar no ERP ──────────
    console.log('\n── PRÉ-VOO (read-only): para onde cada centavo vai ──');
    let bloqueado = false;
    for (const aloc of alocacoes) {
        const filCod = Number(execs.find((e) => e.invoice_doc_cod === aloc.invoiceDocCod)?.fil_cod);
        console.log(
            `\n  alocação ${ADTO} → invoice ${aloc.invoiceDocCod} (filial ${filCod}): ` +
                `${num(aloc.valorAlocado)} ${aloc.moeda ?? ''} @ taxa ${aloc.taxaInvoice}`,
        );
        const parcelas = await titulos.listTitulosAPagar({
            docCod: aloc.invoiceDocCod,
            filCod,
        });
        // MESMA regra do fix: em-aberto = face − pago/taxa; parcela ≈0 fica fora.
        const abertas = parcelas
            .map((t) => {
                const face = t.valorNegociado ?? 0;
                const taxa = t.taxa ?? 0;
                const aberto = taxa > 0 ? round2(face - (t.valorPago ?? 0) / taxa) : face;
                return { titCod: Number(t.titCod), face, taxa, aberto, pago: t.pago };
            })
            .sort((a, b) => a.titCod - b.titCod);
        for (const p of abertas) {
            const marca = p.aberto > TOLERANCIA ? '○ ABERTA  ' : '● quitada ';
            console.log(
                `    ${marca} tit ${p.titCod}  face ${num(p.face)}  em-aberto ${num(p.aberto)}  (pago=${p.pago})`,
            );
        }
        // Simula a distribuição do laço corrigido.
        let restante = aloc.valorAlocado;
        const plano: string[] = [];
        for (const p of abertas.filter((x) => x.aberto > TOLERANCIA)) {
            if (restante <= TOLERANCIA) break;
            const usa = Math.min(restante, p.aberto);
            plano.push(
                `tit ${p.titCod} ← ${num(usa)} ${aloc.moeda ?? ''} (BRL ${num(round2(usa * p.taxa))})`,
            );
            restante = round2(restante - usa);
        }
        console.log(`    ⇒ plano: ${plano.length > 0 ? plano.join(' · ') : '(nada a baixar)'}`);
        if (restante > TOLERANCIA) {
            bloqueado = true;
            console.log(
                `    ⚠ SOBRA ${num(restante)} sem parcela aberta para receber — a execução ficaria PARCIAL.`,
            );
        }
        if (plano.length === 0) {
            bloqueado = true;
            console.log('    ⚠ nenhuma parcela aberta — NÃO execute; conferir no ERP.');
        }
    }

    if (MODE !== 'execute') {
        console.log(
            '\n── fim do pré-voo. Nenhuma escrita foi feita. ──\n' +
                `Para executar de verdade: PERMUTA_ADTO=${ADTO} MODE=execute npx tsx jobs/retry-permuta-com-erro.ts`,
        );
        await db.close();
        return;
    }

    if (bloqueado) {
        console.log('\n✗ ABORTADO: o pré-voo apontou pendência acima. Nada foi escrito.');
        await db.close();
        process.exitCode = 1;
        return;
    }

    // ── EXECUÇÃO REAL ───────────────────────────────────────────────────────────
    console.log('\n── EXECUÇÃO REAL no fin010 (cria borderô e posta baixa) ──');
    const service = container.resolve(ReconciliacaoPermutaService);
    const out = await service.reconciliar({
        adiantamentoDocCod: ADTO,
        executadoPor: EXECUTADO_POR,
        dataMovto,
    });
    console.log(
        `\nwriteEnabled=${out.writeEnabled} dryRun=${out.dryRun} borCod=${out.borCod ?? '—'}`,
    );
    for (const r of out.resultados) {
        console.log(
            `  · inv ${r.invoiceDocCod}  ${r.status}  bor ${r.borCod ?? '—'}  ` +
                `bxaCodSeq ${r.bxaCodSeq ?? '—'}  baixado ${num(r.valorBaixado)}` +
                (r.valorResidualUsd ? `  resíduo ${num(r.valorResidualUsd)}` : '') +
                (r.erro ? `\n      ERRO: ${r.erro}` : ''),
        );
    }
    await db.close();
};

main().catch((err) => {
    console.error('falha na retentativa:', err);
    process.exit(1);
});

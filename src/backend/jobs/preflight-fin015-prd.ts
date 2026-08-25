import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * PRÉ-VOO READ-ONLY — escolhe o título para o teste de geração de `.REM` em PRODUÇÃO.
 *
 * NÃO ESCREVE NADA. Só `list`/`GET`. Serve para levar uma lista de candidatos para a
 * conversa com a Columbia ANTES de qualquer escrita no ERP de produção.
 *
 * Aplica, de uma vez, todas as restrições que descobrimos ao provar o ciclo em HML:
 *
 *   1. **Mesma filial** do lote — o parser do `.RET` exige
 *      `FIN_ITEM_SISPAG.FIL_COD = FIN_LOTE_SISPAG.FIL_COD`; item cross-filial nunca concilia.
 *   2. **Vencimento ≥ hoje** — R1 (data de débito ≥ hoje) + a regra do `finalizarLote`
 *      (`itsDtaPgto` do item ≥ data de débito do lote) tornam título VENCIDO inelegível.
 *   3. **Favorecido com conta ATIVA no banco do lote** (`cmn025/ctcorr`) — sem isso o ERP
 *      interrompe o import com o protocolo de PERGUNTA
 *      (`FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO...`).
 *   4. **Liberado nas 3 alçadas** (`titVld1/2/3libera = 1`).
 *   5. **Valor abaixo do teto** (`TETO`, default R$ 100) — em produção o teste tem que ser
 *      irrelevante financeiramente. Em HML operei sem querer um título de R$ 6,6 milhões.
 *
 * Run:
 *   cd src/backend
 *   PROBE_PRD=1 FIL=2 BNC=4 CCO=2 TETO=100 npx tsx jobs/preflight-fin015-prd.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Read-only em PRD: passe PROBE_PRD=1.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/preflight-fin015';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const CCO = Number(process.env.CCO ?? 0);
const TETO = Number(process.env.TETO ?? 100);
const MAX_LOOKUPS = Number(process.env.MAX_LOOKUPS ?? 60);

/** Código FEBRABAN por `bncCod` interno do Conexos. */
const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };

type Row = Record<string, unknown>;
const brl = (n: unknown): string =>
    Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (v: unknown): string =>
    typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : '—';
const hojeUtc = (): number => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}  ${IS_HML ? '(HML)' : '*** PRODUÇÃO — SOMENTE LEITURA ***'}`);
    console.log(
        `ALVO: filial ${FIL} · banco ${BNC} (FEBRABAN ${FEBRABAN[BNC] ?? '?'}) · teto ${brl(TETO)}`,
    );
    console.log('='.repeat(78));
    await base.ensureSid();

    // ── 1) conta pagadora (fin005) — nunca hardcoded, varia por filial ───────
    const { rows: contas } = await base.listGenericPaginated<Row>(
        'fin005/list',
        { fieldList: [], filterList: {}, serviceName: 'fin005', pageNumber: 1, pageSize: 100 },
        { filCod: FIL },
    );
    const doBanco = contas.filter((c) => Number(c.bncCod) === BNC);
    const conta = CCO ? contas.find((c) => Number(c.ccoCod) === CCO) : doBanco[0];
    console.log(`\n1) CONTAS PAGADORAS da filial ${FIL} no banco ${BNC}:`);
    for (const c of doBanco) {
        const marca = conta && Number(c.ccoCod) === Number(conta.ccoCod) ? ' ← seria usada' : '';
        console.log(
            `   ccoCod=${c.ccoCod} ag ${c.ccoEspAgcod} cc ${c.ccoNumConta}-${c.ccoEspDvconta} · conta financeira ${c.gerNum} "${c.gerDes}"${marca}`,
        );
    }
    if (!conta) {
        console.log('   NENHUMA conta pagadora encontrada — impossível montar lote. Fim.');
        return;
    }

    // ── 2) um lote existente só para PARAMETRIZAR a lista de pendentes ───────
    const { rows: lotes } = await base.listGenericPaginated<Row>(
        'fin015/list',
        { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 50 },
        { filCod: FIL },
    );
    const contexto = lotes.find((l) => Number(l.bncCod) === BNC) ?? lotes[0];
    if (!contexto) {
        console.log('\n2) nenhum lote existente para usar de contexto na listagem. Fim.');
        return;
    }
    const flpCtx = Number(contexto.flpCod);
    console.log(`\n2) usando o lote ${flpCtx} apenas como contexto de LEITURA dos pendentes`);

    // PAGINA DE VERDADE: uma página de 500 dá a ilusão de "só existem 500" e esconde
    // justamente os títulos de valor baixo, que é o que o teste precisa.
    const pendentes: Row[] = [];
    for (let pagina = 1; pagina <= 40; pagina += 1) {
        const { rows, count } = await base.listGenericPaginated<Row>(
            `fin015/finItemSispag/titulosPendentes/list/${FIL}/${BNC}/${flpCtx}`,
            {
                fieldList: [],
                filterList: {},
                serviceName: 'fin015',
                pageNumber: pagina,
                pageSize: 500,
            },
            { filCod: FIL },
        );
        pendentes.push(...rows);
        if (pagina === 1) console.log(`   ${count} título(s) pendente(s) segundo o ERP`);
        if (rows.length < 500 || pendentes.length >= count) break;
    }
    console.log(`   ${pendentes.length} carregado(s) em memória`);

    // ── 3) funil das restrições ──────────────────────────────────────────────
    const hoje = hojeUtc();
    const liberado = (p: Row): boolean =>
        Number(p.titVld1libera) === 1 &&
        Number(p.titVld2libera) === 1 &&
        Number(p.titVld3libera) === 1;

    const etapas: Array<{ nome: string; restam: number }> = [];
    let f = pendentes.filter((p) => Number(p.filCod) === FIL);
    etapas.push({ nome: `filial ${FIL} (mesma do lote)`, restam: f.length });
    f = f.filter((p) => Number(p.titDtaVencimento) >= hoje);
    etapas.push({ nome: 'vencimento ≥ hoje', restam: f.length });
    f = f.filter(liberado);
    etapas.push({ nome: 'liberado nas 3 alçadas', restam: f.length });
    f = f.filter((p) => Number(p.titMnyValor) > 0 && Number(p.titMnyValor) <= TETO);
    etapas.push({ nome: `valor ≤ ${brl(TETO)}`, restam: f.length });

    console.log('\n3) FUNIL:');
    for (const e of etapas) console.log(`   ${String(e.restam).padStart(5)} ← ${e.nome}`);

    if (f.length === 0) {
        console.log(`\n   Nenhum candidato com teto de ${brl(TETO)}. Aumente TETO e rode de novo.`);
        const semTeto = pendentes
            .filter(
                (p) =>
                    Number(p.filCod) === FIL && Number(p.titDtaVencimento) >= hoje && liberado(p),
            )
            .sort((a, b) => Number(a.titMnyValor) - Number(b.titMnyValor));
        if (semTeto.length > 0) {
            console.log('   Os 5 menores valores elegíveis (sem teto):');
            for (const p of semTeto.slice(0, 5)) {
                console.log(
                    `      doc ${p.docCod}/${p.titCod} · ${brl(p.titMnyValor)} · venc ${dia(p.titDtaVencimento)} · ${p.dpeNomPessoa}`,
                );
            }
        }
        return;
    }

    // ── 4) conta bancária do favorecido no banco DO LOTE ─────────────────────
    const febraban = FEBRABAN[BNC] ?? 341;
    const candidatos: Row[] = [];
    console.log(
        `\n4) checando conta do favorecido no banco ${febraban} (até ${MAX_LOOKUPS} consultas):`,
    );
    for (const p of f
        .sort((a, b) => Number(a.titMnyValor) - Number(b.titMnyValor))
        .slice(0, MAX_LOOKUPS)) {
        if (p.pesCod == null) continue;
        try {
            const { rows: ctas } = await base.listGenericPaginated<Row>(
                'cmn025/ctcorr/list',
                {
                    fieldList: [],
                    filterList: { 'pesCod#EQ': p.pesCod },
                    serviceName: 'cmn025',
                    pageNumber: 1,
                    pageSize: 50,
                },
                { filCod: FIL },
            );
            const ativas = ctas.filter((c) => Number(c.pctVldStatus) === 1);
            const noBanco = ativas.filter((c) => Number(c.pctNumBanco) === febraban);
            if (noBanco.length === 0) continue;
            const escolhida = noBanco.find((c) => Number(c.pctVldDefault) === 1) ?? noBanco[0];
            candidatos.push({ ...p, _conta: escolhida });
            if (candidatos.length >= 10) break;
        } catch {
            // favorecido sem cadastro acessível — ignora
        }
    }

    if (candidatos.length === 0) {
        console.log('   Nenhum favorecido elegível tem conta ativa neste banco.');
        console.log('   Opções: outro banco (BNC=), teto maior (TETO=), ou sanear cadastro.');
        return;
    }

    console.log(`\n${'='.repeat(78)}`);
    console.log(`CANDIDATOS — ${candidatos.length} título(s) aptos ao teste`);
    console.log('='.repeat(78));
    candidatos.forEach((c, i) => {
        const ct = c._conta as Row;
        console.log(
            `${String(i + 1).padStart(2)}. doc ${c.docCod}/${c.titCod} · ${brl(c.titMnyValor)} · venc ${dia(c.titDtaVencimento)}`,
        );
        console.log(`     favorecido: ${c.dpeNomPessoa} (pesCod ${c.pesCod})`);
        console.log(
            `     destino: banco ${ct.pctNumBanco} ag ${ct.pctEspNumAgencia} cc ${ct.pctEspNumContaBanc}-${ct.pctEspDvconta ?? ''} (pctCodSeq ${ct.pctCodSeq}${Number(ct.pctVldDefault) === 1 ? ', default' : ''})`,
        );
    });
    writeFileSync(`${OUT}/candidatos.json`, JSON.stringify(candidatos, null, 2));

    // ── 5) o plano de escrita, explícito ─────────────────────────────────────
    const alvo = candidatos[0];
    console.log(`\n${'='.repeat(78)}`);
    console.log('O QUE A EXECUÇÃO FARIA (nada disso foi feito agora)');
    console.log('='.repeat(78));
    console.log(
        `  título   : doc ${alvo.docCod}/${alvo.titCod} · ${brl(alvo.titMnyValor)} · ${alvo.dpeNomPessoa}`,
    );
    console.log(`  lote     : filial ${FIL}, banco ${BNC}, conta pagadora ccoCod ${conta.ccoCod}`);
    console.log(
        `             (ag ${conta.ccoEspAgcod} cc ${conta.ccoNumConta}-${conta.ccoEspDvconta}, conta financeira ${conta.gerNum})`,
    );
    console.log(`  débito   : ${dia(hoje)}  (R1: ≥ hoje · R2: ≤ ${dia(alvo.titDtaVencimento)})`);
    console.log('\n  4 ESCRITAS no ERP de produção:');
    console.log('    1. POST fin015                          → cria o lote (novo flpCod)');
    console.log('    2. POST finItemSispag/.../importar      → inclui o título no lote');
    console.log('    3. GET  fin015/finalizarLote/...        → finaliza (valida R1/R2)');
    console.log('    4. POST gerArquivosBancos/gerarRemessa  → gera o .REM (novo gabCod)');
    console.log('\n  DESFAZER, na mesma sessão:');
    console.log('    PUT fin015/gerArquivosBancos/cancelar/{gabCod}   → cancela o arquivo');
    console.log('    GET fin015/cancelarLote/{fil}/{bnc}/{flp}        → cancela o lote');
    console.log('    GET fin015/estornarLote/{fil}/{bnc}/{flp}        → estorna, se preciso');
    console.log('\n  ⚠️  O .REM NÃO é entregue a banco nenhum: o ERP não transmite remessa de');
    console.log('      pagamento — o transporte é externo (Nexxera/portal). CONFIRMAR com a');
    console.log('      Columbia que não há robô que recolha arquivos gerados no fin015.');
    console.log(`\nartefatos em ${OUT}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[preflight] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

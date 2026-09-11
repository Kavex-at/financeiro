import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosBaixaClient from '../domain/client/ConexosBaixaClient.js';
import ConexosTitulosClient from '../domain/client/ConexosTitulosClient.js';
import PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';

/**
 * SONDA READ-ONLY — por que o 2º adiantamento de um grupo falha com
 * `bxaMnyValor=0` / `anti-drift`?
 *
 * PERGUNTA (dúvida aberta da investigação 2026-09-10): quando um grupo da aba
 * "Automáticas" tem N adiantamentos casados com a MESMA invoice, o 1º liquida e os
 * demais estouram em `ReconciliacaoPermutaService.baixarTitulo` (:500 e :511). Duas
 * hipóteses explicam o mesmo sintoma:
 *
 *   (A) SEMÂNTICA DO ERP — a baixa de permuta FECHA o título inteiro, independentemente
 *       do valor postado. Então a 1ª baixa zera o em-aberto e as demais não têm onde cair.
 *       Assinatura: Σ(baixas do título no ERP) << mnyTitValor, mas mnyTitAberto = 0.
 *
 *   (B) SALDO JÁ PEQUENO — o em-aberto vivo do título já era menor que o valor de FACE
 *       contra o qual o rateio foi calculado (outras baixas anteriores, ou drift entre a
 *       ingestão e o clique). A 1ª baixa consome legitimamente 100% do que restava.
 *       Assinatura: Σ(baixas do título no ERP) ≈ mnyTitValor, com baixas ANTERIORES às nossas.
 *
 * A distinção decide o conserto: (A) ⇒ executar UMA baixa por invoice consolidando os
 * adtos do grupo; (B) ⇒ capar o rateio no `valorAbertoNegociado` VIVO e re-ratear no
 * momento do clique (hoje o caminho sintético usa a face —
 * `GestaoPermutasService.ts:159`, `valorASerUsado: inv.valorMoedaNegociada`).
 *
 * O QUE A SONDA FAZ: para cada invoice que já falhou, lê do Conexos o detalhe do título
 * (`com298/<docCod>` → mnyTitValor/mnyTitAberto/mnyTitPermuta) e a lista COMPLETA de
 * baixas (`com308/financeiroAPagar/baixas/list`), e cruza com o nosso ledger
 * (`permuta_alocacao_execucao`) + os rascunhos (`permuta_alocacao`). Emite um veredito
 * (A) / (B) / (INDEFINIDO) por invoice.
 *
 * SEGURANÇA: exclusivamente leitura — `getDetalheTitulos` e `listBaixasTitulo` no
 * Conexos (as mesmas chamadas que a eleição já faz) e SELECTs no Postgres. Nenhum POST
 * de escrita, PUT, DELETE, nem criação de borderô. NÃO chama `validarTituloBaixa`, que
 * exigiria um borderô real.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * CONCLUSÃO (2026-09-11, prod) — CAUSA-RAIZ ENCONTRADA. (A), (B) e (E) refutadas.
 *
 * O gatilho NÃO é "ter 2+ adiantamentos". Dos 21 grupos multi-adto do banco, 17
 * liquidaram inteiros — inclusive a invoice 28260 com OITO adiantamentos. O que separa
 * os que passam dos que quebram é o número de PARCELAS (títulos) da invoice:
 *
 *   passam  → invoice de 1 parcela: 28260 (8 adtos), 23191 (3), 17618 (3), 29900 (5)
 *   quebram → invoice de 2 parcelas: 7144, 4755, 4803
 *
 * Medido no ERP (fase 3), a invoice que quebra tem as parcelas casando 1:1 com as
 * alocações — e a parcela 1 já foi quitada pelo 1º adiantamento:
 *
 *   invoice 7144  tit 1 face 7.685,12 PAGO (aberto 0) · tit 2 face 31.814,88 ABERTO
 *                 adto 4635 alocou 7.685,12 (settled) · adto 6833 alocou 31.814,88 (ERRO)
 *   invoice 4755  tit 1 face 3.286,14 PAGO (aberto 0) · tit 2 face 29.575,24 ABERTO
 *                 adto 3211 alocou 3.286,14 (settled) · adto 4471 alocou 29.575,24 (ERRO)
 *
 * ⇒ BUG: o laço que distribui o valor alocado entre as parcelas
 *   (`ReconciliacaoPermutaService.ts:543-545`) usa `t.usd`, a FACE da parcela, e NÃO pula
 *   parcela já quitada:
 *
 *       for (const t of titulos) {                       // sempre começa na parcela 1
 *           const usdTitulo = Math.min(restanteUsd, t.usd);   // face, não em-aberto
 *
 *   Para o adto 6833 (alocado 31.814,88) isso vira `min(31.814,88 , 7.685,12) = 7.685,12`
 *   na parcela 1 — que está quitada. O ERP devolve `bxaMnyValor=0` e o guard I-Write-1
 *   (`:500-504`) lança "título 7144/1 sem valor em aberto no ERP". Bate com a mensagem
 *   exata do ledger. O dinheiro estava na parcela 2 o tempo todo.
 *
 *   A ironia: o em-aberto POR PARCELA já é calculado 60 linhas antes, em `assertCobertura`
 *   (`:686`, `abertoUsd = t.usd - pagoBrl/taxa`) — e é descartado ali. A cobertura passa
 *   (31.814,88 ≥ 31.814,88, correto) e a distribuição erra o alvo.
 *
 * CORREÇÃO indicada: no laço, derivar `abertoUsd` por parcela (mesma fórmula da cobertura),
 * pular parcela com aberto ≈ 0 e capar em `min(restanteUsd, abertoUsd)`.
 *
 * NOTA sobre o `bor_cod` das linhas com erro (a pista falsa da rodada anterior): quando
 * TODAS as baixas falham, `removerBorderoOrfao` (`:385-387`) APAGA o borderô — mas o
 * `markError` já gravou o `bor_cod` antes. O número fica pendurado e o ERP o reaproveita
 * depois, então o painel mostra ao analista um borderô que hoje é de outro fornecedor
 * (2771 → doc 6708; 2436 → doc 5155). É bug de rastro, não a causa da falha.
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Run:
 *   cd src/backend
 *   npx tsx jobs/probe-permuta-titulo-emaberto.ts
 *   # opcional: PROBE_INVOICES=7144:4,32496:2 (docCod:filCod) p/ restringir a amostra
 */
const OUT = process.env.PROBE_OUT ?? '/tmp/permuta-titulo-emaberto';

/** Tolerância (BRL) para comparar somas — ruído de arredondamento do ERP. */
const TOL = 1;

const brl = (n: unknown): string =>
    Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const iso = (d?: Date): string => (d ? d.toISOString().slice(0, 10) : '—');

interface Alvo {
    invoiceDocCod: string;
    filCod: number;
}

interface ExecucaoRow {
    adiantamento_doc_cod: string;
    invoice_doc_cod: string;
    status: string;
    bor_cod: string | null;
    valor_baixado: string | null;
    erro_mensagem: string | null;
    criado_em: Date;
}

interface AlocacaoRow {
    adiantamento_doc_cod: string;
    valor_alocado: string;
    taxa_invoice: string | null;
    atualizado_em: Date;
}

/**
 * Amostra: invoices com >= 2 execuções onde pelo menos uma liquidou e pelo menos uma
 * falhou — exatamente o sintoma reportado. Lida do próprio ledger (sem hardcode).
 */
const descobrirAlvos = async (db: PostgreeDatabaseClient): Promise<Alvo[]> => {
    const override = process.env.PROBE_INVOICES;
    if (override) {
        return override
            .split(',')
            .map((par) => par.trim().split(':'))
            .filter((p) => p.length === 2)
            .map(([invoiceDocCod, fil]) => ({ invoiceDocCod, filCod: Number(fil) }));
    }
    const rows = await db.selectMany(
        `SELECT invoice_doc_cod, min(fil_cod) AS fil_cod
           FROM permuta_alocacao_execucao
          GROUP BY invoice_doc_cod
         HAVING count(*) FILTER (WHERE status = 'settled') >= 1
            AND count(*) FILTER (WHERE status = 'error') >= 1
          ORDER BY invoice_doc_cod`,
    );
    return rows.map((r) => ({
        invoiceDocCod: String(r.invoice_doc_cod),
        filCod: Number(r.fil_cod),
    }));
};

const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const titulos = container.resolve(ConexosTitulosClient);
    const base = container.resolve(ConexosBaseClient);
    const baixas = container.resolve(ConexosBaixaClient);
    const db = container.resolve(PostgreeDatabaseClient);

    const alvos = await descobrirAlvos(db);
    console.log(`início — ${alvos.length} invoice(s) com settled+error no ledger\n`);

    const relatorio: Record<string, unknown>[] = [];

    for (const { invoiceDocCod, filCod } of alvos) {
        console.log('═'.repeat(78));
        console.log(`INVOICE ${invoiceDocCod} (filial ${filCod})`);

        // ── 1. Detalhe do título no ERP (face / em-aberto / permutado) ──────────
        let detalhe: Awaited<ReturnType<ConexosTitulosClient['getDetalheTitulos']>> = {};
        try {
            detalhe = await titulos.getDetalheTitulos({ docCod: invoiceDocCod, filCod });
        } catch (err) {
            console.log(`  ⚠ falha ao ler com298: ${(err as Error).message}`);
        }
        const face = detalhe.valorTotal;
        const aberto = detalhe.valorAberto;
        const permutado = detalhe.valorPermutado;
        console.log(
            `  ERP hoje → face ${brl(face)} | em-aberto ${brl(aberto)} | permutado ${brl(permutado)}`,
        );

        // ── 2. TODAS as baixas do título no ERP (inclusive as que não são nossas) ─
        let baixasTit: Awaited<ReturnType<ConexosTitulosClient['listBaixasTitulo']>> = [];
        try {
            baixasTit = await titulos.listBaixasTitulo({
                docCod: invoiceDocCod,
                titCod: '1',
                filCod,
            });
        } catch (err) {
            console.log(`  ⚠ falha ao listar baixas: ${(err as Error).message}`);
        }
        const somaBaixas = baixasTit.reduce((s, b) => s + (b.bxaMnyValor || b.valor || 0), 0);
        console.log(`  baixas no ERP: ${baixasTit.length} · soma ${brl(somaBaixas)}`);
        for (const b of baixasTit) {
            console.log(
                `    · ${iso(b.borDtaMvto)}  ger ${b.gerNum}  principal ${brl(b.bxaMnyValor)}  líquido ${brl(b.valor)}`,
            );
        }

        // ── 3. Nosso ledger + rascunhos ────────────────────────────────────────
        const execs = (await db.selectMany(
            `SELECT adiantamento_doc_cod, invoice_doc_cod, status, bor_cod, valor_baixado,
                    erro_mensagem, criado_em
               FROM permuta_alocacao_execucao
              WHERE invoice_doc_cod = $invoiceDocCod
              ORDER BY criado_em`,
            { invoiceDocCod },
        )) as ExecucaoRow[];
        const alocs = (await db.selectMany(
            `SELECT adiantamento_doc_cod, valor_alocado, taxa_invoice, atualizado_em
               FROM permuta_alocacao
              WHERE invoice_doc_cod = $invoiceDocCod
              ORDER BY adiantamento_doc_cod`,
            { invoiceDocCod },
        )) as AlocacaoRow[];

        const nossasSettled = execs.filter((e) => e.status === 'settled');
        const somaNossas = nossasSettled.reduce((s, e) => s + Number(e.valor_baixado ?? 0), 0);
        const somaAlocadaBrl = alocs.reduce(
            (s, a) => s + Number(a.valor_alocado) * Number(a.taxa_invoice ?? 0),
            0,
        );
        console.log(
            `  nosso ledger → ${nossasSettled.length} settled (${brl(somaNossas)}) · ` +
                `${execs.filter((e) => e.status === 'error').length} error`,
        );
        console.log(
            `  rascunhos    → ${alocs.length} alocação(ões) · soma alocada ${brl(somaAlocadaBrl)}`,
        );
        for (const e of execs) {
            const marca = e.status === 'settled' ? '✓' : e.status === 'error' ? '✗' : '·';
            console.log(
                `    ${marca} adto ${e.adiantamento_doc_cod}  ${e.status}  bor ${e.bor_cod ?? '—'}  ` +
                    `${brl(e.valor_baixado)}  ${iso(e.criado_em)}` +
                    (e.erro_mensagem ? `\n        ${e.erro_mensagem.slice(0, 110)}` : ''),
            );
        }

        // ── 4. Veredito ────────────────────────────────────────────────────────
        // Baixas no ERP que NÃO são nossas: as que não batem com nenhum valor_baixado.
        const valoresNossos = nossasSettled.map((e) => Number(e.valor_baixado ?? 0));
        const alheias = baixasTit.filter(
            (b) => !valoresNossos.some((v) => Math.abs(v - (b.bxaMnyValor || b.valor || 0)) <= TOL),
        );
        const somaAlheias = alheias.reduce((s, b) => s + (b.bxaMnyValor || b.valor || 0), 0);

        let veredito: string;
        let hipotese: 'A' | 'B' | 'INDEFINIDO';
        if (face === undefined || aberto === undefined) {
            hipotese = 'INDEFINIDO';
            veredito = 'com298 não devolveu face/em-aberto — sem base para decidir.';
        } else if (aberto <= TOL && face - somaBaixas > TOL) {
            hipotese = 'A';
            veredito =
                `título FECHADO (em-aberto ${brl(aberto)}) mas as baixas somam só ${brl(somaBaixas)} ` +
                `de ${brl(face)} — o ERP encerrou o título sem consumir o valor todo. ` +
                `⇒ a baixa de permuta fecha o título inteiro; um grupo N:1 precisa de UMA baixa consolidada.`;
        } else if (Math.abs(face - somaBaixas) <= Math.max(TOL, face * 0.005)) {
            hipotese = 'B';
            veredito =
                `baixas somam ${brl(somaBaixas)} ≈ face ${brl(face)} — o título foi consumido de verdade. ` +
                (somaAlheias > TOL
                    ? `${alheias.length} baixa(s) de ${brl(somaAlheias)} NÃO são nossas ⇒ o em-aberto já era menor ` +
                      `que a face quando o rateio foi calculado.`
                    : `todas as baixas são nossas ⇒ o rateio excedeu o em-aberto vivo.`);
        } else {
            hipotese = 'INDEFINIDO';
            veredito =
                `em-aberto ${brl(aberto)} · baixas ${brl(somaBaixas)} · face ${brl(face)} — ` +
                `não encaixa limpo em (A) nem (B); conferir à mão.`;
        }
        console.log(`\n  ▶ HIPÓTESE ${hipotese}: ${veredito}`);

        relatorio.push({
            invoiceDocCod,
            filCod,
            erp: { face, aberto, permutado, baixas: baixasTit.length, somaBaixas },
            nosso: {
                settled: nossasSettled.length,
                somaSettled: somaNossas,
                erros: execs.filter((e) => e.status === 'error').length,
                alocacoes: alocs.length,
                somaAlocadaBrl,
            },
            baixasAlheias: { qtd: alheias.length, soma: somaAlheias },
            hipotese,
            veredito,
        });
        console.log('');
    }

    // ── FASE 2 — as invoices INDEFINIDAS: o título TEM saldo, então por que o ERP
    // respondeu `bxaMnyValor=0`? Hipótese (C): borderôs EM CADASTRO (não finalizados)
    // de tentativas anteriores seguem RESERVANDO o saldo do título. A `listBaixasTitulo`
    // filtra `borVldFinalizado#IN:[1]`, então uma reserva dessas é invisível na fase 1.
    const indefinidas = relatorio.filter((r) => r.hipotese === 'INDEFINIDO');
    if (indefinidas.length > 0) {
        console.log('═'.repeat(78));
        console.log(`FASE 2 — ${indefinidas.length} invoice(s) INDEFINIDA(s): caçando reservas\n`);
    }
    for (const r of indefinidas) {
        const invoiceDocCod = String(r.invoiceDocCod);
        const filCod = Number(r.filCod);
        console.log('─'.repeat(78));
        console.log(`INVOICE ${invoiceDocCod} (filial ${filCod})`);

        // 2a. Baixas do título SEM o filtro de finalizado — inclui borderô em cadastro.
        try {
            const todas = await base.paginate<Record<string, unknown>>({
                endpoint: `com308/financeiroAPagar/baixas/list/${invoiceDocCod}/1/0`,
                bodyBase: {
                    fieldList: [],
                    filterList: { 'borVldFinalizado#IN': [0, 1] },
                    orderList: { orderList: [{ propertyName: 'borCod', order: 'asc' }] },
                },
                opts: { filCod },
            });
            console.log(`  baixas do título (finalizadas + EM CADASTRO): ${todas.length}`);
            for (const b of todas) {
                console.log(
                    `    · bor ${String(b.borCod)}  finalizado=${String(b.borVldFinalizado)}  ` +
                        `principal ${brl(b.bxaMnyValor)}  líquido ${brl(b.bxaMnyLiquido)}`,
                );
            }
        } catch (err) {
            console.log(`  ⚠ falha ao listar baixas sem filtro: ${(err as Error).message}`);
        }

        // 2b. O que há DENTRO do borderô que a execução com erro criou?
        const comErro = (await db.selectMany(
            `SELECT adiantamento_doc_cod, bor_cod, status, erro_mensagem, criado_em
               FROM permuta_alocacao_execucao
              WHERE invoice_doc_cod = $invoiceDocCod AND bor_cod IS NOT NULL
              ORDER BY criado_em`,
            { invoiceDocCod },
        )) as Array<{ adiantamento_doc_cod: string; bor_cod: string; status: string }>;
        for (const e of comErro) {
            const borCod = Number(e.bor_cod);
            try {
                const det = await baixas.getBordero({ filCod, borCod });
                const dentro = await baixas.listBaixas({ filCod, borCod });
                console.log(
                    `  borderô ${borCod} (adto ${e.adiantamento_doc_cod}, ${e.status}) → ` +
                        `${det ? JSON.stringify(det) : 'não encontrado'}`,
                );
                console.log(`    baixas dentro dele: ${dentro.length}`);
                for (const b of dentro) {
                    console.log(
                        `      · doc ${b.docCod}/${b.titCod} seq ${b.bxaCodSeq} ` +
                            `líquidoPermuta ${brl(b.bxaMnyLiquidoPermuta)} finalizado=${String(b.borVldFinalizado)}`,
                    );
                }
            } catch (err) {
                console.log(`  ⚠ borderô ${borCod}: ${(err as Error).message}`);
            }
        }
        // 2c. O LADO-CRÉDITO: o adiantamento ainda tem saldo A PERMUTAR? A baixa de
        // permuta (`bxaVldAdto:1`, `bxaDocCod:<adto>`) consome o `mnyTitPermutar` do ADTO.
        // Se ele zerou, o ERP não tem contra o que permutar — e responde 0 no `validarTituloBaixa`
        // do título, que é exatamente o sintoma. Hipótese (D).
        const adtosDaInvoice = (await db.selectMany(
            `SELECT DISTINCT adiantamento_doc_cod, status
               FROM permuta_alocacao_execucao
              WHERE invoice_doc_cod = $invoiceDocCod
              ORDER BY adiantamento_doc_cod`,
            { invoiceDocCod },
        )) as Array<{ adiantamento_doc_cod: string; status: string }>;
        console.log('  lado-crédito (adiantamentos):');
        for (const a of adtosDaInvoice) {
            try {
                const d = await titulos.getDetalheTitulos({
                    docCod: a.adiantamento_doc_cod,
                    filCod,
                });
                console.log(
                    `    · adto ${a.adiantamento_doc_cod} (${a.status}) → a permutar ${brl(d.valorPermutar)} | ` +
                        `já permutado ${brl(d.valorPermutado)} | em-aberto ${brl(d.valorAberto)} | pago=${String(d.pago)}`,
                );
            } catch (err) {
                console.log(`    · adto ${a.adiantamento_doc_cod}: ${(err as Error).message}`);
            }
        }
        console.log('');
    }

    // ── FASE 3 — AS PARCELAS (títulos) DA INVOICE ────────────────────────────────
    // Hipótese (F), a que o código sustenta: `ReconciliacaoPermutaService` distribui o
    // valor alocado entre as parcelas com `for (const t of titulos)` usando `t.usd`, que é
    // a FACE da parcela — NÃO o em-aberto dela (`:543-545`). O laço não pula parcela já
    // quitada. Então o 2º adiantamento do grupo recomeça na parcela 1, que o 1º já baixou,
    // e o ERP responde `bxaMnyValor=0` → "título <inv>/1 sem valor em aberto".
    // O em-aberto por parcela JÁ é calculado em `assertCobertura` (`:686`,
    // `abertoUsd = t.usd - pagoBrl/taxa`) e descartado ali.
    // Assinatura esperada: parcela 1 quitada (pago=1 / aberto≈0) e parcela 2+ em aberto.
    if (relatorio.length > 0) {
        console.log('═'.repeat(78));
        console.log('FASE 3 — parcelas (títulos) de cada invoice\n');
    }
    for (const r of relatorio) {
        const invoiceDocCod = String(r.invoiceDocCod);
        const filCod = Number(r.filCod);
        console.log('─'.repeat(78));
        console.log(`INVOICE ${invoiceDocCod} (filial ${filCod})`);
        try {
            const parcelas = await titulos.listTitulosAPagar({ docCod: invoiceDocCod, filCod });
            console.log(`  ${parcelas.length} parcela(s):`);
            let abertoTotal = 0;
            for (const t of parcelas) {
                const taxa = t.taxa ?? 0;
                const faceUsd = t.valorNegociado ?? 0;
                const pagoUsd = taxa > 0 ? (t.valorPago ?? 0) / taxa : 0;
                const abertoUsd = faceUsd - pagoUsd;
                abertoTotal += abertoUsd;
                console.log(
                    `    · tit ${t.titCod}  face ${faceUsd.toFixed(2)} ${t.moedaNome ?? ''} | ` +
                        `pago ${pagoUsd.toFixed(2)} | EM ABERTO ${abertoUsd.toFixed(2)} | ` +
                        `pago=${String(t.pago)} | taxa ${taxa}`,
                );
            }
            console.log(`  em-aberto somado: ${abertoTotal.toFixed(2)} (moeda negociada)`);
            const quitadas = parcelas.filter((t) => t.pago === 1).map((t) => t.titCod);
            if (quitadas.length > 0 && parcelas.length > quitadas.length) {
                console.log(
                    `  ▶ (F) CONFIRMADA: parcela(s) ${quitadas.join(', ')} já quitada(s) e ` +
                        `${parcelas.length - quitadas.length} ainda aberta(s) — o laço de baixa ` +
                        `recomeça na parcela 1 e bate em em-aberto 0.`,
                );
            }
        } catch (err) {
            console.log(`  ⚠ falha ao listar parcelas: ${(err as Error).message}`);
        }
        console.log('');
    }

    // ── Resumo ──────────────────────────────────────────────────────────────────
    const porHipotese = relatorio.reduce<Record<string, number>>((acc, r) => {
        const h = String(r.hipotese);
        acc[h] = (acc[h] ?? 0) + 1;
        return acc;
    }, {});
    console.log('═'.repeat(78));
    console.log('RESUMO por hipótese:', porHipotese);

    mkdirSync(OUT, { recursive: true });
    const arquivo = `${OUT}/relatorio.json`;
    writeFileSync(arquivo, JSON.stringify(relatorio, null, 2));
    console.log(`relatório salvo em ${arquivo}`);

    await db.close();
};

main().catch((err) => {
    console.error('falha na sonda:', err);
    process.exit(1);
});

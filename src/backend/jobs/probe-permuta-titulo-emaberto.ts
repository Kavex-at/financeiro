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
 * RESULTADO DA EXECUÇÃO (2026-09-11, prod) — (A) e (B) REFUTADAS nos casos reais N:1.
 *
 * 8 invoices com settled+error no ledger. 5 caíram em (B), mas são casos de UM só adto
 * (retentativa após "período fechado") — não são o sintoma reportado. Os 3 casos com
 * DOIS adiantamentos de verdade (7144, 4755, 32496) deram INDEFINIDO, e a fase 2 mostrou
 * por quê — os DOIS lados têm saldo sobrando:
 *
 *   invoice 7144  título em-aberto R$ 164.619,74   adto 6833 a permutar R$ 160.397,90
 *   invoice 4755  título em-aberto R$ 150.061,81   adto 4471 a permutar R$ 151.889,56
 *
 * Ou seja: a mensagem "título sem valor em aberto no ERP" é ENGANOSA — o título tem
 * saldo. O que difere entre o adto que liquidou e o que falhou é o BORDERÔ:
 *
 *   bor 2057 (adto 4635, settled) → contém `doc 7144/1` R$ 39.765,11   ✔ é o nosso
 *   bor 2771 (adto 6833, error)   → contém `doc 6708/1` e `doc 6708/2` ✗ é de OUTRO
 *   bor 2185 (adto 3211, settled) → contém `doc 4755/1` R$ 16.673,54   ✔ é o nosso
 *   bor 2436 (adto 4471, error)   → contém `doc 5155/1` R$ 542,85      ✗ é de OUTRO
 *
 * Os borderôs das execuções com erro já estavam FINALIZADOS (`borVldFinalizado:1`) com
 * baixas de outro fornecedor ANTES de o nosso passo de validação rodar. Validar o nosso
 * título dentro do borderô de outro fornecedor devolve `bxaMnyValor=0` — e é exatamente
 * o erro que o analista vê.
 *
 * ⇒ HIPÓTESE (E), a que sobrou: o `borCod` que `criarBordero` devolve NÃO é exclusivamente
 *   nosso — colide com borderôs que analistas finalizam direto na UI do Conexos. Suspeito
 *   primário: `ConexosBaixaClient.criarBordero` (`:67-92`) confia no `BORDERO_CRIADO_SCHEMA
 *   .parse(raw)` para extrair um `borCod` da resposta do `POST /fin010` sem verificar que
 *   o borderô voltou VAZIO e EM CADASTRO (`borVldFinalizado:0`, `vldHasBaixa:0`) e nosso.
 *   Não é bug de rateio — é de propriedade/concorrência do borderô.
 *
 * Confirmado por: `request_payload`/`erp_response` das execuções com erro são NULL — elas
 * morrem no passo 2 (validação) e nunca chegam a POSTar baixa. O borderô fica órfão.
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

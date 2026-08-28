import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê process.env.CONEXOS_USERNAME na construção, no import).
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosTitulosClient from '../domain/client/ConexosTitulosClient.js';

/**
 * Sonda READ-ONLY do `pago` das INVOICEs (`com298/list`, `tpdCod=128`) — Frente I, aba
 * "Invoices em aberto".
 *
 * ## Por que existe
 *
 * A aba mostra invoices JÁ LIQUIDADAS (relato Simone 2026-08-25; doc 14042 filial 2, processo
 * 1953, `Valor em Aberto 0,00` / `FINALIZADO` no Conexos). A vista lê
 * `permuta_invoice WHERE NOT stale AND NOT pago`, e `pago` é persistido a partir da ROW do
 * `com298/list` via `ConexosBaseClient.isPago()`.
 *
 * O defeito de classe já foi corrigido DUAS vezes — `01b99bf` (2026-06-18, Gate 3 do
 * adiantamento) e `df90fa6` (2026-06-21, busca de invoice da alocação) — sempre trocando a
 * LISTA pelo DETALHE. A ingestão do universo completo (ADR-0014, `634eef0`, 2026-06-24) nasceu
 * depois e nunca recebeu a correção.
 *
 * **Mas a evidência que justifica o detalhe nunca foi medida no lado INVOICE.** O probe de
 * 2026-06-18 varreu 411 **PROFORMAs**; a ontologia generalizou ("410 adiantamentos reais") e o
 * universo de invoices herdou a suposição. O relato "aparecem ALGUMAS" contradiz o cenário
 * "`mnyTitAberto` é null para todas" — se fosse, `NOT pago` seria no-op e a aba mostraria
 * TODAS as finalizadas (no recorte PROFORMA, 332/408 estavam pagas).
 *
 * ## O que responde
 *
 *  1. Nas rows de INVOICE do `com298/list`, `mnyTitAberto` vem `null`, `number` ou `string`?
 *     (`isPago` testa `typeof === 'number'` ESTRITO — uma string `"0"` cai fora e vira
 *     `pago=false`, enquanto todo o resto do código usa `parseOptionalNumber`.)
 *  2. O que exatamente a lista devolve para o doc 14042 (o caso relatado)?
 *  3. O `com298/list` aceita `mnyTitAberto#GT` como FILTRO? (A evidência de `ORA-00904` é sobre
 *     SELECT/`fieldList`; filtro é outra cláusula e nunca foi testado. Se aceitar, o universo
 *     já volta filtrado na origem — zero chamadas extras.)
 *  4. BLAST RADIUS: numa amostra, em quantas invoices o `isPago(row)` da LISTA discorda do
 *     `pago` do DETALHE — e em quantas a divergência é exatamente "lista diz ABERTA, detalhe
 *     diz PAGA" (as linhas que sujam a aba da analista).
 *
 * ## Segurança
 *
 * SOMENTE leitura: `POST com298/list` (o grid paginado — é POST por causa do corpo de filtro,
 * não por escrever) e `GET com298/{docCod}` (detalhe, via `getDetalheTitulos`). Nenhum
 * POST/PUT de criação, finalização ou baixa. Usa o MESMO `base.paginate` que a
 * `listInvoicesFinalizadas` de produção, para medir o caminho real e não um parecido.
 *
 * Run (PRD — não há ambiente HML neste tenant):
 *   PROBE_ALLOW_PRD=1 npx tsx jobs/probe-invoice-pago.ts
 *   PROBE_ALLOW_PRD=1 FILS=1,2,3 AMOSTRA=60 npx tsx jobs/probe-invoice-pago.ts
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

const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-invoice-pago';
const FILIAIS = (process.env.FILS ?? '2').split(',').map(Number);
/** Quantas invoices por filial cruzar contra o DETALHE (custo: 1 GET cada). */
const AMOSTRA = Number(process.env.AMOSTRA ?? 40);
/** Docs de interesse — o caso relatado pela Simone. */
const DOCS_ALVO = (process.env.DOCS ?? '14042').split(',');

const TPD_INVOICE = 128;
const VLD_STATUS_FINALIZADO = ['3'] as const;

interface Achado {
    pergunta: string;
    resultado: unknown;
}

const achados: Achado[] = [];
const registrar = (pergunta: string, resultado: unknown): void => {
    achados.push({ pergunta, resultado });
    console.log(`\n### ${pergunta}`);
    console.log(JSON.stringify(resultado, null, 2).slice(0, 4000));
};

/** Tipo do valor como o `isPago` o vê — o ponto exato onde a decisão é tomada. */
const tipoDe = (v: unknown): string => {
    if (v === null) return 'null';
    if (v === undefined) return 'ausente';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return `string(${v === '' ? 'vazia' : 'preenchida'})`;
    return typeof v;
};

/** Réplica EXATA do `ConexosBaseClient.isPago` — para medir o que a produção decide hoje. */
const isPagoAtual = (row: Record<string, unknown>): boolean => {
    if (typeof row.mnyTitAberto === 'number') return row.mnyTitAberto === 0;
    if (typeof row.pago === 'number') return row.pago === 1;
    if (typeof row.pago === 'boolean') return row.pago;
    return false;
};

const main = async (): Promise<void> => {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const titulos = container.resolve(ConexosTitulosClient);
    mkdirSync(OUT_DIR, { recursive: true });

    for (const filCod of FILIAIS) {
        // MESMA chamada da `listInvoicesFinalizadas` (ConexosFinanceiroClient.ts:319+).
        const rows = await base.paginate<Record<string, unknown>>({
            endpoint: 'com298/list',
            bodyBase: {
                fieldList: [],
                filterList: {
                    'tpdCod#EQ': TPD_INVOICE,
                    'vldStatus#IN': VLD_STATUS_FINALIZADO,
                },
                serviceName: 'com298',
            },
            opts: { filCod },
        });

        // (1) Como os campos de pagamento chegam na ROW da lista.
        const tally: Record<string, Record<string, number>> = {};
        for (const campo of ['mnyTitAberto', 'mnyTitPago', 'mnyTitValor', 'pago']) {
            tally[campo] = {};
            for (const row of rows) {
                const t = tipoDe(row[campo]);
                tally[campo][t] = (tally[campo][t] ?? 0) + 1;
            }
        }
        registrar(`[fil ${filCod}] 1. tipos dos campos de pagamento na ROW (n=${rows.length})`, {
            totalRows: rows.length,
            tipos: tally,
            isPagoAtual_true: rows.filter((r) => isPagoAtual(r)).length,
            isPagoAtual_false: rows.filter((r) => !isPagoAtual(r)).length,
            chavesDaPrimeiraRow: rows[0] ? Object.keys(rows[0]).sort() : [],
        });

        // (2) Os docs de interesse, crus.
        const alvos = rows.filter((r) => DOCS_ALVO.includes(String(r.docCod ?? '')));
        for (const alvo of alvos) {
            const det = await titulos
                .getDetalheTitulos({ docCod: String(alvo.docCod), filCod })
                .catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
            registrar(`[fil ${filCod}] 2. doc ${String(alvo.docCod)} — lista vs detalhe`, {
                rowDaLista: alvo,
                isPagoAtual: isPagoAtual(alvo),
                detalhe: det,
            });
        }
        if (alvos.length === 0) {
            registrar(
                `[fil ${filCod}] 2. docs alvo ${DOCS_ALVO.join(',')}`,
                'NAO encontrados nesta filial',
            );
        }

        // (3) Branch C — `mnyTitAberto` serve como FILTRO?
        try {
            const filtrado = await base.paginate<Record<string, unknown>>({
                endpoint: 'com298/list',
                bodyBase: {
                    fieldList: [],
                    filterList: {
                        'tpdCod#EQ': TPD_INVOICE,
                        'vldStatus#IN': VLD_STATUS_FINALIZADO,
                        'mnyTitAberto#GT': 0,
                    },
                    serviceName: 'com298',
                },
                opts: { filCod },
            });
            registrar(`[fil ${filCod}] 3. filtro mnyTitAberto#GT:0 — ACEITO?`, {
                aceito: true,
                semFiltro: rows.length,
                comFiltro: filtrado.length,
                // Se o ERP ignorar silenciosamente o filtro, os counts vêm iguais — isso NÃO
                // prova que funcionou. A prova é o count menor E o doc alvo ter sumido.
                filtroTeveEfeito: filtrado.length !== rows.length,
                docsAlvoSumiram: DOCS_ALVO.filter(
                    (d) => !filtrado.some((r) => String(r.docCod ?? '') === d),
                ),
            });
        } catch (e) {
            registrar(`[fil ${filCod}] 3. filtro mnyTitAberto#GT:0 — ACEITO?`, {
                aceito: false,
                erro: e instanceof Error ? e.message : String(e),
            });
        }

        // (4) Blast radius: lista vs detalhe numa amostra.
        const amostra = rows.slice(0, AMOSTRA);
        const divergencias: Array<Record<string, unknown>> = [];
        let concordam = 0;
        let detalheIndisponivel = 0;
        for (const row of amostra) {
            const docCod = String(row.docCod ?? '');
            try {
                const det = await titulos.getDetalheTitulos({ docCod, filCod });
                const daLista = isPagoAtual(row);
                const doDetalhe = det.pago;
                if (doDetalhe === undefined) {
                    detalheIndisponivel++;
                    continue;
                }
                if (daLista === doDetalhe) {
                    concordam++;
                } else {
                    divergencias.push({
                        docCod,
                        priCod: String(row.priCod ?? ''),
                        listaDiz: daLista ? 'PAGA' : 'ABERTA',
                        detalheDiz: doDetalhe ? 'PAGA' : 'ABERTA',
                        mnyTitAbertoNaLista: row.mnyTitAberto,
                        valorAbertoNoDetalhe: det.valorAberto,
                        // O caso que suja a aba: a lista deixa passar como aberta algo já pago.
                        sujaAAba: !daLista && doDetalhe,
                    });
                }
            } catch {
                detalheIndisponivel++;
            }
        }
        registrar(
            `[fil ${filCod}] 4. BLAST RADIUS — lista vs detalhe (amostra=${amostra.length})`,
            {
                concordam,
                divergem: divergencias.length,
                detalheIndisponivel,
                sujamAAba: divergencias.filter((d) => d.sujaAAba === true).length,
                divergencias: divergencias.slice(0, 25),
            },
        );
    }

    const out = `${OUT_DIR}/achados.json`;
    writeFileSync(out, JSON.stringify(achados, null, 2));
    console.log(`\n[probe-invoice-pago] achados salvos em ${out}`);
};

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(
            '[probe-invoice-pago] FALHOU:',
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    });

import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import type { ContaPagadora } from '../domain/interface/sispag/Fin015Write.js';

/**
 * VALIDAÇÃO EM HML — fecha a perna de IDA do SISPAG ponta-a-ponta:
 *   criarLote → (enriquecer + validar) → importarTitulos → finalizarLote → gerarRemessa → `.REM`
 *
 * PORQUÊ: das 7 ferramentas do `ConexosSispagWriteClient`, só o `importarTitulos` nunca
 * fechou — a linha crua do `titulosPendentes/list` dá 400. A sonda read-only
 * (`probe-fin015-import.ts`) mostrou o motivo: o grid de pendentes NÃO tem destino
 * (sem `pct*`, banco, agência, conta ou modalidade — 44 campos, só identidade/valor/alçada),
 * enquanto o item realmente importado (`FinItemSispag`) tem
 * `itsVldModalidade=1, itsNumBanco=341, agencia, conta, pctCodSeq, vldOk=1, vldImporta=1`.
 *
 * HIPÓTESE SOB TESTE: a tela monta o `FinItemSispag`, passa pelos validadores
 * `finItemSispag/validacao/{modalidadeTed|modalidadePix|codigoBarras}` — que recebem UM
 * `FinItemSispag` e DEVOLVEM um `FinItemSispag` (validam E enriquecem) — e importa o que
 * voltou. O destino que falta vem do `fin064`, que a gente já lê para o painel
 * (`pctNumBanco`, `pctEspNumContaBanc`, `itsDesChavePix`, `titEspCodbar`).
 *
 * SEGURANÇA:
 *   - RECUSA rodar fora de HML. Sem override — esta sonda escreve.
 *   - Escrita só com `FIN015_IMPORT_WRITE=1` (sem a flag: só o diagnóstico read-only).
 *   - `CLEANUP=1` cancela o lote de teste no fim (`cancelarLote`).
 *
 * Run:
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   FIN015_IMPORT_WRITE=1 CLEANUP=1 npx tsx jobs/validate-fin015-import.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Esta sonda ESCREVE — só roda em HML.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/fin015-import-write';
const FIL = Number(process.env.FLP_FIL ?? 1);
const BNC = Number(process.env.FLP_BNC ?? 4);
const WRITE = process.env.FIN015_IMPORT_WRITE === '1';
const CLEANUP = process.env.CLEANUP === '1';

/** Conta pagadora Itaú (default empírico, 8/8 lotes PRD). */
const ITAU: ContaPagadora = {
    bncCod: BNC,
    bncNumCodbanco: 341,
    ccoCod: 1,
    ccoNumConta: 55795,
    ccoEspDvconta: '4',
    ccoEspAgcod: '0641',
    conta: '55795-4',
    layoutConta: 'AG:0641/CT:55795-4',
};

/** Modalidade nativa do fin015 — 1 = crédito em conta / transferência (observado no item real). */
const MODALIDADE_TRANSFERENCIA = 1;

/** Código FEBRABAN do banco do LOTE (bncCod é o código INTERNO do Conexos). */
const FEBRABAN_POR_BNCCOD: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
const BANCO_FEBRABAN = Number(process.env.BANCO_FEBRABAN ?? FEBRABAN_POR_BNCCOD[BNC] ?? 341);

const log = (s: string, v?: unknown): void =>
    console.log(`[fin015-import] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 500) : '');

const save = (name: string, data: unknown): void => {
    writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 2));
    log(`  ↳ ${OUT}/${name}`);
};

const erroDe = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Row = Record<string, unknown>;

/** Meia-noite UTC de hoje — R1 exige data de débito ≥ hoje. */
const hojeUtc = (): number => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);

    console.log('='.repeat(78));
    console.log(`BASE: ${BASE}  (HML)   fil=${FIL} bnc=${BNC}`);
    console.log(`MODO: ${WRITE ? 'ESCRITA (FIN015_IMPORT_WRITE=1)' : 'DIAGNÓSTICO read-only'}`);
    console.log(`CLEANUP no fim: ${CLEANUP ? 'sim (cancelarLote)' : 'não'}`);
    console.log('='.repeat(78));

    await base.ensureSid();
    log('login OK');

    const dataDebito = hojeUtc();
    log(`data de débito (R1: ≥ hoje) = ${new Date(dataDebito).toISOString().slice(0, 10)}`);

    // ── 1) criarLote ─────────────────────────────────────────────────────────
    let flpCod: number | undefined;
    if (WRITE) {
        try {
            const lote = await write.criarLote({ filCod: FIL, conta: ITAU, dataDebito });
            flpCod = lote.flpCod;
            log(`1) criarLote OK → flp ${flpCod}`);
        } catch (e) {
            log('1) criarLote ERRO:', erroDe(e));
            return;
        }
    } else {
        // Sem escrita: usa um lote existente só para LER os pendentes.
        const page = await base.listGenericPaginated<Row>(
            'fin015/list',
            {
                fieldList: [],
                filterList: {},
                serviceName: 'fin015',
                pageNumber: 1,
                pageSize: 20,
            },
            { filCod: FIL },
        );
        flpCod = Number(page.rows[0]?.flpCod);
        log(`1) criarLote PULADO (read-only) — usando flp existente ${flpCod} só p/ leitura`);
    }
    if (!flpCod || !Number.isFinite(flpCod)) return;

    try {
        // ── 2) escolher um pendente PAGÁVEL: vencimento ≥ data de débito (R2) ──
        const pendentes = await write.listarTitulosPendentes({
            filCod: FIL,
            bncCod: BNC,
            flpCod,
            pageSize: 500,
        });
        log(`2) titulosPendentes/list → ${pendentes.length} pendente(s)`);

        const aVencer = pendentes
            .filter((p) => typeof p.vencimento === 'number' && p.vencimento >= dataDebito)
            .sort((a, b) => (a.vencimento ?? 0) - (b.vencimento ?? 0));
        log(`   ${aVencer.length} com vencimento ≥ data de débito (R2 satisfeita de saída)`);

        // HML tem massa velha: quase tudo vencido. R2 ("data débito ≤ menor vencimento") é
        // uma LEITURA NOSSA da mensagem do ERP, não uma regra confirmada — na operação real
        // paga-se título vencido o tempo todo. Então não pré-julgamos: se não há título a
        // vencer, seguimos com o de vencimento MAIS RECENTE e deixamos o `finalizarLote`
        // dizer se R2 bloqueia de fato. É esse o valor do harness — ouvir o ERP.
        const pagaveis =
            aVencer.length > 0
                ? aVencer
                : [...pendentes]
                      .filter((p) => typeof p.vencimento === 'number')
                      .sort((a, b) => (b.vencimento ?? 0) - (a.vencimento ?? 0));
        if (aVencer.length === 0) {
            const topo = pagaveis[0];
            log(
                `   ⚠️  nenhum título a vencer em HML — seguindo com o mais recente (venc ${topo?.vencimento ? new Date(topo.vencimento).toISOString().slice(0, 10) : '?'}) para PROVAR o import e ouvir o veredito do ERP sobre R2.`,
            );
        }
        if (pagaveis.length === 0) {
            log('   nenhum pendente com vencimento legível — abortando.');
            return;
        }

        // ── 3) achar o DESTINO — no CADASTRO DO FAVORECIDO (cmn025/ctcorr) ────
        // O `fin064` NÃO carrega destino: varredura read-only deu 0% em HML (561 títulos)
        // E em PRD (2000 títulos). Os campos `pct*`/`its*` do fin064 são um LEFT JOIN no
        // item SISPAG — só populam depois que o título entra num lote. A conta do
        // favorecido mora em `CmnPessoasCtcorr` (`cmn025/ctcorr/list`, filtro `pesCod#EQ`),
        // com `pctCodSeq`, `pctNumBanco`, `pctEspNumAgencia`, `pctEspNumContaBanc` e
        // `pctVldDefault`. É o `pctCodSeq` que o `FinItemSispag` referencia.
        // Confirmado: pesCod 1507 em HML → pctCodSeq=1, banco=341, ag=292, cc=46030-0 —
        // exatamente o destino do item real lido no lote flp 2.
        let escolhido: (typeof pagaveis)[number] | undefined;
        let conta: Row | undefined;

        // INVARIANTE DESCOBERTA NA PERNA DE RETORNO: o título tem que ser da MESMA filial
        // do lote. O parser do .RET (ger015.gtbLngSql) exige, ao mesmo tempo,
        // FIN_ITEM_SISPAG.FIL_COD = <filial no arquivo> E
        // FIN_LOTE_SISPAG.FIL_COD = FIN_ITEM_SISPAG.FIL_COD — logo item cross-filial
        // NUNCA processa o retorno, seja qual for a filial gravada na remessa.
        const mesmaFilial = pagaveis.filter((p) => Number(p.raw.filCod) === FIL);
        log(
            `   ${mesmaFilial.length}/${pagaveis.length} pendentes são da filial do LOTE (${FIL}) — só esses fecham o retorno`,
        );
        for (const p of mesmaFilial.slice(0, 40)) {
            const pesCod = p.raw.pesCod;
            if (pesCod === null || pesCod === undefined || pesCod === '') continue;
            try {
                const { rows } = await base.listGenericPaginated<Row>(
                    'cmn025/ctcorr/list',
                    {
                        fieldList: [],
                        filterList: { 'pesCod#EQ': pesCod },
                        serviceName: 'cmn025',
                        pageNumber: 1,
                        pageSize: 50,
                    },
                    { filCod: FIL },
                );
                const ativas = rows.filter((c) => Number(c.pctVldStatus) === 1);
                if (ativas.length === 0) continue;
                // O ERP interrompe o import com uma PERGUNTA (`type: QUESTION`,
                // FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO...) quando o
                // favorecido não tem conta no banco do LOTE. Então preferimos conta do
                // MESMO banco; as demais só servem de último recurso.
                const noBancoDoLote = ativas.filter(
                    (c) => Number(c.pctNumBanco) === BANCO_FEBRABAN,
                );
                log(
                    `   pesCod=${pesCod} (doc ${p.docCod}) → ${ativas.length} ativa(s), ${noBancoDoLote.length} no banco do lote (${BANCO_FEBRABAN})`,
                );
                const preferidas = noBancoDoLote.length > 0 ? noBancoDoLote : ativas;
                const candidata =
                    preferidas.find((c) => Number(c.pctVldDefault) === 1) ?? preferidas[0];
                // Guarda o primeiro achado como plano B, mas só PARA quando bate o banco.
                if (!escolhido || noBancoDoLote.length > 0) {
                    escolhido = p;
                    conta = candidata;
                }
                if (noBancoDoLote.length > 0) break;
            } catch (e) {
                log(`   pesCod=${pesCod} ERRO: ${erroDe(e)}`);
            }
        }

        if (!escolhido || !conta) {
            log('3) nenhum pendente cujo favorecido tenha conta cadastrada — abortando.');
            log('    (peça à Columbia para cadastrar conta bancária num favorecido de HML)');
            return;
        }
        save('10-conta-favorecido.json', conta);
        console.log('\n  >>> CONTA DO FAVORECIDO (cmn025/ctcorr) <<<');
        for (const [k, v] of Object.entries(conta).sort()) {
            if (v !== null && v !== undefined && v !== '')
                console.log(`  ${k.padEnd(28)} = ${JSON.stringify(v)}`);
        }
        log(
            `\n3) escolhido: doc=${escolhido.docCod} tit=${escolhido.titCod} · ${escolhido.favorecido ?? '?'} · R$ ${escolhido.valor} · venc ${new Date(escolhido.vencimento ?? 0).toISOString().slice(0, 10)}`,
        );
        log(
            `   destino REAL: banco=${conta.pctNumBanco} ag=${conta.pctEspNumAgencia} cc=${conta.pctEspNumContaBanc} pctCodSeq=${conta.pctCodSeq}`,
        );
        const destino: Row = {
            pctNumBanco: conta.pctNumBanco,
            pctEspNumAgencia: conta.pctEspNumAgencia,
            pctEspNumContaBanc: conta.pctEspNumContaBanc,
            pctCodSeq: conta.pctCodSeq,
            // O `titulosPendentes/list` usa `titMnyValor`/`dpeNomPessoa` — NÃO os campos
            // `its*` que o mapper do client procura (esses só existem no item já importado).
            dpeNomPessoa: escolhido.raw.dpeNomPessoa ?? escolhido.favorecido,
            titMnyValor: escolhido.raw.titMnyValor ?? escolhido.valor,
        };

        // ── 4) montar o FinItemSispag candidato ───────────────────────────────
        const valor = Number(destino.titMnyValor ?? escolhido.valor ?? 0);
        const itemBase: Row = {
            ...escolhido.raw,
            // A IDENTIDADE vem VERBATIM do `titulosPendentes/list` — não coerce.
            // O grid devolve títulos de MAIS DE UMA FILIAL; forçar `filCod` = filial do
            // LOTE quebrava a busca (`Not Found: FinTituloPag`). `filCodLote` é a filial
            // do lote; `filCod` é a do TÍTULO, e são coisas diferentes.
            filCodLote: FIL,
            bncCod: BNC,
            flpCod,
            itsVldModalidade: MODALIDADE_TRANSFERENCIA,
            // `pctCodSeq` = FK da conta do favorecido (CmnPessoasCtcorr). É o campo que
            // amarra o item ao destino; os demais são o espelho legível dele.
            pctCodSeq: destino.pctCodSeq != null ? Number(destino.pctCodSeq) : undefined,
            pctEspNumAgencia:
                destino.pctEspNumAgencia != null ? String(destino.pctEspNumAgencia) : undefined,
            itsNumBanco: destino.pctNumBanco != null ? Number(destino.pctNumBanco) : undefined,
            conta:
                destino.pctEspNumContaBanc != null
                    ? String(destino.pctEspNumContaBanc)
                    : undefined,
            agencia:
                destino.pctEspNumAgencia != null ? String(destino.pctEspNumAgencia) : undefined,
            itsEspNomeFav: destino.dpeNomPessoa ?? escolhido.favorecido,
            itsMnyValor: valor,
            itsMnyVlrPgto: valor,
            titMnyLiquido: valor,
            itsDtaPgto: dataDebito,
            vldOk: 1,
            vldImporta: 1,
            // ── Os 4 campos que o ERP exigiu no `SELECTION_ERROR` (2026-08-19) ──
            // O `importar` NÃO recebe um FinItemSispag inteiro: ele projeta um DTO de
            // SELEÇÃO (o eco do erro devolveu só 15 campos). Faltavam:
            //   bncCodFin015            → o banco do LOTE (≠ bncCod do item)
            //   op                      → flag de operação da seleção
            //   titVldReflexoDdaAssoc   → reflexo DDA associar
            //   titVldReflexoDdaDesassoc→ reflexo DDA desassociar
            bncCodFin015: BNC,
            op: Number(process.env.OP ?? 1),
            titVldReflexoDdaAssoc: 0,
            titVldReflexoDdaDesassoc: 0,
            titEspCodbar: escolhido.raw.titEspCodbar ?? '',
            avisos: '[]',
        };
        save('20-item-candidato.json', itemBase);
        log('4) item candidato montado (pendente + destino fin064 + modalidade).');

        if (!WRITE) {
            log('MODO DIAGNÓSTICO — parando antes de qualquer escrita. Rode com FIN015_IMPORT_WRITE=1.');
            return;
        }

        // ── 5) validacao/modalidadeTed — valida E enriquece (a hipótese) ──────
        let itemParaImportar: Row = itemBase;
        try {
            const enriquecido = await base.postGenericOnce<Row>(
                'fin015/finItemSispag/validacao/modalidadeTed',
                itemBase,
                { filCod: FIL },
            );
            save('30-item-enriquecido.json', enriquecido);
            const novos = Object.entries(enriquecido ?? {}).filter(
                ([k, v]) =>
                    v !== null && v !== undefined && v !== '' &&
                    (itemBase[k] === null || itemBase[k] === undefined || itemBase[k] === ''),
            );
            log('5) validacao/modalidadeTed OK — campos que o ERP PREENCHEU:', Object.fromEntries(novos));
            if (enriquecido && typeof enriquecido === 'object') itemParaImportar = enriquecido;
        } catch (e) {
            log('5) validacao/modalidadeTed ERRO (segue com o item cru):', erroDe(e));
        }

        // ── 6) importarTitulos — O TESTE ─────────────────────────────────────
        // O `SELECTION_ERROR` devolveu `op`, `bncCodFin015`, `titVldReflexoDdaAssoc` e
        // `titVldReflexoDdaDesassoc` VAZIOS mesmo estando preenchidos DENTRO do item —
        // logo o ERP não os lê do item: são campos de NÍVEL DA REQUISIÇÃO, ao lado de
        // `items`. Os demais campos do eco (filCod, docCod, flpCod…) vieram do item.
        // Testa as variantes em ordem até uma passar.
        const selecao = {
            op: Number(process.env.OP ?? 1),
            bncCodFin015: BNC,
            titVldReflexoDdaAssoc: 0,
            titVldReflexoDdaDesassoc: 0,
        };
        const variantes: Array<{ nome: string; body: Record<string, unknown> }> = [
            {
                nome: 'A — seleção no NÍVEL DA REQUISIÇÃO (números)',
                body: { items: [itemParaImportar], ...selecao },
            },
            {
                nome: 'B — seleção no nível da requisição (strings, como o eco)',
                body: {
                    items: [itemParaImportar],
                    op: String(selecao.op),
                    bncCodFin015: String(BNC),
                    titVldReflexoDdaAssoc: '0',
                    titVldReflexoDdaDesassoc: '0',
                },
            },
            {
                nome: 'C — seleção no nível da requisição E dentro do item',
                body: {
                    items: [{ ...itemParaImportar, ...selecao }],
                    ...selecao,
                },
            },
        ];

        let importou = false;
        for (const v of variantes) {
            try {
                await base.ensureSid();
                await base.postGenericOnce<unknown>(
                    'fin015/finItemSispag/titulosPendentes/importar',
                    v.body,
                    { filCod: FIL },
                );
                importou = true;
                log(`6) importarTitulos ✅ OK — variante ${v.nome}`);
                save('35-body-que-funcionou.json', v.body);
                break;
            } catch (e) {
                log(`6) variante ${v.nome} ❌:`, erroDe(e));
            }
        }
        if (!importou) log('6) importarTitulos ❌ todas as variantes falharam.');

        // ── 7) confirmar que o item ENTROU no lote ───────────────────────────
        try {
            const page = await base.listGenericPaginated<Row>(
                `fin015/finItemSispag/list/${FIL}/${BNC}/${flpCod}`,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 50,
                },
                { filCod: FIL },
            );
            log(`7) finItemSispag/list → ${page.rows.length} item(ns) no lote ${flpCod}`);
            if (page.rows.length > 0) {
                importou = true;
                save('40-itens-no-lote.json', page.rows);
            }
        } catch (e) {
            log('7) finItemSispag/list ERRO:', erroDe(e));
        }

        if (!importou) {
            log('PAROU: sem item no lote, finalizar/gerar remessa não fazem sentido.');
            return;
        }

        // ── 8) finalizarLote (valida R1/R2 no ERP) ───────────────────────────
        try {
            await write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod });
            log('8) finalizarLote ✅ OK');
        } catch (e) {
            log('8) finalizarLote ❌ ERRO:', erroDe(e));
            return;
        }

        // ── 9) gerarRemessa ──────────────────────────────────────────────────
        const seqNum = Number(process.env.SEQ ?? 91);
        const nomeArquivo = process.env.NOME ?? `PG${new Date(dataDebito).toISOString().slice(8, 10)}${new Date(dataDebito).toISOString().slice(5, 7)}${String(seqNum).padStart(2, '0')}.REM`;
        try {
            const rem = await write.gerarRemessa({
                filCod: FIL,
                bncCod: BNC,
                flpCod,
                grbCodSeq: 1,
                seqNum,
                gabEspNomeArquivo: nomeArquivo,
            });
            log(`9) gerarRemessa ✅ →`, rem);
        } catch (e) {
            log('9) gerarRemessa ❌ ERRO:', erroDe(e));
        }

        // ── 10) baixar e IMPRIMIR o .REM (a validação do leiaute CNAB 240) ────
        try {
            const arquivos = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod });
            log(`10) listarArquivosRemessa → ${arquivos.length} arquivo(s)`);
            const rem = arquivos.find((a) => a.conteudo);
            if (rem?.conteudo) {
                const destinoArq = `${OUT}/${rem.nomeArquivo ?? 'remessa'}.REM`;
                writeFileSync(destinoArq, rem.conteudo);
                console.log('\n' + '='.repeat(78));
                console.log(`.REM GERADO — ${rem.nomeArquivo} (gabCod ${rem.gabCod}) · ${rem.conteudo.length} chars`);
                console.log(`arquivo: ${destinoArq}`);
                console.log('='.repeat(78));
                for (const linha of rem.conteudo.split(/\r?\n/)) {
                    if (!linha.trim()) continue;
                    // CNAB 240: pos 8 = tipo de registro (0=header arq, 1=header lote, 3=detalhe, 5=trailer lote, 9=trailer arq)
                    console.log(`[reg ${linha.slice(7, 8)}|seg ${linha.slice(13, 14)}] ${linha}`);
                }
                console.log('='.repeat(78));
            } else {
                log('   nenhum arquivo com conteúdo (gabLngDados vazio).');
            }
        } catch (e) {
            log('10) listarArquivosRemessa ERRO:', erroDe(e));
        }
    } finally {
        // ── 11) limpeza do artefato de teste ─────────────────────────────────
        if (WRITE && CLEANUP && flpCod) {
            try {
                await base.getGeneric(`fin015/cancelarLote/${FIL}/${BNC}/${flpCod}`, { filCod: FIL });
                log(`11) cancelarLote(flp ${flpCod}) OK — artefato de teste limpo.`);
            } catch (e) {
                log(`11) cancelarLote(flp ${flpCod}) ERRO (limpe na mão):`, erroDe(e));
            }
        } else if (WRITE && flpCod) {
            log(`ATENÇÃO: lote de teste flp=${flpCod} deixado em HML. Limpar: CLEANUP=1 ou cancelarLote/${FIL}/${BNC}/${flpCod}`);
        }
    }

    console.log(`\nFIM — artefatos em ${OUT}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin015-import] FATAL:', erroDe(e));
        process.exit(1);
    });

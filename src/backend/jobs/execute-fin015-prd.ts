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
 * EXECUTOR do teste de geração de `.REM` em PRODUÇÃO — a confirmação para o cliente.
 *
 * Faz QUATRO escritas no ERP (criar lote → importar título → finalizar → gerar remessa),
 * imprime o CNAB 240 gerado para conferência e DESFAZ na mesma sessão.
 *
 * NÃO entrega o arquivo a banco nenhum: o Conexos não transmite remessa de pagamento (o
 * transporte é externo — Nexxera/portal). Confirmado com a Columbia que não há robô
 * recolhendo arquivos gerados no fin015.
 *
 * ── TRAVAS ──────────────────────────────────────────────────────────────────────────
 *   PERMITIR_PRD=1  — reconhece que a base é produção
 *   EXECUTAR=1      — segundo opt-in, separado, para as escritas
 *   DOC=<docCod>    — OBRIGATÓRIO. Sem escolha automática: em produção o alvo é decidido
 *                     por gente, não por heurística.
 *   TETO=<valor>    — recusa título acima do teto (default R$ 500).
 *   MANTER=1        — não desfaz no fim (default: DESFAZ).
 *
 * ── TENTATIVA ÚNICA ─────────────────────────────────────────────────────────────────
 * `criarLote`, `importarTitulos` e `gerarRemessa` NÃO são idempotentes: um retry depois
 * de timeout duplica lote ou remessa. Cada escrita é tentada UMA vez; em falha o script
 * para e imprime o estado exato para desfazer à mão. O estado é gravado em disco a cada
 * passo, para que uma queda no meio não deixe ninguém às cegas.
 *
 * Run (ensaio, sem escrever):
 *   cd src/backend
 *   CONEXOS_BASE_URL=https://columbiatrading.conexos.cloud/api PERMITIR_PRD=1 \
 *   FIL=2 BNC=4 CCO=2 DOC=33975 TIT=1 TETO=500 tsx jobs/execute-fin015-prd.ts
 *
 * Run (execução):  ... EXECUTAR=1 tsx jobs/execute-fin015-prd.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const IS_HML = BASE.includes('-hml');
if (!IS_HML && process.env.PERMITIR_PRD !== '1') {
    console.error(`RECUSADO: base é produção (${BASE}) e PERMITIR_PRD não foi passado.`);
    process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? '/tmp/execute-fin015-prd';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const CCO = Number(process.env.CCO ?? 2);
const DOC = process.env.DOC ?? '';
const TIT = process.env.TIT ?? '1';
const TETO = Number(process.env.TETO ?? 500);
const EXECUTAR = process.env.EXECUTAR === '1';
const DESFAZER = process.env.MANTER !== '1';
const SEQ = Number(process.env.SEQ ?? 97);

/** Código FEBRABAN por `bncCod` interno do Conexos. */
const FEBRABAN: Record<number, number> = { 3: 1, 4: 341, 7: 237, 10: 33 };
/** 1 = crédito em conta / transferência (modalidade nativa observada no fin015). */
const MODALIDADE = 1;

type Row = Record<string, unknown>;

const brl = (n: unknown): string =>
    Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dia = (v: unknown): string =>
    typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : '—';

const hojeUtc = (): number => {
    const d = new Date();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const log = (s: string): void => console.log(`[exec-prd] ${s}`);

const erroDe = (e: unknown): string => {
    const d = (e as { response?: { data?: unknown } })?.response?.data;
    return d ? JSON.stringify(d).slice(0, 400) : e instanceof Error ? e.message : String(e);
};

/** Estado em disco — se o script morrer, sobra o rastro do que já foi criado. */
const estado: Row = { base: BASE, filCod: FIL, bncCod: BNC, docCod: DOC, titCod: TIT };
const salvarEstado = (): void => {
    writeFileSync(`${OUT}/ESTADO.json`, JSON.stringify(estado, null, 2));
};

/** Rótulo do registro CNAB 240 pela posição 8 (1-based). */
const tipoRegistro = (l: string): string =>
    ({
        '0': 'HEADER ARQUIVO',
        '1': 'HEADER LOTE',
        '3': 'DETALHE',
        '5': 'TRAILER LOTE',
        '9': 'TRAILER ARQUIVO',
    })[l.slice(7, 8)] ?? `reg ${l.slice(7, 8)}`;

async function main(): Promise<void> {
    if (!DOC) {
        console.error('RECUSADO: passe DOC=<docCod>. Em produção o alvo é escolhido por gente.');
        process.exit(1);
    }
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);

    console.log('='.repeat(78));
    console.log(`BASE  : ${BASE} ${IS_HML ? '(HML)' : '*** PRODUÇÃO ***'}`);
    console.log(`ALVO  : filial ${FIL} · banco ${BNC} · conta pagadora ccoCod ${CCO}`);
    console.log(`TÍTULO: doc ${DOC}/${TIT} · teto ${brl(TETO)}`);
    console.log(`MODO  : ${EXECUTAR ? 'EXECUTAR (4 escritas)' : 'ENSAIO — nada será escrito'}`);
    console.log(`FIM   : ${DESFAZER ? 'DESFAZ (cancela remessa e lote)' : 'MANTÉM (MANTER=1)'}`);
    console.log('='.repeat(78));
    await base.ensureSid();

    // ══ 1) CONTA PAGADORA — do fin005 da filial, nunca fixa ═════════════════
    const { rows: contas } = await base.listGenericPaginated<Row>(
        'fin005/list',
        { fieldList: [], filterList: {}, serviceName: 'fin005', pageNumber: 1, pageSize: 100 },
        { filCod: FIL },
    );
    const cc = contas.find((c) => Number(c.ccoCod) === CCO);
    if (!cc) {
        log(`ccoCod ${CCO} não existe na filial ${FIL}. Abortado.`);
        return;
    }
    if (Number(cc.bncCod) !== BNC) {
        log(`ccoCod ${CCO} é do banco ${cc.bncCod}, não ${BNC}. Abortado.`);
        return;
    }
    const contaFmt = `${cc.ccoNumConta}-${cc.ccoEspDvconta ?? ''}`;
    const contaPagadora: ContaPagadora = {
        bncCod: BNC,
        bncNumCodbanco: FEBRABAN[BNC] ?? 341,
        ccoCod: CCO,
        ccoNumConta: Number(cc.ccoNumConta),
        ccoEspDvconta: String(cc.ccoEspDvconta ?? ''),
        ccoEspAgcod: String(cc.ccoEspAgcod ?? ''),
        conta: contaFmt,
        layoutConta: `AG:${cc.ccoEspAgcod}/CT:${contaFmt}`,
    };
    log(
        `1) conta pagadora: ag ${cc.ccoEspAgcod} cc ${contaFmt} · conta financeira ${cc.gerNum} "${cc.gerDes}"`,
    );

    // ══ 2) REVALIDAÇÃO — a carteira muda de hora em hora ════════════════════
    const { rows: lotes } = await base.listGenericPaginated<Row>(
        'fin015/list',
        { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 50 },
        { filCod: FIL },
    );
    const ctx = lotes.find((l) => Number(l.bncCod) === BNC) ?? lotes[0];
    if (!ctx) {
        log('nenhum lote de contexto para listar pendentes. Abortado.');
        return;
    }

    // Pagina até o fim: uma página só esconde justamente os títulos de valor baixo.
    const pendentes: Row[] = [];
    for (let pagina = 1; pagina <= 40; pagina += 1) {
        const { rows, count } = await base.listGenericPaginated<Row>(
            `fin015/finItemSispag/titulosPendentes/list/${FIL}/${BNC}/${Number(ctx.flpCod)}`,
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
        if (rows.length < 500 || pendentes.length >= count) break;
    }
    const alvo = pendentes.find(
        (p) =>
            String(p.docCod) === DOC && String(p.titCod ?? '1') === TIT && Number(p.filCod) === FIL,
    );
    if (!alvo) {
        log(
            `doc ${DOC}/${TIT} NÃO está mais pendente na filial ${FIL} (${pendentes.length} varridos). Abortado.`,
        );
        return;
    }

    const valor = Number(alvo.titMnyValor);
    const venc = Number(alvo.titDtaVencimento);
    const dataDebito = hojeUtc();
    const checagens: Array<[string, boolean, string]> = [
        ['valor dentro do teto', valor > 0 && valor <= TETO, `${brl(valor)} ≤ ${brl(TETO)}`],
        ['vencimento ≥ data de débito', venc >= dataDebito, `${dia(venc)} ≥ ${dia(dataDebito)}`],
        [
            'liberado nas 3 alçadas',
            Number(alvo.titVld1libera) === 1 &&
                Number(alvo.titVld2libera) === 1 &&
                Number(alvo.titVld3libera) === 1,
            `${alvo.titVld1libera}/${alvo.titVld2libera}/${alvo.titVld3libera}`,
        ],
        [
            'filial do título = filial do lote',
            Number(alvo.filCod) === FIL,
            `${alvo.filCod} = ${FIL}`,
        ],
    ];
    console.log(`\n2) REVALIDAÇÃO — doc ${DOC}/${TIT} · ${alvo.dpeNomPessoa}`);
    for (const [nome, ok, det] of checagens) {
        console.log(`   ${ok ? '✅' : '❌'} ${nome.padEnd(34)} ${det}`);
    }
    if (checagens.some(([, ok]) => !ok)) {
        log('alguma checagem falhou. Abortado — nada foi escrito.');
        return;
    }

    // Conta do favorecido no banco do LOTE. Sem ela o ERP interrompe o import com o
    // protocolo de PERGUNTA (FIN_041.PESSOA_FAVORECIDA_SEM_CONTA_ATIVA_NO_BANCO...).
    const { rows: ctas } = await base.listGenericPaginated<Row>(
        'cmn025/ctcorr/list',
        {
            fieldList: [],
            filterList: { 'pesCod#EQ': alvo.pesCod },
            serviceName: 'cmn025',
            pageNumber: 1,
            pageSize: 50,
        },
        { filCod: FIL },
    );
    const noBanco = ctas.filter(
        (c) => Number(c.pctVldStatus) === 1 && Number(c.pctNumBanco) === (FEBRABAN[BNC] ?? 341),
    );
    if (noBanco.length === 0) {
        log(`favorecido ${alvo.pesCod} não tem conta ativa no banco ${FEBRABAN[BNC]}. Abortado.`);
        return;
    }
    const destino = noBanco.find((c) => Number(c.pctVldDefault) === 1) ?? noBanco[0];
    console.log(
        `   ✅ destino: banco ${destino.pctNumBanco} ag ${destino.pctEspNumAgencia} cc ${destino.pctEspNumContaBanc}-${destino.pctEspDvconta ?? ''} (pctCodSeq ${destino.pctCodSeq})`,
    );
    Object.assign(estado, { valor, venc: dia(venc), favorecido: alvo.dpeNomPessoa });
    salvarEstado();

    if (!EXECUTAR) {
        console.log('\nENSAIO — tudo validado, nada escrito. Rode com EXECUTAR=1.');
        return;
    }

    // ══ 3) AS QUATRO ESCRITAS — tentativa única cada ════════════════════════
    let flpCod: number | undefined;
    let gabCod: number | undefined;
    try {
        console.log('\n3) ESCRITAS');

        // (1) criar o lote
        const lote = await write.criarLote({ filCod: FIL, conta: contaPagadora, dataDebito });
        flpCod = lote.flpCod;
        estado.flpCod = flpCod;
        salvarEstado();
        log(`   [1/4] criarLote OK → flp ${flpCod}`);

        // (2) importar — campos de seleção nos DOIS níveis, identidade verbatim
        const selecao = {
            op: 1,
            bncCodFin015: BNC,
            titVldReflexoDdaAssoc: 0,
            titVldReflexoDdaDesassoc: 0,
        };
        const item: Row = {
            ...alvo,
            filCodLote: FIL,
            bncCod: BNC,
            flpCod,
            itsVldModalidade: MODALIDADE,
            pctCodSeq: Number(destino.pctCodSeq),
            itsNumBanco: Number(destino.pctNumBanco),
            agencia: String(destino.pctEspNumAgencia ?? ''),
            pctEspNumAgencia: String(destino.pctEspNumAgencia ?? ''),
            conta: String(destino.pctEspNumContaBanc ?? ''),
            itsEspNomeFav: alvo.dpeNomPessoa,
            itsMnyValor: valor,
            itsMnyVlrPgto: valor,
            titMnyLiquido: valor,
            itsDtaPgto: venc,
            vldOk: 1,
            vldImporta: 1,
            titEspCodbar: alvo.titEspCodbar ?? '',
            avisos: '[]',
            ...selecao,
        };
        writeFileSync(`${OUT}/item-importado.json`, JSON.stringify(item, null, 2));
        await base.ensureSid();
        await base.postGenericOnce<unknown>(
            'fin015/finItemSispag/titulosPendentes/importar',
            { items: [item], ...selecao },
            { filCod: FIL },
        );
        log('   [2/4] importarTitulos OK');

        const { rows: itens } = await base.listGenericPaginated<Row>(
            `fin015/finItemSispag/list/${FIL}/${BNC}/${flpCod}`,
            { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 20 },
            { filCod: FIL },
        );
        if (itens.length !== 1) {
            log(
                `   lote ficou com ${itens.length} item(ns), esperado 1. Parando antes de finalizar.`,
            );
            throw new Error('contagem de itens inesperada');
        }
        estado.itsCodSeq = itens[0].itsCodSeq;
        salvarEstado();

        // (3) finalizar — o ERP valida R1 e a regra do itsDtaPgto
        await write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod });
        estado.finalizado = true;
        salvarEstado();
        log('   [3/4] finalizarLote OK');

        // (4) gerar a remessa
        const hoje = new Date();
        const nome: string =
            process.env.NOME ??
            `PG${String(hoje.getUTCDate()).padStart(2, '0')}${String(hoje.getUTCMonth() + 1).padStart(2, '0')}${String(SEQ).padStart(2, '0')}.REM`;
        await write.gerarRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod,
            grbCodSeq: Number(process.env.GRB ?? 1),
            seqNum: SEQ,
            gabEspNomeArquivo: nome,
        });
        log(`   [4/4] gerarRemessa OK (${nome})`);

        // ══ 4) O ARQUIVO — o que a Columbia confere ═════════════════════════
        const arquivos = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod });
        // ⚠️ NUNCA `find(a => a.conteudo)`. O ERP REUTILIZA `flpCod` de lotes antigos que
        // deixaram de existir, e os arquivos de remessa daqueles lotes continuam apontando
        // para o número reciclado — logo a lista de um lote NOVO pode conter arquivos
        // órfãos de meses atrás. Em 2026-08-21 isso me fez imprimir e CANCELAR o
        // PG191101.REM (gabCod 16, nov/2025, UPS SCS) achando que era o nosso.
        // Só serve casar pelo NOME que acabamos de pedir.
        const rem = arquivos.find((a) => a.nomeArquivo === nome);
        if (!rem) {
            log(`   ⚠️ arquivo "${nome}" não encontrado entre os ${arquivos.length} do lote:`);
            for (const a of arquivos) log(`      gabCod=${a.gabCod} ${a.nomeArquivo}`);
        }
        if (!rem?.conteudo) {
            log('   remessa gerada mas sem conteúdo legível — verificar na tela.');
        } else {
            gabCod = rem.gabCod;
            estado.gabCod = gabCod;
            estado.arquivo = rem.nomeArquivo;
            salvarEstado();
            const caminho = `${OUT}/${rem.nomeArquivo ?? `flp${flpCod}`}`;
            writeFileSync(caminho, rem.conteudo);
            console.log(`\n${'='.repeat(78)}`);
            console.log(
                `.REM — ${rem.nomeArquivo} · gabCod ${gabCod} · ${rem.conteudo.length} chars`,
            );
            console.log(`arquivo: ${caminho}`);
            console.log('='.repeat(78));
            for (const l of rem.conteudo.split(/\r?\n/)) {
                if (l.trim()) console.log(`${tipoRegistro(l).padEnd(16)}| ${l}`);
            }
            console.log('='.repeat(78));
        }
    } catch (e) {
        console.log(`\n❌ FALHA: ${erroDe(e)}`);
        console.log('\nNÃO vou repetir a chamada — as escritas não são idempotentes.');
        console.log(`Estado em ${OUT}/ESTADO.json:`);
        console.log(
            `   flpCod=${flpCod ?? '—'} gabCod=${gabCod ?? '—'} finalizado=${estado.finalizado ?? false}`,
        );
    } finally {
        // ══ 5) DESFAZER, na mesma sessão ════════════════════════════════════
        if (DESFAZER && flpCod) {
            console.log('\n5) DESFAZENDO');
            if (gabCod) {
                try {
                    await base.putGenericOnce(
                        `fin015/gerArquivosBancos/cancelar/${gabCod}`,
                        {},
                        { filCod: FIL },
                    );
                    log(`   arquivo de remessa ${gabCod} CANCELADO`);
                } catch (e) {
                    log(`   arquivo ${gabCod} não cancelado: ${erroDe(e)}`);
                }
            }
            try {
                await base.getGeneric(`fin015/cancelarLote/${FIL}/${BNC}/${flpCod}`, {
                    filCod: FIL,
                });
                log(`   lote ${flpCod} CANCELADO`);
            } catch (e) {
                log(`   lote ${flpCod} não cancelado: ${erroDe(e)}`);
                log(`   estornar: GET fin015/estornarLote/${FIL}/${BNC}/${flpCod}`);
            }
            // Confirma que o título voltou para os pendentes.
            try {
                const { rows } = await base.listGenericPaginated<Row>(
                    `fin015/finItemSispag/titulosPendentes/list/${FIL}/${BNC}/${Number(ctx.flpCod)}`,
                    {
                        fieldList: [],
                        filterList: { 'docCod#EQ': DOC },
                        serviceName: 'fin015',
                        pageNumber: 1,
                        pageSize: 50,
                    },
                    { filCod: FIL },
                );
                const voltou = rows.some(
                    (r) => String(r.docCod) === DOC && String(r.titCod ?? '1') === TIT,
                );
                log(
                    `   título doc ${DOC}/${TIT} de volta nos pendentes: ${voltou ? 'SIM ✅' : 'NÃO ⚠️ — conferir na tela'}`,
                );
            } catch (e) {
                log(`   verificação final falhou: ${erroDe(e)}`);
            }
        } else if (flpCod) {
            log(
                `\nMANTIDO em produção: lote ${flpCod}${gabCod ? `, remessa ${gabCod}` : ''}. Desfazer: rode sem MANTER.`,
            );
        }
        salvarEstado();
        console.log(`\nestado final em ${OUT}/ESTADO.json`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[exec-prd] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

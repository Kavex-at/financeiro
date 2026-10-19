import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';

/**
 * HML (escreve) — boleto agrupado: UM boleto paga N títulos via SISPAG (2026-10-19).
 *
 * Hipótese: Baixa Agrupada a Pagar (`fin146`) dos N títulos → borderô pendente → o `fin015`
 * importa o BORDERÔ como UM item (`borderosPendentes/importar`) → código de barras do boleto no
 * item → `.REM` paga uma vez → retorno processado baixa os N títulos. É o que a analista faz à mão
 * (paga o boleto e baixa cada título) dentro do SISPAG. Mede, em cada passo, o estado dos títulos
 * (`fin064`), da baixa agrupada, dos borderôs pendentes e do lote.
 *
 * Fases (`FASE`), todas releem o estado no fim e anexam em `${OUT}/trilha.jsonl`:
 *   ler           (padrão) só leitura: candidatos, baixas agrupadas e borderôs existentes, parser J
 *   criar146      POST fin146 (cabeçalho)                                    — ESCREVE em HML
 *   itens146      baixaAutomatica/list + confirmar com `DOCS` (ou `MODO_ITEM=item`) — ESCREVE
 *   finalizar146  POST fin146/finalizar/{BAG}                                — ESCREVE em HML
 *   lote          cria lote nativo com `DEBITO`                              — ESCREVE em HML
 *   importar      borderosPendentes/importar do borderô `BOR` no lote `FLP`  — ESCREVE em HML
 *   codbar        barra SINTÉTICA do valor do item, vencimento `DEBITO`      — ESCREVE em HML
 *   finalizar     finalizarLote `FLP`                                        — ESCREVE em HML
 *   remessa       gera e baixa o `.REM` (`SEQ`), decodifica o J              — ESCREVE em HML
 *   retorno       `.RET` sintético (ocorrência `00`) para os J + carregar + processar — ESCREVE
 *   estado        só leitura do estado
 * `EXTRA` (JSON) é mesclado no corpo da fase, para responder às validações do ERP sem editar o código.
 *
 * Travas: só HML, credenciais de `HML_ENV_FILE`, `databaseConnectionString=""`, 1 sessão; só barras
 * sintéticas; código de barras só mascarado (5+4) no console e nos arquivos.
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" FASE=ler npx tsx jobs/probe-hml-boleto-agrupado.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') || !process.env.HML_ENV_FILE) {
    console.error('RECUSADO: só HML, com HML_ENV_FILE.');
    process.exit(1);
}
if (process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: rode com databaseConnectionString="".');
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const FASE = process.env.FASE ?? 'ler';
/** `doc/tit,doc/tit` — os títulos do grupo. */
const DOCS = (process.env.DOCS ?? '')
    .split(',')
    .filter(Boolean)
    .map((s) => {
        const [doc, tit] = s.split('/');
        return { doc: String(doc), tit: String(tit ?? '1') };
    });
const BAG = process.env.BAG ?? '';
const BOR = process.env.BOR ?? '';
const FLP = process.env.FLP ?? '';
const DEBITO = process.env.DEBITO ?? '';
const GER = Number(process.env.GER ?? 37);
const GTB = Number(process.env.GTB ?? 1);
const SEQ = Number(process.env.SEQ ?? 70);
const BOR_TIPO = Number(process.env.BOR_TIPO ?? 2);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-boleto-agrupado';
const EXTRA = JSON.parse(process.env.EXTRA ?? '{}') as Record<string, unknown>;
type Row = Record<string, unknown>;

const log = (s: string): void => console.log(`[hml-agrupado] ${s}`);
const mask = (s: unknown): string => {
    const t = String(s ?? '').replace(/\D/g, '');
    return t.length >= 44 ? `${t.slice(0, 5)}…${t.slice(-4)}` : t;
};
const sanea = (v: unknown): unknown =>
    v === undefined ? null : JSON.parse(JSON.stringify(v).replace(/\d{30,}/g, (m) => mask(m)));
const txt = (v: unknown, n = 900): string => JSON.stringify(sanea(v)).slice(0, n);
const erro = (e: unknown): Row => {
    const err = e as {
        message?: string;
        response?: { status?: unknown; data?: unknown };
        cause?: { response?: { status?: unknown; data?: unknown } };
    };
    const r = err.response ?? err.cause?.response;
    return { status: r?.status, data: sanea(r?.data ?? String(err.message ?? e).slice(0, 300)) };
};
const civil = (v: unknown): string =>
    typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : String(v ?? '');
const epoch = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const cheios = (r: Row | undefined): Row =>
    r ? Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== '')) : {};
const hoje = (): string => new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const sispag = container.resolve(ConexosSispagClient);
    const retorno = container.resolve(ConexosSispagRetornoClient);
    await base.ensureSid();
    log(`BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC} · fase ${FASE}`);
    const trilha = (passo: string, dados: unknown): void => {
        appendFileSync(
            `${OUT}/trilha.jsonl`,
            `${JSON.stringify({ em: new Date().toISOString(), fase: FASE, passo, dados: sanea(dados) })}\n`,
        );
    };
    const tentar = async <T>(passo: string, fn: () => Promise<T>): Promise<T | undefined> => {
        try {
            await base.ensureSid();
            const r = await fn();
            log(`${passo}: OK ${txt(r, 700)}`);
            trilha(passo, { ok: true, r });
            return r;
        } catch (e) {
            const er = erro(e);
            log(`${passo}: FALHOU ${txt(er)}`);
            trilha(passo, { ok: false, erro: er });
            return undefined;
        }
    };
    const listar = async (path: string, filterList: Row, serviceName: string): Promise<Row[]> => {
        const res = await base.listGenericPaginated<Row>(
            path,
            { fieldList: [], filterList, pageNumber: 1, pageSize: 200, serviceName },
            { filCod: FIL },
        );
        return res.rows ?? [];
    };
    /** POST com protocolo de PERGUNTA do ERP: responde YES (decisão de HML). */
    const postComPergunta = async (path: string, corpo: Row): Promise<unknown> => {
        try {
            return await base.postGenericOnce<unknown>(path, corpo, { filCod: FIL });
        } catch (e) {
            const data = (e as { response?: { data?: Row } }).response?.data;
            const qs = (data?.questions ?? []) as Array<{ id?: string | number; key?: string }>;
            if (data?.type !== 'QUESTION' || qs.length === 0) throw e;
            log(`pergunta(s) do ERP: ${qs.map((q) => q.key).join(', ')} → YES`);
            const answers: Record<string, string> = {};
            for (const q of qs) if (q.id !== undefined) answers[String(q.id)] = 'YES';
            return base.postGenericOnce<unknown>(path, { ...corpo, answers }, { filCod: FIL });
        }
    };

    // ── estado: títulos, baixa agrupada, borderôs pendentes, lote ─────────────
    const estado = async (rotulo: string): Promise<{ bordero?: Row; itens: Row[] }> => {
        const titulos: Row[] = [];
        for (const d of DOCS) {
            const ls = await listar('fin064/list', { 'docCod#EQ': d.doc }, 'fin064').catch(
                () => [] as Row[],
            );
            for (const l of ls.filter((x) => String(x.titCod ?? '1') === d.tit)) {
                titulos.push({
                    doc: `${l.docCod}/${l.titCod}`,
                    pesCod: l.pesCod,
                    titMnyValor: l.titMnyValor,
                    totalAberto: l.totalAberto,
                    totalPago: l.totalPago,
                    vldPago: l.vldPago,
                    vldPendente: l.vldPendente,
                    vldLib: l.vldLib,
                    venc: civil(l.titDtaVencimento),
                });
            }
            if (ls.length === 0) titulos.push({ doc: `${d.doc}/${d.tit}`, fin064: 'ausente' });
        }
        log(`${rotulo} · títulos: ${txt(titulos, 1500)}`);
        let bag: Row | undefined;
        let bagItens: Row[] = [];
        if (BAG) {
            bag = await base
                .getGeneric<Row>(`fin146/${BAG}`, { filCod: FIL })
                .catch(() => undefined);
            bagItens = await listar('fin146/item/list', { 'bagCod#EQ': BAG }, 'fin146').catch(
                () => [] as Row[],
            );
            log(`${rotulo} · fin146 ${BAG}: ${txt(cheios(bag), 700)}`);
            log(`${rotulo} · fin146 itens: ${txt(bagItens.map(cheios), 1200)}`);
        }
        let bordero: Row | undefined;
        let itens: Row[] = [];
        let borderos: Row[] = [];
        const flp = FLP || undefined;
        if (flp) {
            borderos = await listar(
                `fin015/finItemSispag/borderosPendentes/list/${FIL}/${BNC}/${flp}`,
                {},
                'fin015',
            ).catch((e) => {
                log(`${rotulo} · borderosPendentes falhou ${txt(erro(e))}`);
                return [] as Row[];
            });
            const alvo = BOR || String(bag?.borCod ?? '');
            bordero = borderos.find((b) => String(b.borCod) === alvo);
            log(
                `${rotulo} · borderôs pendentes (lote ${flp}): ${borderos.length}; alvo ${alvo || '-'}: ${txt(cheios(bordero), 600)}`,
            );
            itens = (
                await write
                    .lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod: Number(flp) })
                    .catch(() => ({ itens: [] as Array<{ row: Row }> }))
            ).itens.map((i) => i.row);
            log(
                `${rotulo} · itens do lote: ${txt(
                    itens.map((i) => ({
                        seq: i.itsCodSeq,
                        doc: `${i.docCod ?? '-'}/${i.titCod ?? '-'}`,
                        borCod: i.borCod,
                        borVldTipo: i.borVldTipo,
                        modalidade: i.itsVldModalidade,
                        valor: i.itsMnyValor,
                        vlrPgto: i.itsMnyVlrPgto,
                        codbar: mask(i.itsNumCodbar),
                        dtaPgto: civil(i.itsDtaPgto),
                        rej: i.itsVldRej,
                    })),
                    1500,
                )}`,
            );
        }
        trilha(`estado:${rotulo}`, { titulos, bag: cheios(bag), bagItens, bordero, itens });
        return { bordero, itens };
    };

    // ── fases ────────────────────────────────────────────────────────────────
    if (FASE === 'ler') {
        const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
        const ctx = lotes.find((l) => l.status === 0) ?? lotes[lotes.length - 1];
        log(`lotes nativos: ${lotes.length}; contexto flp ${ctx?.flpCod} (status ${ctx?.status})`);
        if (ctx) {
            const pend = await write.listarTitulosPendentes({
                filCod: FIL,
                bncCod: BNC,
                flpCod: ctx.flpCod,
            });
            const porPessoa = new Map<string, Row[]>();
            for (const p of pend) {
                const k = String(p.raw.pesCod ?? '');
                porPessoa.set(k, [...(porPessoa.get(k) ?? []), p.raw]);
            }
            const grupos = [...porPessoa.entries()]
                .filter(([, ts]) => ts.length >= 2)
                .map(([pes, ts]) => ({
                    pes,
                    nome: ts[0]?.dpeNomPessoa,
                    n: ts.length,
                    titulos: ts
                        .filter((t) => Number(t.titMnyValor) <= 5000)
                        .slice(0, 6)
                        .map((t) => ({
                            doc: `${t.docCod}/${t.titCod}`,
                            fil: t.filCod,
                            valor: t.titMnyValor,
                            venc: civil(t.titDtaVencimento),
                        })),
                }))
                .sort((a, b) => b.n - a.n);
            log(`pendentes ${pend.length}; favorecidos com ≥2: ${grupos.length}`);
            for (const g of grupos.slice(0, 8)) log(`   ${txt(g, 600)}`);
            trilha('candidatos', grupos.slice(0, 20));
            const bp = await listar(
                `fin015/finItemSispag/borderosPendentes/list/${FIL}/${BNC}/${ctx.flpCod}`,
                {},
                'fin015',
            ).catch((e) => {
                log(`borderosPendentes falhou ${txt(erro(e))}`);
                return [] as Row[];
            });
            log(
                `borderôs pendentes existentes: ${bp.length} ${txt(bp.slice(0, 5).map(cheios), 1200)}`,
            );
            trilha('borderosPendentes', bp.slice(0, 20));
        }
        const bags = await listar('fin146/list', {}, 'fin146').catch((e) => {
            log(`fin146/list falhou ${txt(erro(e))}`);
            return [] as Row[];
        });
        log(`baixas agrupadas existentes: ${bags.length} ${txt(bags.slice(-5).map(cheios), 1500)}`);
        trilha('fin146', bags.slice(-20));
        const last = bags[bags.length - 1];
        if (last?.bagCod !== undefined) {
            const it = await listar(
                'fin146/item/list',
                { 'bagCod#EQ': last.bagCod },
                'fin146',
            ).catch(() => [] as Row[]);
            log(`itens da baixa agrupada ${String(last.bagCod)}: ${txt(it.map(cheios), 1200)}`);
        }
        const auto = await listar(
            `fin146/baixaAutomatica/list/${epoch(hoje())}`,
            {},
            'fin146',
        ).catch((e) => {
            log(`baixaAutomatica/list falhou ${txt(erro(e))}`);
            return [] as Row[];
        });
        log(`baixaAutomatica/list(hoje): ${auto.length} ${txt(auto.slice(0, 3).map(cheios), 900)}`);
        // Parser do retorno (ger015): o trecho do segmento J, para o `.RET` sintético.
        const cfg = await listar('ger015/list', {}, 'ger015').catch(() => [] as Row[]);
        for (const c of cfg.filter((x) => Number(x.bncCod) === BNC)) {
            const sql = String(c.gtbLngSql ?? '');
            writeFileSync(`${OUT}/ger015-${String(c.gtbCodSeq)}.sql`, sql);
            log(
                `ger015 gtb ${String(c.gtbCodSeq)} "${String(c.gtbDesNome)}": ${sql.length} chars salvos`,
            );
        }
        await estado('ler');
        return;
    }

    if (FASE === 'bordero') {
        // `BORS=fil:bor,fil:bor` — cabeçalho e baixas de cada borderô do fin010 (só leitura).
        for (const par of (process.env.BORS ?? '').split(',').filter(Boolean)) {
            const [fil, bor] = par.split(':');
            const cab = await base
                .getGeneric<Row>(`fin010/${fil}/${bor}`, { filCod: Number(fil) })
                .catch((e) => ({ erro: erro(e) }));
            log(`borderô ${fil}/${bor}: ${txt(cheios(cab as Row), 900)}`);
            const bx = await base
                .listGenericPaginated<Row>(
                    `fin010/baixas/list/${bor}`,
                    {
                        fieldList: [],
                        filterList: {},
                        pageNumber: 1,
                        pageSize: 50,
                        serviceName: 'fin010',
                    },
                    { filCod: Number(fil) },
                )
                .then((r) => r.rows ?? [])
                .catch(() => [] as Row[]);
            log(`   baixas: ${txt(bx.map(cheios), 2500)}`);
            trilha(`bordero:${par}`, { cab, bx });
        }
        return;
    }

    if (FASE === 'cancelar146') {
        if (!BAG) return log('informe BAG.');
        await tentar('fin146/cancelar', () =>
            postComPergunta(`fin146/cancelar/${BAG}`, { ...EXTRA }),
        );
    } else if (FASE === 'criarBor') {
        // Borderô do fin010 EM CADASTRO (`borVldFinalizado 0`) com a conta bancária: o que a
        // analista deixa pendente para o SISPAG (borderôs 34/39 de HML).
        await tentar('POST fin010', () =>
            postComPergunta('fin010', {
                filCod: FIL,
                borVldTipo: 2,
                borVldFinalizado: 0,
                frontModelName: 'bordero',
                borDtaMvto: epoch(DEBITO || hoje()),
                gerNum: GER,
                ...EXTRA,
            }),
        );
    } else if (FASE === 'baixaBor') {
        if (!BOR || DOCS.length === 0) return log('informe BOR e DOCS.');
        for (const d of DOCS) {
            const chave = {
                filCod: FIL,
                borCod: Number(BOR),
                borVldTipo: 2,
                docTip: 2,
                docCod: Number(d.doc),
                titCod: Number(d.tit),
            };
            const v = await tentar(`validacao/tituloBaixa ${d.doc}`, () =>
                base.postGenericOnce<{ responseData?: Row }>(
                    'fin010/baixas/validacao/tituloBaixa',
                    {
                        ...chave,
                        bxaVldSistema: 0,
                        bxaVldCcorrente: 0,
                        bxaVldCorrenteDc: 1,
                        bxaVldAdto: 0,
                        frontModelName: 'baixa',
                    },
                    { filCod: FIL },
                ),
            );
            const dados = v?.responseData ?? {};
            const valor = Number(dados.bxaMnyValor ?? 0);
            if (!valor) {
                log(`sem valor validado para ${d.doc}; pulando.`);
                continue;
            }
            await tentar(`POST fin010/baixas ${d.doc}`, () =>
                postComPergunta('fin010/baixas', {
                    ...dados,
                    ...chave,
                    gerNum: GER,
                    bxaMnyValor: valor,
                    bxaMnyJuros: 0,
                    bxaMnyMulta: 0,
                    bxaMnyDesconto: 0,
                    bxaMnyLiquido: valor,
                    bxaVldSistema: 0,
                    bxaVldCcorrente: 0,
                    bxaVldCorrenteDc: 1,
                    bxaVldAdto: 0,
                    frontModelName: 'baixa',
                    ...EXTRA,
                }),
            );
        }
    } else if (FASE === 'cru') {
        // POST cru (`CRU_PATH`, corpo = `EXTRA`), para ler o eco de validação do ERP.
        const path = process.env.CRU_PATH ?? '';
        if (!path.startsWith('fin015/') && !path.startsWith('fin010/'))
            return log('CRU_PATH inválido.');
        await tentar(`POST ${path}`, () =>
            base.postGenericOnce<unknown>(path, EXTRA, { filCod: FIL }),
        );
    } else if (FASE === 'apagarBor') {
        // Limpeza de teste: exclui as baixas e o borderô EM CADASTRO `BOR`.
        if (!BOR) return log('informe BOR.');
        const bx = await base
            .listGenericPaginated<Row>(
                `fin010/baixas/list/${BOR}`,
                {
                    fieldList: [],
                    filterList: {},
                    pageNumber: 1,
                    pageSize: 50,
                    serviceName: 'fin010',
                },
                { filCod: FIL },
            )
            .then((r) => r.rows ?? []);
        for (const b of bx) {
            await tentar(`DELETE baixa ${String(b.docCod)}`, () =>
                base.deleteGeneric<unknown>(
                    `fin010/baixas/${BOR}/${String(b.docTip)}/${String(b.docCod)}/${String(b.titCod)}/${String(b.bxaCodSeq)}`,
                    { filCod: FIL },
                ),
            );
        }
        await tentar(`DELETE fin010/${BOR}`, () =>
            base.deleteGeneric<unknown>(`fin010/${BOR}`, { filCod: FIL }),
        );
    } else if (FASE === 'criar146') {
        const corpo: Row = {
            filCod: FIL,
            bagDtaData: epoch(DEBITO || hoje()),
            borVldTipo: BOR_TIPO,
            gerNum: GER,
            ...EXTRA,
        };
        const r = await tentar('POST fin146', () => postComPergunta('fin146', corpo));
        if (r) writeFileSync(`${OUT}/fin146-criado.json`, JSON.stringify(sanea(r), null, 2));
    } else if (FASE === 'itens146') {
        if (!BAG || DOCS.length === 0) return log('informe BAG e DOCS.');
        if (process.env.MODO_ITEM === 'item') {
            for (const d of DOCS) {
                const item: Row = {
                    bagCod: Number(BAG),
                    borVldTipo: BOR_TIPO,
                    filCod: FIL,
                    docTip: Number(process.env.DOC_TIP ?? 2),
                    docCod: Number(d.doc),
                    titCod: Number(d.tit),
                    ...EXTRA,
                };
                const v = await tentar(`validacao/tituloBaixa ${d.doc}`, () =>
                    base.postGenericOnce<Row>('fin146/item/validacao/tituloBaixa', item, {
                        filCod: FIL,
                    }),
                );
                await tentar(`POST fin146/item ${d.doc}`, () =>
                    postComPergunta('fin146/item', { ...item, ...(v ?? {}), ...EXTRA }),
                );
            }
        } else {
            const data = epoch(DEBITO || hoje());
            const linhas: Row[] = [];
            for (const d of DOCS) {
                const ls = await listar(
                    `fin146/baixaAutomatica/list/${data}`,
                    { 'docCod#EQ': d.doc },
                    'fin146',
                ).catch((e) => {
                    log(`baixaAutomatica/list ${d.doc} falhou ${txt(erro(e))}`);
                    return [] as Row[];
                });
                const l = ls.find((x) => String(x.titCod) === d.tit);
                log(
                    `baixaAutomatica ${d.doc}/${d.tit}: ${l ? txt(cheios(l), 600) : 'não listado'}`,
                );
                if (l) linhas.push(l);
            }
            if (linhas.length !== DOCS.length)
                return log('nem todos os títulos listados; parando.');
            const items = linhas.map((l) => ({ ...l, bagCod: Number(BAG), borVldTipo: BOR_TIPO }));
            await tentar('baixaAutomatica/confirmar', () =>
                postComPergunta('fin146/baixaAutomatica/confirmar', {
                    borVldTipo: BOR_TIPO,
                    bagCod: Number(BAG),
                    items,
                    ...EXTRA,
                }),
            );
        }
    } else if (FASE === 'finalizar146') {
        if (!BAG) return log('informe BAG.');
        await tentar('fin146/finalizar', () =>
            postComPergunta(`fin146/finalizar/${BAG}`, { ...EXTRA }),
        );
    } else if (FASE === 'lote') {
        if (!DEBITO) return log('informe DEBITO (YYYY-MM-DD, ≥ hoje).');
        const contas = await sispag.listContasCorrentes(FIL);
        const conta = contas.find((c) => c.bncCod === BNC) ?? contas[0];
        if (!conta) return log('sem conta pagadora.');
        await tentar('criarLote', () =>
            write.criarLote({
                filCod: FIL,
                conta: {
                    bncCod: conta.bncCod,
                    bncNumCodbanco: 341,
                    ccoCod: conta.ccoCod,
                    ccoNumConta: conta.numeroConta ?? 0,
                    ccoEspDvconta: conta.dvConta ?? '',
                    ccoEspAgcod: conta.agencia ?? '',
                    conta: `${conta.numeroConta}-${conta.dvConta}`,
                    layoutConta: `AG:${conta.agencia}/CT:${conta.numeroConta}-${conta.dvConta}`,
                },
                dataDebito: epoch(DEBITO),
            }),
        );
    } else if (FASE === 'importar') {
        if (!FLP) return log('informe FLP (e BOR ou BAG).');
        const { bordero } = await estado('antes');
        if (!bordero) return log('borderô alvo não está nos pendentes do lote.');
        const selecao = { op: 1, bncCodFin015: BNC };
        const item: Row = {
            ...bordero,
            filCodLote: FIL,
            bncCod: BNC,
            flpCod: Number(FLP),
            ...selecao,
            ...EXTRA,
        };
        await tentar('borderosPendentes/importar', () =>
            postComPergunta('fin015/finItemSispag/borderosPendentes/importar', {
                items: [item],
                ...selecao,
                ...EXTRA,
            }),
        );
    } else if (FASE === 'codbar') {
        if (!FLP || !DEBITO) return log('informe FLP e DEBITO.');
        const { itens } = await estado('antes');
        const alvo = itens.find((i) => (BOR ? String(i.borCod) === BOR : i.borCod !== undefined));
        if (!alvo) return log('item do borderô não encontrado no lote.');
        const valor = Number(alvo.itsMnyValor ?? alvo.itsMnyVlrPgto ?? 0);
        const venc = epoch(DEBITO);
        const barras = CodigoBarrasSintetico.barras({
            valor,
            vencimento: DEBITO,
            serie: Number(process.env.SERIE ?? 7),
            banco: process.env.BANCO_BARRA ?? '341',
        });
        const linha = new CodigoBarrasBoleto().paraLinhaDigitavel(barras) as string;
        log(`barra sintética ${mask(barras)} · valor ${valor} · venc ${DEBITO}`);
        const modalidade = Number(process.env.MODALIDADE ?? alvo.itsVldModalidade ?? 7);
        const p = {
            filCod: FIL,
            bncCod: BNC,
            codigo: linha,
            valorLiquido: valor,
            vencimento: venc,
            modalidade,
        };
        const v = await tentar('validarCodigoBarras', () => write.validarCodigoBarras(p));
        if (!v) return;
        const c = await tentar('confirmarCodigoBarras', () =>
            write.confirmarCodigoBarras({ ...p, validacao: v }),
        );
        if (!c) return;
        await tentar('editarItemDoRascunho', () =>
            write.editarItemDoRascunho({
                filCod: FIL,
                bncCod: BNC,
                flpCod: Number(FLP),
                item: { ...alvo, itsVldModalidade: modalidade },
                alteracoes: {
                    itsNumCodbar: linha,
                    itsNumBanco: c.itsBncNumCodbancoResult,
                    bncDesNome: c.itsBncDesNomeResult,
                    itsMnyVlrPgto: c.itsMnyVlrPgtoResult,
                    itsDtaPgto: c.itsDtaPgtoResult,
                },
            }),
        );
    } else if (FASE === 'finalizar') {
        if (!FLP) return log('informe FLP.');
        await tentar('finalizarLote', () =>
            write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod: Number(FLP) }),
        );
    } else if (FASE === 'remessa') {
        if (!FLP) return log('informe FLP.');
        const nome = `PG${hoje().slice(8, 10)}${hoje().slice(5, 7)}${String(SEQ).padStart(2, '0')}.REM`;
        await tentar('gerarRemessa', () =>
            write.gerarRemessa({
                filCod: FIL,
                bncCod: BNC,
                flpCod: Number(FLP),
                grbCodSeq: 1,
                seqNum: SEQ,
                gabEspNomeArquivo: nome,
            }),
        );
        const arqs = await write.listarArquivosRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod: Number(FLP),
        });
        const rem = arqs.find((a) => a.conteudo);
        if (rem?.conteudo) {
            const js = rem.conteudo
                .split(/\r?\n/)
                .filter((l) => l[7] === '3' && l[13] === 'J' && l.slice(17, 19) !== '52')
                .map((l) => ({
                    codbar: mask(l.slice(17, 61)),
                    vencimento: l.slice(91, 99),
                    valorTitulo: Number(l.slice(99, 114)) / 100,
                    valorPagamento: Number(l.slice(152, 167)) / 100,
                    seuNumero: l.slice(182, 202),
                }));
            const segs = rem.conteudo
                .split(/\r?\n/)
                .filter((l) => l[7] === '3')
                .map((l) => l[13]);
            log(`.REM ${rem.nomeArquivo}: segmentos ${segs.join('')} · J ${txt(js, 800)}`);
            trilha('rem', { nome: rem.nomeArquivo, segs, js });
            writeFileSync(
                `${OUT}/${rem.nomeArquivo}.redigido.txt`,
                rem.conteudo.replace(/\d{44}/g, (m) => mask(m).padEnd(44, '#')),
            );
        }
    } else if (FASE === 'retorno') {
        if (!FLP) return log('informe FLP.');
        // Posições da ocorrência no J: por padrão 231-240, como no A (confirmar no ger015 salvo).
        const POS_OC = Number(process.env.POS_OC ?? 231);
        const arqs = await write.listarArquivosRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod: Number(FLP),
        });
        const rem = arqs.find((a) => a.conteudo);
        if (!rem?.conteudo) return log('lote sem .REM.');
        const poke = (l: string, pos: number, v: string): string =>
            l.slice(0, pos - 1) + v + l.slice(pos - 1 + v.length);
        let det = 0;
        const linhas = rem.conteudo
            .split(/\r?\n/)
            .filter((l) => l.trim())
            // J-52 (complemento) não carrega a chave do item nas posições 183-202; o parser
            // do ERP o rejeita como "arquivo não gerado pelo sistema". `SEM_J52=1` o omite.
            .filter(
                (l) => !(process.env.SEM_J52 === '1' && l[13] === 'J' && l.slice(17, 19) === '52'),
            )
            .map((l0) => {
                let l = l0.padEnd(240, ' ').slice(0, 240);
                if (l[7] === '0') l = poke(l, 143, '2');
                if (l[7] === '3' && (l[13] === 'J' || l[13] === 'A') && l.slice(17, 19) !== '52') {
                    l = poke(l, POS_OC, '00'.padEnd(10, ' '));
                    det += 1;
                }
                return l;
            });
        if (det === 0) return log('nenhum detalhe A/J no .REM.');
        const conteudo = `${linhas.join('\r\n')}\r\n`;
        const nome = (process.env.NOME ?? rem.nomeArquivo ?? `flp${FLP}.REM`).replace(
            /\.REM$/i,
            '.RET',
        );
        const arq = await tentar('carregarArquivoRetorno', () =>
            retorno.carregarArquivoRetorno({
                filCod: FIL,
                bncCod: BNC,
                gtbCodSeq: GTB,
                fileName: nome,
                conteudo: Buffer.from(conteudo, 'latin1'),
            }),
        );
        if (arq?.garCodSeq !== undefined) {
            await tentar('processarArquivoRetorno', () =>
                retorno.processarArquivoRetorno({
                    filCod: FIL,
                    bncCod: BNC,
                    gtbCodSeq: GTB,
                    garCodSeq: Number(arq.garCodSeq),
                    tipo: 1,
                }),
            );
            const erros = await retorno
                .listErros({
                    filCod: FIL,
                    bncCod: BNC,
                    gtbCodSeq: GTB,
                    garCodSeq: Number(arq.garCodSeq),
                })
                .catch(() => []);
            log(`erros do retorno: ${txt(erros, 900)}`);
            trilha('retorno', { gar: arq.garCodSeq, erros });
        }
    } else if (FASE !== 'estado') {
        return log(`fase desconhecida: ${FASE}`);
    }
    await estado('depois');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-agrupado] FATAL:', txt(erro(e)));
        process.exit(1);
    });

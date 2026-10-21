import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';

/**
 * HML (escreve) — medições do TDD do boleto agrupado (Task 1, ADR-0077, 2026-10-20).
 *
 * Complementa `probe-hml-boleto-agrupado.ts` (ciclo ponta a ponta de 2026-10-19). Mede o que a
 * implementação precisa antes de fechar as Tasks 7, 13–18:
 *   situacaoBorderos (só leitura) varre o `fin010/list` da filial (tipo 2) e conta os estados
 *                (`borVldFinalizado` × `borCodEstornado` × `borCodNovo` × `borDtaStatus`): o que
 *                marca um borderô cancelado (T9, 2026-10-21)
 *   marcadorLer  (só leitura) todas as chaves do `GET fin010/{fil}/{bor}` e da linha do
 *                `fin010/list` do borderô `BOR`: candidatos a campo de observação (G2)
 *   marcador     POST fin010 com `CAMPO=MARCA` (+ `gerNum`), relê no GET e filtra o
 *                `fin010/list` por `CAMPO#EQ`/`#LIKE`                          — ESCREVE em HML
 *   baixas       uma baixa por título (`DOCS`) no borderô `BOR`                 — ESCREVE em HML
 *   v2           estado no `fin064` dos `DOCS` com baixa em borderô em cadastro; presença nos
 *                pendentes do lote `FLP`; `importarTitulos` avulso (`V2_IMPORTAR=1` ESCREVE e
 *                remove o item se entrar)
 *   lote         lote nativo com `DEBITO`                                       — ESCREVE em HML
 *   importar     `borderosPendentes/importar` do `BOR` no `FLP`                 — ESCREVE em HML
 *   v5           barra SINTÉTICA de `BANCO_BARRA` com `MODALIDADE` no item do borderô — ESCREVE
 *   v3           limpeza: `excluirBaixa` com o item presente (espera recusa) → `DELETE` do item →
 *                releitura → `excluirBaixa` × N → `excluirBordero` → releitura  — ESCREVE em HML
 *   retornoLinha (só leitura) linhas de detalhe do `fin052` de `GAR` (todos os eventos do banco)
 *   estado       (só leitura) borderô `BOR`, baixas, títulos `DOCS` e itens do `FLP`
 *
 * Travas: só HML (URL com `-hml` e `HML_ENV_FILE`), `databaseConnectionString=""`, barras
 * sintéticas, código de barras mascarado 5+4 no console e na `trilha.jsonl`.
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" FASE=marcadorLer BOR=252 npx tsx jobs/probe-hml-boleto-agrupado-tdd.ts
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
const FASE = process.env.FASE ?? 'estado';
const DOCS = (process.env.DOCS ?? '')
    .split(',')
    .filter(Boolean)
    .map((s) => {
        const [doc, tit] = s.split('/');
        return { doc: String(doc), tit: String(tit ?? '1') };
    });
const BOR = process.env.BOR ?? '';
const FLP = process.env.FLP ?? '';
const DEBITO = process.env.DEBITO ?? '';
const GER = Number(process.env.GER ?? 38);
const GTB = Number(process.env.GTB ?? 1);
const GAR = Number(process.env.GAR ?? 7);
const CAMPO = process.env.CAMPO ?? '';
const MARCA = process.env.MARCA ?? '';
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-boleto-agrupado-tdd';
const EXTRA = JSON.parse(process.env.EXTRA ?? '{}') as Record<string, unknown>;
type Row = Record<string, unknown>;

const log = (s: string): void => console.log(`[hml-agrupado-tdd] ${s}`);
const mask = (s: unknown): string => {
    const t = String(s ?? '').replace(/\D/g, '');
    return t.length >= 44 ? `${t.slice(0, 5)}…${t.slice(-4)}` : t;
};
/** Mascara barras (5+4) e os pedaços da linha que o `validarCodigoBarras` devolve. */
const sanea = (v: unknown): unknown =>
    v === undefined
        ? null
        : JSON.parse(
              JSON.stringify(v, (k, x) => (k === 'splitCodBar' ? '[mascarado]' : x)).replace(
                  /\d{30,}/g,
                  (m) => mask(m),
              ),
          );
const txt = (v: unknown, n = 900): string => JSON.stringify(sanea(v)).slice(0, n);
const erro = (e: unknown): Row => {
    const err = e as {
        message?: string;
        response?: { status?: unknown; data?: unknown };
        cause?: { response?: { status?: unknown; data?: unknown }; cause?: unknown };
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
    const listar = async (
        path: string,
        filterList: Row,
        serviceName: string,
        fieldList: string[] = [],
    ): Promise<Row[]> => {
        const res = await base.listGenericPaginated<Row>(
            path,
            { fieldList, filterList, pageNumber: 1, pageSize: 200, serviceName },
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
    const lerBordero = async (bor: string): Promise<Row | undefined> =>
        base.getGeneric<Row>(`fin010/${FIL}/${bor}`, { filCod: FIL }).catch((e) => {
            log(`GET fin010/${FIL}/${bor}: ${txt(erro(e), 300)}`);
            return undefined;
        });
    const lerBaixas = async (bor: string): Promise<Row[]> =>
        listar(`fin010/baixas/list/${bor}`, {}, 'fin010').catch(() => [] as Row[]);
    const lerItens = async (): Promise<Row[]> =>
        FLP
            ? (
                  await write
                      .lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod: Number(FLP) })
                      .catch(() => ({ itens: [] as Array<{ row: Row }> }))
              ).itens.map((i) => i.row)
            : [];
    const resumoItem = (i: Row): Row => ({
        seq: i.itsCodSeq,
        fil: i.filCod,
        doc: `${i.docCod ?? '-'}/${i.titCod ?? '-'}`,
        borCod: i.borCod,
        modalidade: i.itsVldModalidade,
        valor: i.itsMnyValor,
        vlrPgto: i.itsMnyVlrPgto,
        codbar: mask(i.itsNumCodbar),
        banco: i.itsNumBanco,
    });
    const titulos = async (): Promise<Row[]> => {
        const out: Row[] = [];
        for (const d of DOCS) {
            const ls = await listar('fin064/list', { 'docCod#EQ': d.doc }, 'fin064').catch(
                () => [] as Row[],
            );
            const l = ls.find((x) => String(x.titCod ?? '1') === d.tit);
            out.push(
                l
                    ? {
                          doc: `${l.docCod}/${l.titCod}`,
                          pesCod: l.pesCod,
                          titMnyValor: l.titMnyValor,
                          totalAberto: l.totalAberto,
                          totalPago: l.totalPago,
                          vldPago: l.vldPago,
                          vldPendente: l.vldPendente,
                          vldLib: l.vldLib,
                          venc: civil(l.titDtaVencimento),
                      }
                    : { doc: `${d.doc}/${d.tit}`, fin064: 'ausente' },
            );
        }
        return out;
    };
    const estado = async (rotulo: string): Promise<{ itens: Row[]; baixas: Row[] }> => {
        const ts = await titulos();
        if (ts.length) log(`${rotulo} · títulos: ${txt(ts, 1500)}`);
        let bor: Row | undefined;
        let baixas: Row[] = [];
        if (BOR) {
            bor = await lerBordero(BOR);
            baixas = await lerBaixas(BOR);
            log(
                `${rotulo} · borderô ${BOR}: ${bor ? txt(pick(bor), 600) : 'AUSENTE'} · baixas ${baixas.length}`,
            );
        }
        const itens = await lerItens();
        if (FLP) log(`${rotulo} · itens do lote ${FLP}: ${txt(itens.map(resumoItem), 1500)}`);
        trilha(`estado:${rotulo}`, {
            titulos: ts,
            bordero: bor ? pick(bor) : null,
            baixas: baixas.map(cheios),
            itens: itens.map(resumoItem),
        });
        return { itens, baixas };
    };
    const pick = (b: Row): Row => ({
        borCod: b.borCod,
        filCod: b.filCod,
        borVldFinalizado: b.borVldFinalizado,
        vldHasBaixa: b.vldHasBaixa,
        vldHasRemessaPgto: b.vldHasRemessaPgto,
        gerNum: b.gerNum,
        borDtaMvto: civil(b.borDtaMvto),
        ...(CAMPO ? { [CAMPO]: b[CAMPO] } : {}),
    });

    if (FASE === 'situacaoBorderos') {
        const campos = [
            'borCod',
            'borVldFinalizado',
            'borCodEstornado',
            'borCodNovo',
            'borDtaStatus',
            'usnCodSta',
            'borDtaFinalizado',
            'botLotCodEstorno',
            'vldHasBaixa',
            'vldHasRemessaPgto',
            'usnCodCad',
        ];
        const linhas: Row[] = [];
        for (let pageNumber = 1; pageNumber <= 20; pageNumber += 1) {
            const res = await base.listGenericPaginated<Row>(
                'fin010/list',
                {
                    fieldList: campos,
                    filterList: { 'borVldTipo#EQ': 2 },
                    pageNumber,
                    pageSize: 200,
                    serviceName: 'fin010',
                },
                { filCod: FIL },
            );
            const rows = res.rows ?? [];
            linhas.push(...rows);
            if (rows.length < 200) break;
        }
        const presente = (v: unknown): string => (v === null || v === undefined ? '-' : 'sim');
        const contagem = new Map<string, number[]>();
        for (const r of linhas) {
            const chave = [
                `fin=${String(r.borVldFinalizado)}`,
                `estornado=${presente(r.borCodEstornado)}`,
                `novo=${presente(r.borCodNovo)}`,
                `dtaStatus=${presente(r.borDtaStatus)}`,
                `lotEstorno=${presente(r.botLotCodEstorno)}`,
                `dtaFinalizado=${presente(r.borDtaFinalizado)}`,
            ].join(' ');
            contagem.set(chave, [...(contagem.get(chave) ?? []), Number(r.borCod)]);
        }
        log(`fin010/list fil ${FIL} tipo 2: ${linhas.length} borderô(s)`);
        for (const [chave, cods] of [...contagem.entries()].sort()) {
            log(`   ${chave}: ${cods.length} — ex.: ${cods.slice(0, 8).join(',')}`);
        }
        trilha('situacaoBorderos', {
            total: linhas.length,
            estados: Object.fromEntries(
                [...contagem.entries()].map(([k, v]) => [k, { n: v.length, ex: v.slice(0, 8) }]),
            ),
        });
        return;
    }
    if (FASE === 'marcadorLer') {
        if (!BOR) return log('informe BOR.');
        const cab = await lerBordero(BOR);
        log(`GET fin010/${FIL}/${BOR}: ${Object.keys(cab ?? {}).length} chaves`);
        log(`   chaves: ${Object.keys(cab ?? {}).join(',')}`);
        log(`   valores: ${txt(cab, 4000)}`);
        const ls = await listar('fin010/list', { 'borCod#EQ': BOR }, 'fin010').catch((e) => {
            log(`fin010/list falhou ${txt(erro(e))}`);
            return [] as Row[];
        });
        log(`fin010/list borCod#EQ ${BOR}: ${ls.length} linha(s)`);
        log(`   chaves: ${Object.keys(ls[0] ?? {}).join(',')}`);
        log(`   valores: ${txt(ls[0], 4000)}`);
        trilha('marcadorLer', { cab, lista: ls[0] ?? null });
        return;
    }

    if (FASE === 'marcador') {
        if (!CAMPO || !MARCA) return log('informe CAMPO e MARCA.');
        const r = await tentar('POST fin010 (com marcador)', () =>
            postComPergunta('fin010', {
                filCod: FIL,
                borVldTipo: 2,
                borVldFinalizado: 0,
                frontModelName: 'bordero',
                borDtaMvto: epoch(DEBITO || hoje()),
                gerNum: GER,
                [CAMPO]: MARCA,
                ...EXTRA,
            }),
        );
        const bor = String((r as Row | undefined)?.borCod ?? BOR);
        if (!bor) return;
        const cab = await lerBordero(bor);
        log(
            `releitura GET ${bor}: ${CAMPO}=${JSON.stringify(cab?.[CAMPO])} · gerNum ${cab?.gerNum}`,
        );
        trilha('marcador:get', { bor, valor: cab?.[CAMPO], cab });
        for (const op of ['EQ', 'LIKE']) {
            const v = op === 'LIKE' ? `%${MARCA.slice(0, 12)}%` : MARCA;
            await tentar(`fin010/list ${CAMPO}#${op}`, async () => {
                const ls = await listar('fin010/list', { [`${CAMPO}#${op}`]: v }, 'fin010', [
                    'borCod',
                    CAMPO,
                ]);
                return { n: ls.length, linhas: ls.slice(0, 5).map(cheios) };
            });
        }
        await tentar(`fin010/list borCod#EQ ${bor} (fieldList com ${CAMPO})`, async () => {
            const ls = await listar('fin010/list', { 'borCod#EQ': bor }, 'fin010', [
                'borCod',
                CAMPO,
                'gerNum',
                'borVldFinalizado',
            ]);
            return ls.map(cheios);
        });
        return;
    }

    if (FASE === 'baixas') {
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
    } else if (FASE === 'v2') {
        if (!FLP || DOCS.length === 0) return log('informe FLP e DOCS.');
        for (const d of DOCS) {
            const pend = await write
                .listarTitulosPendentes({
                    filCod: FIL,
                    bncCod: BNC,
                    flpCod: Number(FLP),
                    filtro: { 'docCod#EQ': d.doc },
                })
                .catch((e) => {
                    log(`titulosPendentes ${d.doc} falhou ${txt(erro(e))}`);
                    return [];
                });
            const linha = pend.find((p) => String(p.raw.titCod ?? '1') === d.tit)?.raw;
            log(
                `pendentes do lote ${FLP} · ${d.doc}/${d.tit}: ${linha ? `PRESENTE ${txt(cheios(linha), 600)}` : 'AUSENTE'}`,
            );
            trilha(`v2:pendente:${d.doc}`, { presente: Boolean(linha), linha: linha ?? null });
            // Linha guardada de quando o título ainda estava nos pendentes: a tentativa de
            // import avulso com a linha "velha" (o título já tem baixa num borderô em cadastro).
            const arquivo = `${OUT}/v2-linha-${d.doc}-${d.tit}.json`;
            if (linha) writeFileSync(arquivo, JSON.stringify(linha));
            const velha =
                !linha && existsSync(arquivo)
                    ? (JSON.parse(readFileSync(arquivo, 'utf8')) as Row)
                    : undefined;
            if (velha)
                log(`usando a linha guardada de ${d.doc}/${d.tit} (título fora dos pendentes)`);
            const aImportar = linha ?? velha;
            if (aImportar && process.env.V2_IMPORTAR === '1') {
                const antes = new Set((await lerItens()).map((i) => String(i.itsCodSeq)));
                // Mesmos campos que a `RemessaService` acrescenta à linha do grid. Corpo direto
                // (não o client) para que qualquer PERGUNTA do ERP seja respondida YES e a
                // validação de fundo (a baixa em borderô) apareça, se existir.
                const selecao = {
                    op: 1,
                    bncCodFin015: BNC,
                    titVldReflexoDdaAssoc: 0,
                    titVldReflexoDdaDesassoc: 0,
                };
                const item = {
                    ...aImportar,
                    filCodLote: FIL,
                    bncCod: BNC,
                    flpCod: Number(FLP),
                    ...selecao,
                    ...EXTRA,
                };
                await tentar(`importarTitulos avulso ${d.doc}/${d.tit}`, () =>
                    postComPergunta('fin015/finItemSispag/titulosPendentes/importar', {
                        items: [item],
                        ...selecao,
                    }),
                );
                const novos = (await lerItens()).filter(
                    (i) => !antes.has(String(i.itsCodSeq)) && String(i.docCod) === d.doc,
                );
                log(`itens novos do ${d.doc}: ${txt(novos.map(resumoItem), 600)}`);
                trilha(`v2:import:${d.doc}`, { novos: novos.map(resumoItem) });
                for (const n of novos) {
                    await tentar(`DELETE item ${String(n.itsCodSeq)} (desfaz V2)`, async () => {
                        await write.removerItemDoRascunho({
                            filCod: FIL,
                            bncCod: BNC,
                            flpCod: Number(FLP),
                            itsCodSeq: Number(n.itsCodSeq),
                            filCodItem: Number(n.filCod ?? FIL),
                        });
                        return true;
                    });
                }
            }
        }
        // Visão da carteira do fin015 (pendente/aberto) e do fin064 já vem do `estado`.
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
        if (!FLP || !BOR) return log('informe FLP e BOR.');
        const pend = await listar(
            `fin015/finItemSispag/borderosPendentes/list/${FIL}/${BNC}/${FLP}`,
            {},
            'fin015',
        ).catch(() => [] as Row[]);
        const bordero = pend.find((b) => String(b.borCod) === BOR);
        log(`borderôs pendentes do lote ${FLP}: ${pend.length}; alvo ${txt(cheios(bordero), 500)}`);
        if (!bordero) return log('borderô alvo não está nos pendentes do lote.');
        const selecao = { op: 1, bncCodFin015: BNC };
        await tentar('borderosPendentes/importar', () =>
            postComPergunta('fin015/finItemSispag/borderosPendentes/importar', {
                items: [
                    {
                        ...bordero,
                        filCodLote: FIL,
                        bncCod: BNC,
                        flpCod: Number(FLP),
                        itemy: 1,
                        ...selecao,
                    },
                ],
                ...selecao,
            }),
        );
    } else if (FASE === 'v5') {
        if (!FLP || !DEBITO || !BOR) return log('informe FLP, DEBITO e BOR.');
        const itens = await lerItens();
        const alvo = itens.find((i) => String(i.borCod) === BOR);
        if (!alvo) return log('item do borderô não encontrado no lote.');
        const valor = Number(alvo.itsMnyValor ?? alvo.itsMnyVlrPgto ?? 0);
        const banco = process.env.BANCO_BARRA ?? '341';
        const barras = CodigoBarrasSintetico.barras({
            valor,
            vencimento: DEBITO,
            serie: Number(process.env.SERIE ?? 11),
            banco,
        });
        const linha = new CodigoBarrasBoleto().paraLinhaDigitavel(barras) as string;
        const modalidade = Number(process.env.MODALIDADE ?? 6);
        log(
            `barra sintética banco ${banco} ${mask(barras)} · valor ${valor} · modalidade ${modalidade}`,
        );
        const p = {
            filCod: FIL,
            bncCod: BNC,
            codigo: linha,
            valorLiquido: valor,
            vencimento: epoch(DEBITO),
            modalidade,
        };
        const v = await tentar('validarCodigoBarras', () => write.validarCodigoBarras(p));
        if (!v) return;
        const c = await tentar('confirmarCodigoBarras', () =>
            write.confirmarCodigoBarras({ ...p, validacao: v }),
        );
        if (!c) return;
        await tentar(`editarItemDoRascunho (modalidade ${modalidade})`, () =>
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
    } else if (FASE === 'v3') {
        if (!FLP || !BOR) return log('informe FLP e BOR.');
        const { itens, baixas } = await estado('v3:inicio');
        const item = itens.find((i) => String(i.borCod) === BOR);
        const exclui = (b: Row, rotulo: string): Promise<unknown> =>
            tentar(`excluirBaixa ${String(b.docCod)}/${String(b.titCod)} (${rotulo})`, () =>
                base.deleteGeneric<unknown>(
                    `fin010/baixas/${BOR}/${String(b.docTip ?? 2)}/${String(b.docCod)}/${String(b.titCod ?? 1)}/${String(b.bxaCodSeq)}`,
                    { filCod: FIL },
                ),
            );
        // (a) ordem errada de propósito: excluir a baixa com o item importado presente.
        if (item && baixas[0] && process.env.V3_ORDEM_ERRADA !== '0') {
            await exclui(baixas[0], 'item presente');
            await tentar(`excluirBordero ${BOR} (item presente)`, () =>
                base.deleteGeneric<unknown>(`fin010/${BOR}`, { filCod: FIL }),
            );
            await estado('v3:apos-ordem-errada');
        }
        // (b) ordem I21q.
        if (item) {
            const r = await tentar(`DELETE item ${String(item.itsCodSeq)}`, async () => {
                await write.removerItemDoRascunho({
                    filCod: FIL,
                    bncCod: BNC,
                    flpCod: Number(FLP),
                    itsCodSeq: Number(item.itsCodSeq),
                    filCodItem: Number(item.filCod ?? FIL),
                });
                return true;
            });
            const depois = await lerItens();
            const ainda = depois.some((i) => String(i.itsCodSeq) === String(item.itsCodSeq));
            log(
                `releitura do item: ${ainda ? 'AINDA PRESENTE' : 'ausente'} (DELETE ${r === undefined ? 'falhou' : 'ok'})`,
            );
            trilha('v3:item-releitura', { ainda, deleteOk: r !== undefined });
            const pend = await listar(
                `fin015/finItemSispag/borderosPendentes/list/${FIL}/${BNC}/${FLP}`,
                {},
                'fin015',
            ).catch(() => [] as Row[]);
            const volta = pend.find((b) => String(b.borCod) === BOR);
            log(`borderô ${BOR} volta aos pendentes do lote? ${volta ? 'SIM' : 'não'}`);
            trilha('v3:pendente-apos-delete', { volta: Boolean(volta) });
            const cabApos = await lerBordero(BOR);
            log(`borderô após remover o item: ${cabApos ? txt(pick(cabApos), 300) : 'ausente'}`);
            trilha('v3:bordero-apos-delete-item', cabApos ? pick(cabApos) : null);
            if (ainda) return log('item ainda presente: parando antes de mexer nas baixas.');
        }
        for (const b of await lerBaixas(BOR)) await exclui(b, 'após remover item');
        await tentar(`excluirBordero ${BOR}`, () =>
            base.deleteGeneric<unknown>(`fin010/${BOR}`, { filCod: FIL }),
        );
        const cab = await lerBordero(BOR);
        const ls = await listar('fin010/list', { 'borCod#EQ': BOR }, 'fin010').catch(
            () => [] as Row[],
        );
        log(
            `releitura do borderô: GET ${cab ? txt(pick(cab), 300) : 'ausente'} · list ${ls.length}`,
        );
        trilha('v3:bordero-releitura', { get: cab ? pick(cab) : null, list: ls.length });
        for (const d of DOCS) {
            const pend = await write
                .listarTitulosPendentes({
                    filCod: FIL,
                    bncCod: BNC,
                    flpCod: Number(FLP),
                    filtro: { 'docCod#EQ': d.doc },
                })
                .catch(() => []);
            const volta = pend.some((p) => String(p.raw.titCod ?? '1') === d.tit);
            log(`título ${d.doc}/${d.tit} volta aos pendentes do fin015? ${volta ? 'SIM' : 'não'}`);
            trilha(`v3:titulo-pendente:${d.doc}`, { volta });
        }
    } else if (FASE === 'retornoLinha') {
        const arqs = await retorno
            .listArquivosRetorno({ filCod: FIL, bncCod: BNC, gtbCodSeq: GTB })
            .catch((e) => {
                log(`listArquivosRetorno falhou ${txt(erro(e))}`);
                return [];
            });
        const gar = arqs.find((a) => a.garCodSeq === GAR);
        log(`arquivo gar ${GAR}: ${txt(gar, 700)}`);
        const eventos = await retorno.listEventosBancarios({ filCod: FIL, bncCod: BNC });
        log(`eventos do banco ${BNC}: ${eventos.length}`);
        let total = 0;
        for (const ev of eventos) {
            for (const tipo of [ev.tipo]) {
                const ls = await listar(
                    'fin052/arquivosRetornoDetalhe/list',
                    {
                        'bncCod#EQ': BNC,
                        'gtbCodSeq#EQ': GTB,
                        'garCodSeq#EQ': GAR,
                        'fbeEspCod#EQ': ev.cod,
                        'fbeVldTipo#EQ': tipo,
                    },
                    'fin052',
                ).catch(() => [] as Row[]);
                if (ls.length === 0) continue;
                total += ls.length;
                log(
                    `evento ${ev.cod} (tipo ${tipo}, ${ev.descricao ?? '-'}): ${ls.length} linha(s)`,
                );
                for (const l of ls) log(`   ${txt(cheios(l), 2500)}`);
                trilha(`retornoLinha:${ev.cod}`, ls);
            }
        }
        log(`total de linhas de detalhe da gar ${GAR}: ${total}`);
        return;
    } else if (FASE !== 'estado') {
        return log(`fase desconhecida: ${FASE}`);
    }
    await estado('depois');
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-agrupado-tdd] FATAL:', txt(erro(e)));
        process.exit(1);
    });

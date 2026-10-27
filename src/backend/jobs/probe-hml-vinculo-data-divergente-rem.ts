import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import HmlDataDivergenteCasos from './hmlDataDivergenteCasos.js';

/**
 * MEDIÇÃO HML (ESCREVE) — T0.1 / V11 e T0.2 / V12 do vínculo com data divergente (ADR-0078).
 *
 * Responde, com o ERP de HML e barras SINTÉTICAS (valor = valor do título):
 *  - V12: o segmento J do `.REM` leva a data do TÍTULO ou a da BARRA (lote `L-J`)?
 *  - V11/R2: o `finalizar` recusa `dataDebito > itsDtaPgto` (lote `L-R2`)?
 *  - V11/R8: barra de sábado com débito na segunda: o ERP compara rolada ou não (lote `L-ROLAGEM`)?
 *
 * O QUE ESCREVE NO ERP DE HML (nada em PRD; o título em si NÃO é alterado, sem `fin026`):
 *   por lote (3 no total): `criarLote` (fin015) → `importar` 1 título pendente por item →
 *   `validacao/codigoBarras` + `confirmaCodigoBarras` + `PUT` do item (vínculo) → `finalizarLote`.
 *   Só no `L-J`: `gerarRemessa`, que cria o `.REM` NO ERP DE HML (o arquivo NUNCA é enviado ao
 *   banco; o conteúdo é lido, decodificado e descartado — o console e o JSON só carregam a máscara).
 * LIMPEZA: o client não tem cancelar lote. Como em V1–V9, os 3 lotes (um deles finalizado, com
 * remessa) FICAM em HML; o probe lista os `flpCod` e os títulos consumidos (use `JA_USADOS=...`).
 *
 * Sem `EXECUTAR=1` (ou com `--dry`) só lista os lotes/itens planejados: NENHUMA chamada ao ERP.
 * Com `EXECUTAR=1` e sem `ESCREVER=1`, loga em e descobre os títulos candidatos (só leitura).
 *
 * SEGURANÇA (recusa e sai com 1): base com `-hml`; credenciais só de `HML_ENV_FILE`;
 * `databaseConnectionString=""`; só barras sintéticas; 1 sessão, sequencial.
 *
 * Opcionais: `CASOS=L-ROLAGEM` (lista; padrão = todos) e `SABADO=2026-11-07` (sábado do L-ROLAGEM,
 * cuja segunda seguinte seja dia útil; débito = essa segunda, barra = o sábado).
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" EXECUTAR=1 ESCREVER=1 \
 *   npx tsx jobs/probe-hml-vinculo-data-divergente-rem.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const DRY = process.argv.includes('--dry') || process.env.EXECUTAR !== '1';
const ESCREVER = !DRY && process.env.ESCREVER === '1';
if (!DRY) {
    if (!BASE.includes('-hml')) {
        console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
        process.exit(1);
    }
    if (!process.env.HML_ENV_FILE) {
        console.error('RECUSADO: informe HML_ENV_FILE (credenciais de HML; nunca o .env de PRD).');
        process.exit(1);
    }
    if (process.env.databaseConnectionString !== '') {
        console.error('RECUSADO: rode com databaseConnectionString="".');
        process.exit(1);
    }
}
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const MODALIDADE_IMPORT = Number(process.env.MODALIDADE ?? 7);
const SEQ_REMESSA = Number(process.env.SEQ ?? 80);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-vinculo-data-divergente';
const JA_USADOS = new Set((process.env.JA_USADOS ?? '').split(',').filter(Boolean));
const log = (s: string): void => console.log(`[hml-data-div-rem] ${s}`);
const civil = (epoch: number): string => new Date(epoch).toISOString().slice(0, 10);
const sanea = (v: unknown): unknown =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v).replace(/\d{20,}/g, '…'));

type Row = Record<string, unknown>;

const erroSeguro = (e: unknown): Row => {
    const err = e as {
        name?: string;
        code?: string;
        message?: string;
        userMessage?: string;
        response?: { status?: unknown; data?: unknown };
    };
    return {
        nome: err.name,
        code: err.code,
        message: String(err.message ?? e)
            .replace(/\d{20,}/g, '…')
            .slice(0, 400),
        userMessage: err.userMessage ? String(err.userMessage).replace(/\d{20,}/g, '…') : undefined,
        status: err.response?.status,
        data: sanea(err.response?.data),
    };
};

/** Segmentos J (≠ J-52) de um CNAB 240 Itaú: o que o banco receberia. Só datas e valores. */
const decodificarJ = (conteudo: string): Array<{ vencimento: string; dataPagamento: string }> =>
    conteudo
        .split(/\r?\n/)
        .filter((l) => l.length >= 167 && l[7] === '3' && l[13] === 'J' && l.slice(17, 19) !== '52')
        .map((l) => {
            const dd = (s: string): string => `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
            return { vencimento: dd(l.slice(91, 99)), dataPagamento: dd(l.slice(144, 152)) };
        });

type Pendente = Awaited<ReturnType<ConexosSispagWriteClient['listarTitulosPendentes']>>[number];
type Livre = { p: Pendente; valor: number; venc: number };
type Lote = ReturnType<typeof HmlDataDivergenteCasos.lotes>[number];
type Ref = { id: string; titulo: string; barra: string; doc: unknown };
type Ctx = {
    base: ConexosBaseClient;
    write: ConexosSispagWriteClient;
    conv: CodigoBarrasBoleto;
    calendar: BankingCalendar;
    conta: Awaited<ReturnType<ConexosSispagClient['listContasCorrentes']>>[number];
};

const criarLote = async (ctx: Ctx, debito: string): Promise<number> => {
    const { conta } = ctx;
    const criado = await ctx.write.criarLote({
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
        dataDebito: ctx.calendar.toErpEpoch(debito),
    });
    return criado.flpCod;
};

const IMPORT_PATH = 'fin015/finItemSispag/titulosPendentes/importar';

/** Responde YES às perguntas do ERP (decisão de HML, como em V1) e reenvia o import. */
const responderPerguntas = async (ctx: Ctx, corpo: Row, e: unknown): Promise<Row> => {
    const data = (e as { response?: { data?: Row } }).response?.data;
    const perguntas = (data?.questions ?? []) as Array<{ id?: string | number }>;
    if (data?.type !== 'QUESTION' || perguntas.length === 0) {
        return { importou: false, erro: erroSeguro(e) };
    }
    const answers: Record<string, string> = {};
    for (const q of perguntas) if (q.id !== undefined) answers[String(q.id)] = 'YES';
    try {
        await ctx.base.ensureSid();
        await ctx.base.postGenericOnce<unknown>(
            IMPORT_PATH,
            { ...corpo, answers },
            { filCod: FIL },
        );
        return { importou: true, perguntasRespondidas: perguntas.length };
    } catch (e2) {
        return { importou: false, erro: erroSeguro(e2) };
    }
};

/** Import sem código; responde YES às perguntas do ERP. */
const importar = async (ctx: Ctx, flpCod: number, x: Livre): Promise<Row> => {
    const selecao = {
        op: 1,
        bncCodFin015: BNC,
        titVldReflexoDdaAssoc: 0,
        titVldReflexoDdaDesassoc: 0,
    };
    const item: Row = {
        ...x.p.raw,
        filCodLote: FIL,
        bncCod: BNC,
        flpCod,
        itsVldModalidade: MODALIDADE_IMPORT,
        itsEspNomeFav: x.p.raw.dpeNomPessoa,
        itsMnyValor: x.valor,
        itsMnyVlrPgto: x.valor,
        titMnyLiquido: x.valor,
        itsDtaPgto: x.venc,
        vldOk: 1,
        vldImporta: 1,
        avisos: '[]',
    };
    const corpo: Row = { items: [{ ...item, ...selecao }], ...selecao };
    try {
        await ctx.base.ensureSid();
        await ctx.base.postGenericOnce<unknown>(IMPORT_PATH, corpo, { filCod: FIL });
        return { importou: true };
    } catch (e) {
        return responderPerguntas(ctx, corpo, e);
    }
};

const lerLinhaDoRascunho = async (
    ctx: Ctx,
    flpCod: number,
    x: Livre,
): Promise<Record<string, unknown> | undefined> => {
    const lidos = await ctx.write.lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod });
    return lidos.itens.find((i) => String(i.docCod) === String(x.p.docCod))?.row;
};

/** Vincula a barra sintética ao item (validar → confirmar → PUT) e registra o que o ERP devolveu. */
const vincularBarra = async (
    ctx: Ctx,
    flpCod: number,
    x: Livre,
    barraVenc: string,
    serie: number,
    linha: Row,
): Promise<boolean> => {
    const barras = CodigoBarrasSintetico.barras({
        valor: x.valor,
        vencimento: barraVenc,
        banco: '341',
        serie,
    });
    const row = await lerLinhaDoRascunho(ctx, flpCod, x);
    if (!row) {
        linha.erro = 'item ausente no rascunho após importar';
        return false;
    }
    const p = {
        filCod: FIL,
        bncCod: BNC,
        codigo: ctx.conv.paraLinhaDigitavel(barras) as string,
        valorLiquido: x.valor,
        vencimento: x.venc,
        modalidade: MODALIDADE_IMPORT,
    };
    const v = await ctx.write.validarCodigoBarras(p);
    const c = await ctx.write.confirmarCodigoBarras({ ...p, validacao: v });
    await ctx.write.editarItemDoRascunho({
        filCod: FIL,
        bncCod: BNC,
        flpCod,
        item: row,
        alteracoes: {
            itsNumCodbar: p.codigo,
            itsNumBanco: c.itsBncNumCodbancoResult,
            bncDesNome: c.itsBncDesNomeResult,
            itsMnyVlrPgto: c.itsMnyVlrPgtoResult,
            itsDtaPgto: c.itsDtaPgtoResult,
        },
    });
    const depois = await lerLinhaDoRascunho(ctx, flpCod, x);
    linha.itsDtaPgtoResult = civil(c.itsDtaPgtoResult);
    linha.itsDtaPgtoRelido = depois?.itsDtaPgto ? civil(Number(depois.itsDtaPgto)) : null;
    linha.barra = HmlDataDivergenteCasos.mascarar(barras);
    return true;
};

/** Gera o `.REM` do lote no ERP de HML e registra de onde vêm as datas de cada segmento J. */
const gerarRemessaDoLote = async (
    ctx: Ctx,
    lote: Lote,
    flpCod: number,
    refs: Ref[],
    r: Row,
): Promise<void> => {
    try {
        const agora = new Date();
        const dd = String(agora.getUTCDate()).padStart(2, '0');
        const mm = String(agora.getUTCMonth() + 1).padStart(2, '0');
        const nome = `PG${dd}${mm}${String(SEQ_REMESSA)}.REM`;
        await ctx.write.gerarRemessa({
            filCod: FIL,
            bncCod: BNC,
            flpCod,
            grbCodSeq: 1,
            seqNum: SEQ_REMESSA,
            gabEspNomeArquivo: nome,
        });
        const arqs = await ctx.write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod });
        const arq = arqs.find((a) => a.nomeArquivo === nome) ?? arqs.find((a) => a.conteudo);
        const js = arq?.conteudo ? decodificarJ(arq.conteudo) : [];
        r.segmentosJ = js.map((j, n) => {
            const ref = refs[n];
            const base = {
                titulo: ref?.titulo ?? '',
                barra: ref?.barra ?? '',
                debito: lote.debito,
            };
            return {
                item: ref?.id,
                jVencimento: j.vencimento,
                jVencimentoVemDe: HmlDataDivergenteCasos.fonteDaData(j.vencimento, base),
                jDataPagamento: j.dataPagamento,
                jDataPagamentoVemDe: HmlDataDivergenteCasos.fonteDaData(j.dataPagamento, base),
            };
        });
        log(`${lote.id}: remessa gerada, segmentos J ${js.length}`);
    } catch (e) {
        r.erroRemessa = erroSeguro(e);
    }
};

const finalizar = async (ctx: Ctx, lote: Lote, flpCod: number, r: Row): Promise<void> => {
    try {
        await ctx.write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod });
        r.finalizar = 'aceito';
    } catch (e) {
        r.finalizar = 'recusado';
        r.erroFinalizar = erroSeguro(e);
    }
    log(`${lote.id}: finalizar ${String(r.finalizar)}`);
};

/** Importa e vincula um item do lote; devolve a referência para a conferência do `.REM`. */
const processarItem = async (
    ctx: Ctx,
    flpCod: number,
    item: Lote['itens'][number],
    x: Livre,
    serie: number,
    r: Row,
): Promise<Ref | undefined> => {
    const linha: Row = {
        item: item.id,
        doc: `${x.p.docCod}/${x.p.titCod}`,
        tituloVenc: civil(x.venc),
        barraVenc: item.barraVenc,
    };
    (r.itens as Row[]).push(linha);
    const imp = await importar(ctx, flpCod, x);
    if (imp.importou !== true) {
        linha.import = imp;
        return undefined;
    }
    try {
        const ok = await vincularBarra(ctx, flpCod, x, item.barraVenc, serie, linha);
        return ok
            ? { id: item.id, titulo: civil(x.venc), barra: item.barraVenc, doc: x.p.docCod }
            : undefined;
    } catch (e) {
        linha.erro = erroSeguro(e);
        return undefined;
    }
};

type Estado = { livres: Livre[]; cursor: number; criados: number[]; consumidos: string[] };

const processarLote = async (ctx: Ctx, lote: Lote, st: Estado): Promise<Row> => {
    const r: Row = { lote: lote.id, debito: lote.debito, pergunta: lote.pergunta, itens: [] };
    let flpCod: number;
    try {
        flpCod = await criarLote(ctx, lote.debito);
    } catch (e) {
        r.erroCriar = erroSeguro(e);
        log(`${lote.id}: criarLote recusado — ${JSON.stringify(r.erroCriar).slice(0, 250)}`);
        return r;
    }
    st.criados.push(flpCod);
    r.flpCod = flpCod;
    log(`${lote.id}: lote ${flpCod} criado (débito ${lote.debito})`);
    const refs: Ref[] = [];
    for (const item of lote.itens) {
        const x = st.livres[st.cursor];
        st.cursor += 1;
        if (!x) break;
        st.consumidos.push(String(x.p.docCod));
        const ref = await processarItem(ctx, flpCod, item, x, 700 + st.cursor, r);
        if (ref) refs.push(ref);
    }
    await finalizar(ctx, lote, flpCod, r);
    if (lote.gerarRemessa && r.finalizar === 'aceito') {
        await gerarRemessaDoLote(ctx, lote, flpCod, refs, r);
    }
    return r;
};

const descobrirLivres = async (write: ConexosSispagWriteClient): Promise<Livre[] | undefined> => {
    const nativos = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
    const ctx = nativos.find((l) => l.status === 0) ?? nativos[nativos.length - 1];
    if (!ctx) {
        log('nenhum lote nativo de contexto em HML.');
        return undefined;
    }
    const pend = await write.listarTitulosPendentes({
        filCod: FIL,
        bncCod: BNC,
        flpCod: ctx.flpCod,
    });
    const livres = pend
        .map((p) => ({
            p,
            valor: Number(p.raw.titMnyValor ?? 0),
            venc: Number(p.raw.titDtaVencimento ?? 0),
        }))
        .filter(
            (x) =>
                !x.p.temBoletoDda &&
                x.valor >= 1 &&
                x.valor <= 5000 &&
                x.venc > 0 &&
                !JA_USADOS.has(String(x.p.docCod)),
        )
        .sort((a, b) => b.venc - a.venc || a.valor - b.valor);
    log(`pendentes ${pend.length} · utilizáveis ${livres.length}`);
    return livres;
};

const listarPlano = (lotes: Lote[]): void => {
    for (const l of lotes) {
        log(
            `${l.id}: débito ${l.debito} · remessa ${l.gerarRemessa ? 'SIM' : 'não'} — ${l.pergunta}`,
        );
        for (const i of l.itens) log(`   ${i.id}: barra vence ${i.barraVenc} (${i.nota})`);
    }
};

async function main(): Promise<void> {
    const calendar = new BankingCalendar();
    const hoje = calendar.todayBrt();
    // CASOS e SABADO são validados AQUI, antes de qualquer chamada ao ERP (nem login).
    let lotes: Lote[];
    try {
        lotes = HmlDataDivergenteCasos.selecionar(
            HmlDataDivergenteCasos.lotes(calendar, hoje, {
                ...(process.env.SABADO ? { sabado: process.env.SABADO } : {}),
            }),
            process.env.CASOS,
        );
    } catch (e) {
        console.error(`RECUSADO: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
    }
    log(
        `${DRY ? 'DRY' : ESCREVER ? 'ESCREVER' : 'DESCOBERTA'} · fil=${FIL} bnc=${BNC} · hoje ${hoje}`,
    );
    listarPlano(lotes);
    if (DRY) return log('dry: nenhuma chamada ao ERP (nem login).');

    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const sispag = container.resolve(ConexosSispagClient);
    await base.ensureSid();
    log('login OK');

    const livres = await descobrirLivres(write);
    if (!livres) return;
    const totalItens = lotes.reduce((n, l) => n + l.itens.length, 0);
    log(`precisa de ${totalItens}`);
    for (const x of livres.slice(0, totalItens)) {
        log(`   candidato doc=${x.p.docCod}/${x.p.titCod} R$ ${x.valor} venc ${civil(x.venc)}`);
    }
    if (!ESCREVER) return log('descoberta: nada escrito (use ESCREVER=1 para criar os lotes).');
    if (livres.length < totalItens) return log('poucos títulos utilizáveis; nada escrito.');

    const contas = await sispag.listContasCorrentes(FIL);
    const conta = contas.find((c) => c.bncCod === BNC) ?? contas[0];
    if (!conta) return log('sem conta pagadora.');

    const ctx: Ctx = { base, write, conv: new CodigoBarrasBoleto(), calendar, conta };
    const st: Estado = { livres, cursor: 0, criados: [], consumidos: [] };
    const resultados: Row[] = [];
    for (const lote of lotes) resultados.push(await processarLote(ctx, lote, st));

    writeFileSync(
        `${OUT}/v11-v12.json`,
        JSON.stringify(
            {
                hoje,
                lotesDeTesteDeixadosEmHml: st.criados,
                consumidos: st.consumidos,
                resultados,
            },
            null,
            2,
        ),
    );
    log(`salvo ${OUT}/v11-v12.json`);
    log(
        `lotes de teste deixados em HML: ${st.criados.join(', ')} · JA_USADOS=${st.consumidos.join(',')}`,
    );
}

main().catch((e) => {
    console.error(JSON.stringify(erroSeguro(e)));
    process.exit(1);
});

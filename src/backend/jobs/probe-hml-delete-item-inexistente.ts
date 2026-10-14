import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * MEDIÇÃO HML (escreve) — ADR-0069 emenda 1, Task 12 / P1-5: o que o ERP faz com
 * `DELETE fin015/finItemSispag/{bncCod}/{flpCod}/{itsCodSeq}/{filCodItem}/{filCodLote}`?
 *
 * Fecha o status SEM_GROUND_TRUTH da retirada automática: o desenho decide pela ABSENCIA observada
 * na releitura (nunca pelo status do DELETE), e esta medição confirma — ou invalida — esse
 * tratamento nos casos que a guarda encontra:
 *
 *   C1  DELETE de `itsCodSeq` existente  → o item some? `titulosCount`/`soma` do lote nativo?
 *   C2  segundo DELETE do MESMO `itsCodSeq` (já ausente) → erro ou 200?
 *   C3  DELETE de `itsCodSeq` nunca existente → erro ou 200?
 *   C4a DELETE com `filCodItem` trocado (outra filial) → apaga mesmo assim?
 *   C4b DELETE com `filCodLote` trocado (path + header) → apaga mesmo assim?
 *   C5  DELETE em lote nativo já FINALIZADO (`CASO5_FLP`, opcional) → recusa?
 *   C6  o método de produção `removerItemDoRascunho` ponta a ponta (item novo).
 *
 * SEGURANÇA:
 *  - Recusa base que não seja HML (`CONEXOS_BASE_URL` com `-hml`). Credenciais de HML vêm de
 *    arquivo privado (`HML_ENV_FILE`); nunca `.env` de produção (o usuário PRD é recusado em HML e
 *    a sessão do robô é contaminável por probe local).
 *  - Rode com `databaseConnectionString=""` para NÃO gravar sessão no slot `columbia-default`.
 *  - Nenhum código de barras: os itens são importados SEM código; só identidade e contagens vão
 *    para o log e para o arquivo de saída. Credenciais nunca são impressas.
 *  - 1 sessão, sequencial, fora do horário de analista (cap de sessões do Conexos).
 *
 * Sem `EXECUTAR=1` só lista os títulos candidatos (leitura).
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" EXECUTAR=1 \
 *   npx tsx jobs/probe-hml-delete-item-inexistente.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
if (process.env.databaseConnectionString !== '' && process.env.PERMITIR_COM_BANCO !== '1') {
    console.error('RECUSADO: rode com databaseConnectionString="" (sessão do robô contaminável).');
    process.exit(1);
}
const EXECUTAR = process.env.EXECUTAR === '1';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const CASO5_FLP = Number(process.env.CASO5_FLP ?? 0);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-delete-item';
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-delete-item] ${s}`);

/** Só o que ajuda a entender a resposta — nunca cabeçalhos, cookies nem credenciais. */
const erroSeguro = (e: unknown): Row => {
    const err = e as {
        name?: string;
        message?: string;
        response?: { status?: unknown; data?: unknown };
        cause?: { response?: { status?: unknown; data?: unknown } };
    };
    const resp = err.response ?? err.cause?.response;
    return {
        nome: err.name,
        message: String(err.message ?? e).slice(0, 300),
        status: resp?.status,
        data: resp?.data,
    };
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const sispag = container.resolve(ConexosSispagClient);
    log(`BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC} · ${EXECUTAR ? 'EXECUTAR' : 'leitura'}`);
    await base.ensureSid();
    log('login OK');

    const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
    const ctx = lotes.find((l) => l.status === 0) ?? lotes[lotes.length - 1];
    if (!ctx) return log('nenhum lote de contexto em HML.');
    const pend = await write.listarTitulosPendentes({
        filCod: FIL,
        bncCod: BNC,
        flpCod: ctx.flpCod,
    });
    const hoje = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
    );
    const cand = pend
        .map((p) => ({
            p,
            valor: Number(p.raw.titMnyValor ?? 0),
            venc: Number(p.raw.titDtaVencimento ?? 0),
        }))
        .filter((x) => !x.p.temBoletoDda && x.valor > 0 && x.venc >= hoje - 400 * DAY)
        .sort((a, b) => b.venc - a.venc || a.valor - b.valor)
        .slice(0, 12);
    log(`títulos candidatos: ${cand.length} (de ${pend.length} pendentes)`);
    for (const x of cand) log(`   doc=${x.p.docCod}/${x.p.titCod} R$ ${x.valor}`);
    if (cand.length < 5) return log('poucos títulos para a medição (precisa de 5).');
    if (!EXECUTAR) return log('leitura: nada escrito.');

    // ── lote de teste (rascunho) ─────────────────────────────────────────────
    const contas = await sispag.listContasCorrentes(FIL);
    const conta = contas.find((c) => c.bncCod === BNC) ?? contas[0];
    if (!conta) return log('sem conta pagadora.');
    const reuso = Number(process.env.FLP_EXISTENTE ?? 0);
    const lote =
        reuso > 0
            ? { flpCod: reuso }
            : await write.criarLote({
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
                  dataDebito: hoje,
              });
    const FLP = lote.flpCod;
    log(`lote de teste ${reuso > 0 ? 'reaproveitado' : 'criado'}: flp=${FLP}`);

    const importar = async (alvo: (typeof cand)[number]): Promise<Row> => {
        const item: Row = {
            ...alvo.p.raw,
            filCodLote: FIL,
            bncCod: BNC,
            flpCod: FLP,
            itsVldModalidade: 6,
            itsEspNomeFav: alvo.p.raw.dpeNomPessoa,
            itsMnyValor: alvo.valor,
            itsMnyVlrPgto: alvo.valor,
            titMnyLiquido: alvo.valor,
            itsDtaPgto: alvo.venc,
            vldOk: 1,
            vldImporta: 1,
            avisos: '[]',
        };
        const selecao = {
            op: 1,
            bncCodFin015: BNC,
            titVldReflexoDdaAssoc: 0,
            titVldReflexoDdaDesassoc: 0,
        };
        const body: Row = { items: [{ ...item, ...selecao }], ...selecao };
        const path = 'fin015/finItemSispag/titulosPendentes/importar';
        try {
            await base.ensureSid();
            await base.postGenericOnce<unknown>(path, body, { filCod: FIL });
            return { importou: true };
        } catch (e) {
            const data = (e as { response?: { data?: Row } }).response?.data;
            const perguntas = (data?.questions ?? []) as Array<{ id?: string | number }>;
            if (data?.type !== 'QUESTION' || perguntas.length === 0) {
                return { importou: false, erro: erroSeguro(e) };
            }
            const answers: Record<string, string> = {};
            for (const q of perguntas) if (q.id !== undefined) answers[String(q.id)] = 'YES';
            try {
                await base.postGenericOnce<unknown>(path, { ...body, answers }, { filCod: FIL });
                return { importou: true, respondeuPergunta: true };
            } catch (e2) {
                return { importou: false, erroAposResposta: erroSeguro(e2) };
            }
        }
    };
    const ler = async (flp: number): Promise<Row[]> =>
        (
            await base.listGenericPaginated<Row>(
                `fin015/finItemSispag/list/${FIL}/${BNC}/${flp}`,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin015',
                    pageNumber: 1,
                    pageSize: 500,
                },
                { filCod: FIL },
            )
        ).rows ?? [];
    /** Só identidade: `docCod/titCod`, `filCod`, `itsCodSeq` — nenhum código. */
    const resumo = (rows: Row[]): Row[] =>
        rows.map((r) => ({
            doc: `${r.docCod}/${r.titCod}`,
            filCod: r.filCod,
            itsCodSeq: r.itsCodSeq,
        }));
    const estadoNativo = async (flp: number): Promise<Row> => {
        const e = await write.getLoteNativo({ filCod: FIL, bncCod: BNC, flpCod: flp });
        return e
            ? { status: e.status, titulosCount: e.titulosCount, soma: e.soma }
            : { existe: false };
    };
    /** DELETE cru: devolve status/corpo, nunca lança. */
    const deletar = async (
        flp: number,
        seq: number,
        filItem: number,
        filLote: number,
    ): Promise<Row> => {
        const path = `fin015/finItemSispag/${BNC}/${flp}/${seq}/${filItem}/${filLote}`;
        try {
            await base.ensureSid();
            const data = await base.deleteGeneric<unknown>(path, { filCod: filLote });
            return { path, ok: true, resposta: data ?? null };
        } catch (e) {
            return { path, ok: false, erro: erroSeguro(e) };
        }
    };

    const resultados: Row = { flpCod: FLP, casos: {} as Row };
    const caso = (id: string, dados: Row): void => {
        (resultados.casos as Row)[id] = dados;
        log(`${id}: ${JSON.stringify(dados).slice(0, 700)}`);
    };

    // ── importa 4 títulos sem código ─────────────────────────────────────────
    let itens = await ler(FLP);
    const jaNoLote = new Set(itens.map((r) => `${r.docCod}/${r.titCod}`));
    for (const alvo of cand) {
        if (itens.length >= 4) break;
        if (jaNoLote.has(`${alvo.p.docCod}/${alvo.p.titCod}`)) continue;
        const r = await importar(alvo);
        log(`import ${alvo.p.docCod}/${alvo.p.titCod}: ${JSON.stringify(r).slice(0, 300)}`);
        itens = await ler(FLP);
    }
    log(`itens no rascunho: ${JSON.stringify(resumo(itens))}`);
    resultados.itensIniciais = resumo(itens);
    if (itens.length < 4) {
        writeFileSync(`${OUT}/resultados.json`, JSON.stringify(resultados, null, 2));
        return log('menos de 4 itens importados — medição abortada (lote vazio deixado).');
    }
    // Nome de campo de amostra do row: confirma que `filCod` e `itsCodSeq` existem (Q1).
    resultados.camposDoRow = Object.keys(itens[0] as Row)
        .filter((k) => /filCod|itsCodSeq|docCod|titCod/.test(k))
        .sort();
    log(`Q1 — campos de identidade do row: ${JSON.stringify(resultados.camposDoRow)}`);

    const [a, b, c, d] = itens as [Row, Row, Row, Row];
    const seqA = Number(a.itsCodSeq);
    const seqB = Number(b.itsCodSeq);
    const seqC = Number(c.itsCodSeq);
    const seqD = Number(d.itsCodSeq);

    // C1 — item existente
    const antes1 = await estadoNativo(FLP);
    const del1 = await deletar(FLP, seqA, Number(a.filCod ?? FIL), FIL);
    const depois1 = await estadoNativo(FLP);
    itens = await ler(FLP);
    caso('C1-existente', {
        itsCodSeq: seqA,
        delete: del1,
        antes: antes1,
        depois: depois1,
        itemAindaPresente: itens.some((r) => Number(r.itsCodSeq) === seqA),
        itensRestantes: resumo(itens),
    });

    // C2 — o MESMO itsCodSeq outra vez (já ausente)
    const del2 = await deletar(FLP, seqA, Number(a.filCod ?? FIL), FIL);
    itens = await ler(FLP);
    caso('C2-ja-ausente', { itsCodSeq: seqA, delete: del2, itensRestantes: resumo(itens) });

    // C3 — nunca existente
    const del3 = await deletar(FLP, 999999, FIL, FIL);
    itens = await ler(FLP);
    caso('C3-nunca-existiu', { itsCodSeq: 999999, delete: del3, itensRestantes: resumo(itens) });

    // C4a — filCodItem trocado (outra filial)
    const outraFilial = FIL === 1 ? 2 : 1;
    const del4a = await deletar(FLP, seqB, outraFilial, FIL);
    itens = await ler(FLP);
    caso('C4a-filCodItem-trocado', {
        itsCodSeq: seqB,
        filCodItemUsado: outraFilial,
        delete: del4a,
        itemAindaPresente: itens.some((r) => Number(r.itsCodSeq) === seqB),
    });

    // C4b — filCodLote trocado (path + header)
    const del4b = await deletar(FLP, seqB, FIL, outraFilial);
    itens = await ler(FLP);
    caso('C4b-filCodLote-trocado', {
        itsCodSeq: seqB,
        filCodLoteUsado: outraFilial,
        delete: del4b,
        itemAindaPresente: itens.some((r) => Number(r.itsCodSeq) === seqB),
    });

    // C6 — o método de PRODUÇÃO, ponta a ponta (item C)
    let c6: Row;
    try {
        await write.removerItemDoRascunho({
            filCod: FIL,
            bncCod: BNC,
            flpCod: FLP,
            itsCodSeq: seqC,
            filCodItem: Number(c.filCod ?? FIL),
        });
        c6 = { lancou: false };
    } catch (e) {
        c6 = { lancou: true, erro: erroSeguro(e) };
    }
    itens = await ler(FLP);
    caso('C6-metodo-de-producao', {
        itsCodSeq: seqC,
        ...c6,
        itemAindaPresente: itens.some((r) => Number(r.itsCodSeq) === seqC),
        estado: await estadoNativo(FLP),
    });

    // C5 — lote nativo FINALIZADO (opcional, dado de teste de HML)
    if (CASO5_FLP > 0) {
        const fin = await ler(CASO5_FLP);
        const alvo5 = fin[0];
        if (alvo5) {
            const seq5 = Number(alvo5.itsCodSeq);
            const antes5 = await estadoNativo(CASO5_FLP);
            const del5 = await deletar(CASO5_FLP, seq5, Number(alvo5.filCod ?? FIL), FIL);
            const depois = await ler(CASO5_FLP);
            caso('C5-lote-finalizado', {
                flpCod: CASO5_FLP,
                itsCodSeq: seq5,
                estadoLote: antes5,
                delete: del5,
                itemAindaPresente: depois.some((r) => Number(r.itsCodSeq) === seq5),
            });
        } else {
            caso('C5-lote-finalizado', { flpCod: CASO5_FLP, erro: 'sem itens para testar' });
        }
    }

    // ── limpeza: esvazia o rascunho de teste (a API não apaga o lote) ────────
    itens = await ler(FLP);
    const faltam = [seqB, seqD, ...itens.map((r) => Number(r.itsCodSeq))];
    for (const seq of new Set(faltam)) {
        const item = itens.find((r) => Number(r.itsCodSeq) === seq);
        if (!item) continue;
        await deletar(FLP, seq, Number(item.filCod ?? FIL), FIL);
    }
    resultados.restoDoLote = resumo(await ler(FLP));
    resultados.estadoFinal = await estadoNativo(FLP);
    log(
        `limpeza: ${JSON.stringify(resultados.restoDoLote)} · ${JSON.stringify(resultados.estadoFinal)}`,
    );
    writeFileSync(`${OUT}/resultados.json`, JSON.stringify(resultados, null, 2));
    log(`salvo ${OUT}/resultados.json · LOTE DE TESTE flp=${FLP} deixado em HML (rascunho vazio)`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-delete-item] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

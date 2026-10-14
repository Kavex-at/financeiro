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

/**
 * EXPERIMENTO HML (escreve) — passo 2 da ADR-0068: o que o `importar` faz com um código de barras
 * que NÓS informamos, e o que o ERP calcula no item quando o boleto difere do título?
 *
 * Cria UM lote de teste e importa títulos distintos de HML (um por caso — um título só entra
 * uma vez), cada um com um código de barras SINTÉTICO (DV módulo 11 válido, banco 341; nenhum
 * boleto real). Depois lê os itens de volta e imprime o que o ERP gravou/calculou.
 *
 * Fase 1 descobre QUAL campo o `importar` lê: `titEspCodbar`, `itsNumCodbar` ou ambos (3 títulos,
 * mesmo valor e dia do título). Fase 2 usa a variante que funcionou para os casos de diferença
 * (+R$ 0,01, +1,6 %, vence +5 dias). Não finaliza o lote nem gera remessa.
 *
 * ⚠️ ESCREVE em HML: 1 lote rascunho (a API não apaga rascunho) + N itens. Recusa base não-HML.
 * Sem EXECUTAR=1 só lista os títulos escolhidos.
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
const EXECUTAR = process.env.EXECUTAR === '1';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-importar-codbar';
const DAY = 24 * 60 * 60 * 1000;
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-importar] ${s}`);

const fator = (utcMid: number): number => {
    const reinicio = Date.UTC(2025, 1, 22);
    return utcMid >= reinicio
        ? 1000 + Math.round((utcMid - reinicio) / DAY)
        : Math.round((utcMid - Date.UTC(1997, 9, 7)) / DAY);
};
const dv11 = (c: string): string => {
    let soma = 0;
    let peso = 2;
    for (let i = c.length - 1; i >= 0; i -= 1) {
        soma += Number(c[i]) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const d = 11 - (soma % 11);
    return d === 0 || d === 10 || d === 11 ? '1' : String(d);
};
const codbar44 = (valor: number, venc: number, serie: number): string => {
    const livre = `10900000${String(serie).padStart(2, '0')}12345678901234`
        .slice(0, 25)
        .padEnd(25, '0');
    const corpo = `3419${String(fator(venc)).padStart(4, '0')}${String(Math.round(valor * 100)).padStart(10, '0')}${livre}`;
    return `${corpo.slice(0, 4)}${dv11(corpo)}${corpo.slice(4)}`;
};
const mask = (s: unknown): string => {
    const t = String(s ?? '');
    return t.length > 12 ? `${t.slice(0, 5)}…${t.slice(-4)} (${t.length})` : t;
};
const erroSeguro = (e: unknown): Row => {
    const err = e as {
        message?: string;
        name?: string;
        response?: { status?: unknown; data?: unknown };
        cause?: { response?: { status?: unknown; data?: unknown } };
        questions?: unknown;
        perguntas?: unknown;
    };
    const resp = err.response ?? err.cause?.response;
    return {
        nome: err.name,
        message: String(err.message ?? e).slice(0, 300),
        status: resp?.status,
        data: resp?.data,
        perguntas: err.questions ?? err.perguntas,
    };
};

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const sispag = container.resolve(ConexosSispagClient);
    const conv = new CodigoBarrasBoleto();
    console.log('='.repeat(78));
    console.log(
        `BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC} · ${EXECUTAR ? 'EXECUTAR' : 'dry-run'}`,
    );
    console.log('='.repeat(78));
    await base.ensureSid();
    log('login OK');

    const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
    const ctx = lotes.find((l) => l.status === 0) ?? lotes[lotes.length - 1];
    if (!ctx) return log('nenhum lote de contexto.');
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
    // títulos sem flag, com valor, vencendo daqui a 10+ dias (a regra R2 exige débito ≤ vencimento)
    const cand = pend
        .map((p) => ({
            p,
            valor: Number(p.raw.titMnyValor ?? 0),
            venc: Number(p.raw.titDtaVencimento ?? 0),
        }))
        .filter(
            (x) =>
                !x.p.temBoletoDda &&
                x.valor > 0 &&
                x.venc >= hoje + Number(process.env.MIN_DIAS ?? -400) * DAY,
        )
        .sort((a, b) => b.venc - a.venc || a.valor - b.valor)
        .slice(0, 8);
    log(`títulos candidatos: ${cand.length} (de ${pend.length} pendentes)`);
    for (const x of cand)
        log(
            `   doc=${x.p.docCod}/${x.p.titCod} R$ ${x.valor} venc ${new Date(x.venc).toISOString().slice(0, 10)}`,
        );
    if (cand.length < 6) return log('poucos títulos para o experimento.');
    if (!EXECUTAR) return log('dry-run: nada escrito.');

    // ── lote de teste
    const contas = await sispag.listContasCorrentes(FIL);
    const conta = contas.find((c) => c.bncCod === BNC) ?? contas[0];
    if (!conta) return log('sem conta pagadora.');
    const lote = await write.criarLote({
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
    const flpCod = lote.flpCod;
    log(`lote de teste criado: flp=${flpCod}`);

    type Caso = {
        id: string;
        campo: 'titEspCodbar' | 'itsNumCodbar' | 'ambos';
        dv: number;
        dd: number;
        fator: number;
    };
    const resultados: Row[] = [];
    let usados = 0;

    /** POST do import; se o ERP perguntar, devolve a pergunta; com `responder`, responde YES e repete. */
    const postarImport = async (item: Row, responder: boolean): Promise<Row> => {
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
            const perguntas = (data?.questions ?? []) as Array<{
                id?: string | number;
                key?: string;
                parameterValueList?: Row;
            }>;
            if (data?.type !== 'QUESTION' || perguntas.length === 0) {
                return { importou: false, erro: erroSeguro(e) };
            }
            const resumo = perguntas.map((q) => ({
                id: q.id,
                key: q.key,
                parametros: q.parameterValueList,
            }));
            if (!responder) return { importou: false, pergunta: resumo };
            const answers: Record<string, string> = {};
            for (const q of perguntas) if (q.id !== undefined) answers[String(q.id)] = 'YES';
            try {
                await base.ensureSid();
                await base.postGenericOnce<unknown>(path, { ...body, answers }, { filCod: FIL });
                return { importou: true, respondeu: resumo };
            } catch (e2) {
                return { importou: false, pergunta: resumo, erroAposResposta: erroSeguro(e2) };
            }
        }
    };

    const executar = async (
        c: Caso & { responder?: boolean; semBarra?: boolean },
    ): Promise<Row> => {
        const alvo = cand[usados++];
        if (!alvo) return { id: c.id, erro: 'sem título livre' };
        const valorBarra = Math.round((alvo.valor * c.fator + c.dv) * 100) / 100;
        const vencBarra = alvo.venc + c.dd * DAY;
        const linha = conv.paraLinhaDigitavel(codbar44(valorBarra, vencBarra, usados)) ?? '';
        const campos: Row = c.semBarra
            ? {}
            : c.campo === 'titEspCodbar'
              ? { titEspCodbar: linha }
              : c.campo === 'itsNumCodbar'
                ? { itsNumCodbar: linha }
                : { titEspCodbar: linha, itsNumCodbar: linha };
        const item: Row = {
            ...alvo.p.raw,
            filCodLote: FIL,
            bncCod: BNC,
            flpCod,
            itsVldModalidade: 6,
            itsEspNomeFav: alvo.p.raw.dpeNomPessoa,
            itsMnyValor: alvo.valor,
            itsMnyVlrPgto: alvo.valor,
            titMnyLiquido: alvo.valor,
            itsDtaPgto: alvo.venc,
            vldOk: 1,
            vldImporta: 1,
            avisos: '[]',
            ...campos,
        };
        const saida: Row = {
            id: c.id,
            campo: c.campo,
            doc: `${alvo.p.docCod}/${alvo.p.titCod}`,
            valorTitulo: alvo.valor,
            vencTitulo: new Date(alvo.venc).toISOString().slice(0, 10),
            valorBarra,
            vencBarra: new Date(vencBarra).toISOString().slice(0, 10),
        };
        Object.assign(saida, await postarImport(item, c.responder === true));
        return saida;
    };

    const lerItens = async (): Promise<Row[]> => {
        const page = await base.listGenericPaginated<Row>(
            `fin015/finItemSispag/list/${FIL}/${BNC}/${flpCod}`,
            { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 500 },
            { filCod: FIL },
        );
        return page.rows ?? [];
    };

    const resumoItem = (i: Row): Row => ({
        doc: `${i.docCod}/${i.titCod}`,
        itsNumCodbar: mask(i.itsNumCodbar),
        titEspCodbar: mask(i.titEspCodbar),
        vldVinculoDda: i.vldVinculoDda,
        itsVldModalidade: i.itsVldModalidade,
        itsMnyValor: i.itsMnyValor,
        itsMnyVlrPgto: i.itsMnyVlrPgto,
        titMnyLiquido: i.titMnyLiquido,
        titMnyJuros: i.titMnyJuros,
        titMnyDesconto: i.titMnyDesconto,
        itsDtaPgto: i.itsDtaPgto ? new Date(Number(i.itsDtaPgto)).toISOString().slice(0, 10) : null,
    });
    const relata = (r: Row): void =>
        log(
            `${r.id}: importou=${String(r.importou)} título ${String(r.doc)} valorBarra=${String(r.valorBarra)} vencBarra=${String(r.vencBarra)} ${
                r.pergunta ? `PERGUNTA=${JSON.stringify(r.pergunta).slice(0, 300)}` : ''
            } ${r.respondeu ? `RESPONDIDA=${JSON.stringify(r.respondeu).slice(0, 200)}` : ''} ${
                r.erro ? `ERRO=${JSON.stringify(r.erro).slice(0, 300)}` : ''
            } ${r.erroAposResposta ? `ERRO-APÓS=${JSON.stringify(r.erroAposResposta).slice(0, 300)}` : ''}`,
        );

    // G1 controle: SEM código de barras, sem responder — a pergunta é do título ou da barra?
    const g1 = await executar({
        id: 'G1-sem-barra',
        campo: 'ambos',
        dv: 0,
        dd: 0,
        fator: 1,
        semBarra: true,
    });
    resultados.push(g1);
    relata(g1);
    // G2: com barra igual (valor e dia), respondendo YES à pergunta do ERP
    const g2 = await executar({
        id: 'G2-barra-igual',
        campo: 'ambos',
        dv: 0,
        dd: 0,
        fator: 1,
        responder: true,
    });
    resultados.push(g2);
    relata(g2);
    let itens = await lerItens();
    log(`itens no lote após G1/G2: ${itens.length}`);
    for (const i of itens) log(`   ${JSON.stringify(resumoItem(i))}`);

    // G3..G5: diferenças (só se G2 importou)
    if (g2.importou === true) {
        const casos = [
            { id: 'G3-+0,01', campo: 'ambos' as const, dv: 0.01, dd: 0, fator: 1 },
            { id: 'G4-+1,6%', campo: 'ambos' as const, dv: 0, dd: 0, fator: 1.016 },
            { id: 'G5-vence+5d', campo: 'ambos' as const, dv: 0, dd: 5, fator: 1 },
        ];
        for (const c of casos) {
            const r = await executar({ ...c, responder: true });
            resultados.push(r);
            relata(r);
        }
        itens = await lerItens();
        log('itens no lote após G3..G5:');
        for (const i of itens) log(`   ${JSON.stringify(resumoItem(i))}`);
    }
    writeFileSync(
        `${OUT}/resultados.json`,
        JSON.stringify({ flpCod, resultados, itens: itens.map(resumoItem) }, null, 2),
    );
    log(`salvo ${OUT}/resultados.json · LOTE DE TESTE flp=${flpCod} deixado em HML (rascunho)`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-importar] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

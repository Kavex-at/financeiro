import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';

/**
 * EXPERIMENTO HML (escreve) — o caminho MANUAL do ERP, ponta a ponta: com os itens já importados
 * num lote de teste (`FLP`), editar o item com o código de barras (como a tela do fin015),
 * finalizar, gerar a remessa e decodificar o segmento J — o que de fato chegaria ao banco.
 *
 * Casos (títulos do lote, modalidade BOLETO): o 1º com barra de mesmo valor e dia; o 2º com
 * +R$ 0,01 (variante com JUROS = 0,01 no item). Códigos de barras SINTÉTICOS (DV válido, 341).
 *
 * Contexto: o `importar` DESCARTA o código de barras (HML 2026-10-14: item volta com
 * `itsNumCodbar` vazio), então o único caminho é editar o item depois (`PUT fin015/finItemSispag`).
 *
 * ⚠️ ESCREVE em HML (edita itens, finaliza lote, gera remessa). Recusa base não-HML. Sem
 * EXECUTAR=1 só lista os itens.
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
const EXECUTAR = process.env.EXECUTAR === '1';
const FINALIZAR = process.env.FINALIZAR === '1';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const FLP = Number(process.env.FLP ?? 0);
const SEQ = Number(process.env.SEQ ?? 91);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-editar-item-codbar';
const DAY = 24 * 60 * 60 * 1000;
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-editar] ${s}`);

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
    const err = e as { message?: string; response?: { status?: unknown; data?: unknown } };
    return {
        message: String(err.message ?? e).slice(0, 300),
        status: err.response?.status,
        data: err.response?.data,
    };
};
const dia = (ms: unknown): string | null =>
    ms ? new Date(Number(ms)).toISOString().slice(0, 10) : null;

const resumo = (i: Row): Row => ({
    doc: `${i.docCod}/${i.titCod}`,
    modalidade: i.itsVldModalidade,
    itsNumCodbar: mask(i.itsNumCodbar),
    vldVinculoDda: i.vldVinculoDda,
    itsMnyValor: i.itsMnyValor,
    itsMnyVlrPgto: i.itsMnyVlrPgto,
    titMnyLiquido: i.titMnyLiquido,
    titMnyJuros: i.titMnyJuros,
    titMnyDesconto: i.titMnyDesconto,
    itsDtaPgto: dia(i.itsDtaPgto),
    titDtaVencimento: dia(i.titDtaVencimento),
});

/** Decodifica os segmentos J (≠ J-52) de um CNAB 240 Itaú: o que o banco recebe. */
const decodificarJ = (conteudo: string): Row[] =>
    conteudo
        .split(/\r?\n/)
        .filter((l) => l.length >= 167 && l[7] === '3' && l[13] === 'J' && l.slice(17, 19) !== '52')
        .map((l) => {
            const dd = (s: string): string => `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
            const n = (s: string): number => Number(s) / 100;
            return {
                codigoBarras: mask(l.slice(17, 61)),
                vencimento: dd(l.slice(91, 99)),
                valorTitulo: n(l.slice(99, 114)),
                desconto: n(l.slice(114, 129)),
                acrescimos: n(l.slice(129, 144)),
                dataPagamento: dd(l.slice(144, 152)),
                valorPagamento: n(l.slice(152, 167)),
            };
        });

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    if (!FLP) {
        console.error('Informe FLP=<lote de teste>.');
        process.exit(1);
    }
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const conv = new CodigoBarrasBoleto();
    console.log('='.repeat(78));
    console.log(
        `BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC} flp=${FLP} · ${EXECUTAR ? 'EXECUTAR' : 'dry-run'}`,
    );
    console.log('='.repeat(78));
    await base.ensureSid();
    log('login OK');

    const ler = async (): Promise<Row[]> =>
        (
            await base.listGenericPaginated<Row>(
                `fin015/finItemSispag/list/${FIL}/${BNC}/${FLP}`,
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

    let itens = await ler();
    log(`itens do lote ${FLP}: ${itens.length}`);
    for (const i of itens) log(`   ${JSON.stringify(resumo(i))}`);
    const boletos = itens.filter((i) => Number(i.itsVldModalidade) === 6);
    if (boletos.length === 0 || !EXECUTAR)
        return log('dry-run (ou sem item de boleto): nada escrito.');

    const hoje = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
    );
    const resultados: Row[] = [];
    let n = 0;
    for (const it of boletos.slice(0, 2)) {
        n += 1;
        const valor = Number(it.itsMnyValor ?? it.titMnyLiquido);
        const venc = Number(it.titDtaVencimento);
        const dv = n === 2 ? Number(process.env.DV2 ?? 0.01) : 0;
        const valorBarra = Math.round((valor + dv) * 100) / 100;
        const linha = conv.paraLinhaDigitavel(codbar44(valorBarra, venc, n)) ?? '';
        const caso = n === 1 ? 'H1-barra-igual' : 'H2-barra+0,01 (juros 0: paga o valor da barra)';
        const r: Row = { caso, doc: `${it.docCod}/${it.titCod}`, valor, valorBarra };
        const corpoCalc = {
            bncCodLote: BNC,
            itsNumCodbar: linha,
            itsVldModalidade: 6,
            titDtaVencimento: venc,
            titMnyLiquido: valor,
            titMnyJuros: 0,
            titMnyDesconto: 0,
            itsMnyVlrPgto: valorBarra,
        };
        try {
            const v = (await base.postGenericOnce<Row>(
                'fin015/finItemSispag/validacao/codigoBarras',
                corpoCalc,
                { filCod: FIL },
            )) as Row;
            const d = (v.responseData ?? v) as Row;
            const c = (await base.postGenericOnce<Row>(
                'fin015/finItemSispag/validacao/confirmaCodigoBarras',
                {
                    ...corpoCalc,
                    splitCodBar: d.splitCodBar,
                    barraDtaVencimento: d.barraDtaVencimento,
                    barraVlrPgto: d.barraVlrPgto,
                },
                { filCod: FIL },
            )) as Row;
            r.confirma = {
                itsMnyVlrPgtoResult: c.itsMnyVlrPgtoResult,
                itsDtaPgtoResult: dia(c.itsDtaPgtoResult),
            };
            await base.putGenericOnce<unknown>(
                'fin015/finItemSispag',
                {
                    ...it,
                    itsNumCodbar: linha,
                    titEspCodbar: linha,
                    itsNumBanco: c.itsBncNumCodbancoResult,
                    bncDesNome: c.itsBncDesNomeResult,
                    itsMnyVlrPgto: c.itsMnyVlrPgtoResult ?? valorBarra,
                    titMnyJuros: corpoCalc.titMnyJuros,
                },
                { filCod: FIL },
            );
            r.editou = true;
        } catch (e) {
            r.editou = false;
            r.erro = erroSeguro(e);
        }
        resultados.push(r);
        log(`${caso}: ${JSON.stringify(r).slice(0, 700)}`);
    }

    // H3: item que não é boleto (sem destino) vira boleto com barra que vence DEPOIS da data do item
    for (const it of itens.filter((i) => Number(i.itsVldModalidade) !== 6)) {
        const valor = Number(it.itsMnyValor ?? it.titMnyLiquido);
        const vencBarra = hoje + 15 * DAY;
        const linha = conv.paraLinhaDigitavel(codbar44(valor, vencBarra, 9)) ?? '';
        const r: Row = {
            caso: 'H3-item-sem-destino vira boleto, barra vence depois',
            doc: `${it.docCod}/${it.titCod}`,
            valor,
            vencBarra: dia(vencBarra),
        };
        try {
            const corpo = {
                bncCodLote: BNC,
                itsNumCodbar: linha,
                itsVldModalidade: 6,
                titDtaVencimento: Number(it.titDtaVencimento),
                titMnyLiquido: valor,
                titMnyJuros: 0,
                titMnyDesconto: 0,
                itsMnyVlrPgto: valor,
            };
            const v = (await base.postGenericOnce<Row>(
                'fin015/finItemSispag/validacao/codigoBarras',
                corpo,
                { filCod: FIL },
            )) as Row;
            const d = (v.responseData ?? v) as Row;
            const c = (await base.postGenericOnce<Row>(
                'fin015/finItemSispag/validacao/confirmaCodigoBarras',
                {
                    ...corpo,
                    splitCodBar: d.splitCodBar,
                    barraDtaVencimento: d.barraDtaVencimento,
                    barraVlrPgto: d.barraVlrPgto,
                },
                { filCod: FIL },
            )) as Row;
            r.confirma = {
                itsMnyVlrPgtoResult: c.itsMnyVlrPgtoResult,
                itsDtaPgtoResult: dia(c.itsDtaPgtoResult),
            };
            await base.putGenericOnce<unknown>(
                'fin015/finItemSispag',
                {
                    ...it,
                    itsVldModalidade: 6,
                    itsNumCodbar: linha,
                    titEspCodbar: linha,
                    itsNumBanco: c.itsBncNumCodbancoResult,
                    bncDesNome: c.itsBncDesNomeResult,
                    itsMnyVlrPgto: c.itsMnyVlrPgtoResult ?? valor,
                    itsDtaPgto: c.itsDtaPgtoResult ?? vencBarra,
                },
                { filCod: FIL },
            );
            r.editou = true;
        } catch (e) {
            r.editou = false;
            r.erro = erroSeguro(e);
        }
        resultados.push(r);
        log(`H3: ${JSON.stringify(r).slice(0, 700)}`);
    }

    // itens futuros: garante a regra do finalizar (itsDtaPgto >= débito do lote) nos demais
    itens = await ler();
    for (const i of itens) {
        const pg = Number(i.itsDtaPgto);
        if (Number.isFinite(pg) && pg < hoje) {
            try {
                await base.putGenericOnce<unknown>(
                    'fin015/finItemSispag',
                    { ...i, itsDtaPgto: hoje + 10 * DAY },
                    { filCod: FIL },
                );
                log(
                    `item ${i.docCod}/${i.titCod}: itsDtaPgto ${dia(pg)} → futuro (somente HML, p/ finalizar)`,
                );
            } catch (e) {
                log(
                    `item ${i.docCod}/${i.titCod}: ajuste de data falhou ${JSON.stringify(erroSeguro(e)).slice(0, 200)}`,
                );
            }
        }
    }
    itens = await ler();
    log('itens após a edição:');
    for (const i of itens) log(`   ${JSON.stringify(resumo(i))}`);

    let segmentosJ: Row[] = [];
    if (FINALIZAR) {
        try {
            await write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod: FLP });
            log('finalizarLote OK');
            const hojeD = new Date();
            const nome = `PG${String(hojeD.getUTCDate()).padStart(2, '0')}${String(hojeD.getUTCMonth() + 1).padStart(2, '0')}${String(SEQ).padStart(2, '0')}.REM`;
            const rem = await write.gerarRemessa({
                filCod: FIL,
                bncCod: BNC,
                flpCod: FLP,
                grbCodSeq: 1,
                seqNum: SEQ,
                gabEspNomeArquivo: nome,
            });
            log(`gerarRemessa ${JSON.stringify(rem)}`);
            const arqs = await write.listarArquivosRemessa({
                filCod: FIL,
                bncCod: BNC,
                flpCod: FLP,
            });
            const arq = arqs.find((a) => a.conteudo);
            if (arq?.conteudo) {
                writeFileSync(`${OUT}/${arq.nomeArquivo ?? `flp${FLP}`}`, arq.conteudo);
                segmentosJ = decodificarJ(arq.conteudo);
                log(`segmentos J (o que o banco recebe): ${JSON.stringify(segmentosJ)}`);
            } else log('remessa gerada sem conteúdo legível.');
        } catch (e) {
            log(`finalizar/gerar falhou: ${JSON.stringify(erroSeguro(e)).slice(0, 500)}`);
        }
    }
    writeFileSync(
        `${OUT}/resultados.json`,
        JSON.stringify({ flp: FLP, resultados, itens: itens.map(resumo), segmentosJ }, null, 2),
    );
    log(`salvo ${OUT}/resultados.json`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-editar] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

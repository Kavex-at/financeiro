import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import AnaliseCodigoBarrasRepetido from '../domain/libs/boleto/AnaliseCodigoBarrasRepetido.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';
import ElegibilidadeVinculoCodigoBarras from '../domain/libs/boleto/ElegibilidadeVinculoCodigoBarras.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import RegraSugestaoBoleto from '../domain/service/sispag/RegraSugestaoBoleto.js';
import VinculoCodigoBarrasService from '../domain/service/sispag/VinculoCodigoBarrasService.js';
import type PostgreeDatabaseClient from '../domain/client/database/PostgreeDatabaseClient.js';
import type EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import type LogService from '../domain/service/LogService.js';
import type BoletoDdaRepository from '../domain/repository/sispag/BoletoDdaRepository.js';
import type LotePagamentoRepository from '../domain/repository/sispag/LotePagamentoRepository.js';
import type SugestaoBoletoRepository from '../domain/repository/sispag/SugestaoBoletoRepository.js';
import type TituloAPagarRepository from '../domain/repository/sispag/TituloAPagarRepository.js';
import type { LotePagamento } from '../domain/interface/sispag/SispagInterface.js';

/**
 * MEDIÇÃO HML (escreve) — V1–V9 do vínculo do código de barras ao item (ADR-0071, Task 17).
 *
 * Usa o CLIENT DE PRODUÇÃO (`ConexosSispagWriteClient`) para TODA chamada ao ERP e o
 * `VinculoCodigoBarrasService` REAL para o caso guiado pelo serviço; só os repositórios
 * (decisões, pool, carteira, lote local) são em memória — HML não tem as nossas tabelas, e a
 * sessão do robô é contaminável por probe com banco.
 *
 * LIMITES DO HML (medidos em 2026-10-14): 278 títulos pendentes, TODOS vencidos há meses exceto um
 * (o 637, venc. 24/10) e NENHUM com o flag DDA. Logo:
 *   - o caso guiado pelo SERVIÇO (janela I17c: 0 ≤ Δ ≤ 5, barra ≥ data de débito) só é possível
 *     com o título futuro; os demais itens usam a MESMA sequência do client de produção
 *     (`validarCodigoBarras → confirmarCodigoBarras → editarItemDoRascunho` + releitura), sem o
 *     portão de elegibilidade, para medir o COMPORTAMENTO DO ERP (V1, V2, V4, V5, V7, V9);
 *   - o "1 DDA do ERP" do V1 não é reproduzível (nenhum título com o flag em HML).
 * Nada altera o cadastro de títulos de HML (sem `fin026`); só lotes de teste e seus itens.
 *
 * SEGURANÇA (todas recusam e saem com código 1):
 *  - `CONEXOS_BASE_URL` precisa conter `-hml`;
 *  - credenciais SÓ de `HML_ENV_FILE` (arquivo privado; o usuário de PRD é recusado em HML);
 *  - `databaseConnectionString=""` (não grava sessão em `columbia-default`);
 *  - só códigos de barras SINTÉTICOS (DV válido, gerados aqui): nenhum boleto real;
 *  - console, arquivo de saída e achados só carregam a MÁSCARA 5+4;
 *  - 1 sessão, sequencial, fora do horário de analista (cap de sessões do HML).
 *
 * Sem `EXECUTAR=1` só descobre e lista os títulos candidatos (leitura).
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" EXECUTAR=1 \
 *   npx tsx jobs/probe-hml-vinculo-codbar-v1.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
    process.exit(1);
}
if (!process.env.HML_ENV_FILE) {
    console.error('RECUSADO: informe HML_ENV_FILE (credenciais de HML; nunca o .env de PRD).');
    process.exit(1);
}
if (process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: rode com databaseConnectionString="" (sessão do robô contaminável).');
    process.exit(1);
}
const EXECUTAR = process.env.EXECUTAR === '1';
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-vinculo-codbar-v1';
const SEQ_REMESSA = Number(process.env.SEQ ?? 60);
/** O import de PRODUÇÃO manda `7` para BOLETO (`MODALIDADE_NATIVA`); `6` só nos experimentos antigos. */
const MODALIDADE_IMPORT = Number(process.env.MODALIDADE ?? 7);
/** Títulos já consumidos por execuções anteriores (ficam em lotes de teste de HML). */
const JA_USADOS = new Set((process.env.JA_USADOS ?? '').split(',').filter(Boolean));
const DAY = 24 * 60 * 60 * 1000;
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-vinculo] ${s}`);
const civil = (epoch: number): string => new Date(epoch).toISOString().slice(0, 10);
const mask = (s: unknown): string => {
    const t = String(s ?? '').replace(/\D/g, '');
    return t.length >= 44 ? `${t.slice(0, 5)}…${t.slice(-4)}` : t === '' ? '' : '(curto)';
};
const sanea = (v: unknown): unknown =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v).replace(/\d{20,}/g, '…'));

/** Sem cabeçalhos, cookies nem o corpo enviado: status e resposta do ERP com dígitos longos saneados. */
const erroSeguro = (e: unknown): Row => {
    const err = e as {
        name?: string;
        code?: string;
        message?: string;
        userMessage?: string;
        response?: { status?: unknown; data?: unknown };
        cause?: { response?: { status?: unknown; data?: unknown } };
    };
    const resp = err.response ?? err.cause?.response;
    return {
        nome: err.name,
        code: err.code,
        message: String(err.message ?? e)
            .replace(/\d{20,}/g, '…')
            .slice(0, 300),
        userMessage: err.userMessage ? String(err.userMessage).replace(/\d{20,}/g, '…') : undefined,
        status: resp?.status,
        data: sanea(resp?.data),
    };
};

interface Candidato {
    p: Awaited<ReturnType<ConexosSispagWriteClient['listarTitulosPendentes']>>[number];
    valor: number;
    venc: number;
}

interface CasoResultado {
    id: string;
    resumo: string;
    ok: boolean | 'nao-observavel';
    dados?: Row;
}

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
                bancoNaBarra: l.slice(17, 20),
                vencimento: dd(l.slice(91, 99)),
                valorTitulo: n(l.slice(99, 114)),
                valorPagamento: n(l.slice(152, 167)),
                dataPagamento: dd(l.slice(144, 152)),
            };
        });

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const sispag = container.resolve(ConexosSispagClient);
    const conv = new CodigoBarrasBoleto();
    log(`BASE ${BASE} (HML) · fil=${FIL} bnc=${BNC} · ${EXECUTAR ? 'EXECUTAR' : 'descoberta'}`);
    await base.ensureSid();
    log('login OK');

    const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: BNC });
    const ctx = lotes.find((l) => l.status === 0) ?? lotes[lotes.length - 1];
    if (!ctx) return log('nenhum lote nativo de contexto em HML.');
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
    const todos: Candidato[] = pend.map((p) => ({
        p,
        valor: Number(p.raw.titMnyValor ?? 0),
        venc: Number(p.raw.titDtaVencimento ?? 0),
    }));
    const livres = todos.filter((x) => !x.p.temBoletoDda && x.valor > 0 && x.venc > 0);
    const futuros = livres.filter((x) => x.venc >= hoje);
    // Antigos de valor pequeno (a barra sintética carrega o valor; nada de milhões em HML).
    const antigos = livres
        .filter(
            (x) =>
                x.venc < hoje &&
                x.valor >= 1 &&
                x.valor <= 5000 &&
                !JA_USADOS.has(String(x.p.docCod)),
        )
        .sort((a, b) => b.venc - a.venc || a.valor - b.valor);
    log(
        `pendentes ${pend.length} · livres ${livres.length} · futuros ${futuros.length} · antigos utilizáveis ${antigos.length} · com flag DDA ${todos.filter((x) => x.p.temBoletoDda).length}`,
    );
    for (const x of [...futuros.slice(0, 3), ...antigos.slice(0, 8)]) {
        log(`   doc=${x.p.docCod}/${x.p.titCod} R$ ${x.valor} venc ${civil(x.venc)}`);
    }
    if (!EXECUTAR) {
        writeFileSync(
            `${OUT}/descoberta.json`,
            JSON.stringify(
                {
                    pendentes: pend.length,
                    futuros: futuros.length,
                    antigos: antigos.length,
                    amostra: antigos.slice(0, 8).map((x) => ({
                        doc: `${x.p.docCod}/${x.p.titCod}`,
                        valor: x.valor,
                        venc: civil(x.venc),
                    })),
                },
                null,
                2,
            ),
        );
        return log('descoberta: nada escrito.');
    }
    if (antigos.length < 7) return log('poucos títulos antigos utilizáveis (precisa de 7).');

    const resultados: CasoResultado[] = [];
    const orfaos: number[] = [];
    const registrar = (r: CasoResultado): void => {
        resultados.push(r);
        log(
            `${r.id}: ${r.ok === true ? 'OK' : r.ok === false ? 'FALHOU' : 'NÃO OBSERVÁVEL'} — ${r.resumo}`,
        );
        if (r.dados) log(`   ${JSON.stringify(sanea(r.dados)).slice(0, 700)}`);
    };

    // ── infraestrutura de lote ───────────────────────────────────────────────
    const contas = await sispag.listContasCorrentes(FIL);
    const conta = contas.find((c) => c.bncCod === BNC) ?? contas[0];
    if (!conta) return log('sem conta pagadora.');
    const criarLote = async (dataDebito: number): Promise<number> => {
        const l = await write.criarLote({
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
            dataDebito,
        });
        orfaos.push(l.flpCod);
        return l.flpCod;
    };

    /** Import sem código; responde YES às perguntas do ERP (decisão de HML, não do código de produção). */
    const importar = async (flpCod: number, x: Candidato): Promise<Row> => {
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
        const path = 'fin015/finItemSispag/titulosPendentes/importar';
        try {
            await base.ensureSid();
            await base.postGenericOnce<unknown>(path, corpo, { filCod: FIL });
            return { importou: true };
        } catch (e) {
            const data = (e as { response?: { data?: Row } }).response?.data;
            const perguntas = (data?.questions ?? []) as Array<{
                id?: string | number;
                key?: string;
            }>;
            if (data?.type !== 'QUESTION' || perguntas.length === 0) {
                return { importou: false, erro: erroSeguro(e) };
            }
            const answers: Record<string, string> = {};
            for (const q of perguntas) if (q.id !== undefined) answers[String(q.id)] = 'YES';
            try {
                await base.ensureSid();
                await base.postGenericOnce<unknown>(path, { ...corpo, answers }, { filCod: FIL });
                return { importou: true, perguntasRespondidas: perguntas.map((q) => q.key) };
            } catch (e2) {
                return { importou: false, erro: erroSeguro(e2) };
            }
        }
    };

    const linhaDe = (barras: string): string => conv.paraLinhaDigitavel(barras) as string;
    const resumoItem = (i: Row): Row => ({
        doc: `${i.docCod}/${i.titCod}`,
        modalidade: i.itsVldModalidade,
        itsNumCodbar: mask(i.itsNumCodbar),
        itsNumBanco: i.itsNumBanco,
        bncDesNome: i.bncDesNome,
        vldVinculoDda: i.vldVinculoDda,
        itsMnyVlrPgto: i.itsMnyVlrPgto,
        itsDtaPgto: i.itsDtaPgto ? civil(Number(i.itsDtaPgto)) : null,
    });
    const lerItens = async (flpCod: number): Promise<Row[]> =>
        (await write.lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod })).itens.map(
            (i) => i.row,
        );
    const itemDe = (itens: Row[], doc: unknown): Row | undefined =>
        itens.find((i) => String(i.docCod) === String(doc));

    /** A MESMA sequência do client de produção, sem o portão de elegibilidade (mede o ERP). */
    const tentarSequencia = async (
        flpCod: number,
        row: Row,
        x: Candidato,
        barras44: string,
        modalidade: number,
        rowIntacta = false,
    ): Promise<Row> => {
        const linha = linhaDe(barras44);
        const p = {
            filCod: FIL,
            bncCod: BNC,
            codigo: linha,
            valorLiquido: x.valor,
            vencimento: x.venc,
            modalidade,
        };
        const saida: Row = { modalidadeTentada: modalidade };
        try {
            const v = await write.validarCodigoBarras(p);
            saida.validacao = {
                barraVlrPgto: v.barraVlrPgto,
                barraDtaVencimento: civil(v.barraDtaVencimento),
                splitCodBar: v.splitCodBar,
            };
            const c = await write.confirmarCodigoBarras({ ...p, validacao: v });
            saida.confirma = {
                itsMnyVlrPgtoResult: c.itsMnyVlrPgtoResult,
                itsDtaPgtoResult: civil(c.itsDtaPgtoResult),
                itsBncNumCodbancoResult: c.itsBncNumCodbancoResult,
                itsBncDesNomeResult: c.itsBncDesNomeResult,
            };
            await write.editarItemDoRascunho({
                filCod: FIL,
                bncCod: BNC,
                flpCod,
                // O item LIDO inteiro; só `itsVldModalidade` acompanha a tentativa (medição V4).
                // `rowIntacta`: a row como foi LIDA (os 5 campos do contrato e nada mais). Sem ela,
                // `itsVldModalidade` acompanha a tentativa (medição V4).
                item: rowIntacta ? row : { ...row, itsVldModalidade: modalidade },
                alteracoes: {
                    itsNumCodbar: linha,
                    itsNumBanco: c.itsBncNumCodbancoResult,
                    bncDesNome: c.itsBncDesNomeResult,
                    itsMnyVlrPgto: c.itsMnyVlrPgtoResult,
                    itsDtaPgto: c.itsDtaPgtoResult,
                },
            });
            saida.put = 'ok';
        } catch (e) {
            saida.erro = erroSeguro(e);
        }
        return saida;
    };

    const vincularCru = async (
        flpCod: number,
        row: Row,
        x: Candidato,
        barras44: string,
        opcoes: { modalidades?: number[]; rowIntacta?: boolean } = {},
    ): Promise<Row> => {
        const daLinha = Number(row.itsVldModalidade) || MODALIDADE_IMPORT;
        const ordem = opcoes.modalidades ?? [daLinha, daLinha === 6 ? 7 : 6];
        const tentativas: Row[] = [];
        let observado = false;
        let depois: Row | undefined;
        for (const m of ordem) {
            const t = await tentarSequencia(
                flpCod,
                row,
                x,
                barras44,
                m,
                opcoes.rowIntacta === true,
            );
            tentativas.push(t);
            depois = itemDe(await lerItens(flpCod), x.p.docCod);
            observado =
                depois !== undefined &&
                conv.paraBarras(String(depois.itsNumCodbar ?? '').replace(/\D/g, '')) === barras44;
            if (observado) break;
        }
        const ultima = tentativas[tentativas.length - 1] ?? {};
        return {
            doc: `${x.p.docCod}/${x.p.titCod}`,
            codigo: mask(barras44),
            modalidadeDaLinha: daLinha,
            tentativas,
            validacao: ultima.validacao,
            confirma: ultima.confirma,
            releitura: depois ? resumoItem(depois) : 'item ausente',
            observado,
        };
    };

    const gerarRemessa = async (flpCod: number, seq: number): Promise<Row> => {
        const r: Row = {};
        try {
            await write.finalizarLote({ filCod: FIL, bncCod: BNC, flpCod });
            r.finalizou = true;
        } catch (e) {
            r.finalizou = false;
            r.erroFinalizar = erroSeguro(e);
            return r;
        }
        try {
            const nome = `PG${String(new Date().getUTCDate()).padStart(2, '0')}${String(new Date().getUTCMonth() + 1).padStart(2, '0')}${String(seq).padStart(2, '0')}.REM`;
            await write.gerarRemessa({
                filCod: FIL,
                bncCod: BNC,
                flpCod,
                grbCodSeq: 1,
                seqNum: seq,
                gabEspNomeArquivo: nome,
            });
            const arqs = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod });
            const arq = arqs.find((a) => a.nomeArquivo === nome) ?? arqs.find((a) => a.conteudo);
            r.remessa = arq?.nomeArquivo;
            if (arq?.conteudo) r.segmentosJ = decodificarJ(arq.conteudo);
        } catch (e) {
            r.erroRemessa = erroSeguro(e);
        }
        return r;
    };

    const D = (n: number): number => hoje + n * DAY;
    const sint = (x: Candidato, venc: number, serie: number, banco = '341', valor?: number) =>
        CodigoBarrasSintetico.barras({
            valor: valor ?? x.valor,
            vencimento: civil(venc),
            banco,
            serie,
        });

    /** Retira do rascunho (DELETE) o que não vai ser vinculado, para o `finalizar` poder passar. */
    const limparSemCodigo = async (flpCod: number): Promise<string[]> => {
        const saiu: string[] = [];
        const lidos = await write.lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod });
        for (const i of lidos.itens) {
            if (String(i.row.itsNumCodbar ?? '').trim() !== '' || i.itsCodSeq === undefined)
                continue;
            try {
                await write.removerItemDoRascunho({
                    filCod: FIL,
                    bncCod: BNC,
                    flpCod,
                    itsCodSeq: i.itsCodSeq,
                    filCodItem: i.filCod,
                });
                saiu.push(`${i.docCod}/${i.titCod}`);
            } catch (e) {
                log(`   DELETE ${i.docCod} falhou: ${JSON.stringify(erroSeguro(e)).slice(0, 200)}`);
            }
        }
        return saiu;
    };

    // ═════ L1 — comportamento do ERP com a sequência do client (V1, V2, V3, V4, V7, V9) ═════
    // Plano: banco emissor e data da barra por título. 341 = banco do lote (conta 341).
    const plano: Array<{ banco: string; venc: number; nota: string }> = [
        { banco: '341', venc: D(2), nota: 'barra = data de débito (V9a)' },
        { banco: '341', venc: D(12), nota: 'barra +10 dias' },
        { banco: '341', venc: D(7), nota: 'barra = débito + 5 dias (V9b)' },
        { banco: '341', venc: D(3), nota: 'alvo do teste de terceiro (V3)' },
        { banco: '237', venc: D(4), nota: 'banco emissor ≠ banco pagador (V4/V7)' },
        { banco: '104', venc: D(4), nota: 'layout 104 (V7)' },
        { banco: '329', venc: D(4), nota: 'layout 329 (V7)' },
        {
            banco: '237',
            venc: D(5),
            nota: 'V4b: modalidade 7 só na validação; PUT com a row intacta',
        },
        {
            banco: '104',
            venc: D(5),
            nota: 'V4b: modalidade 7 só na validação; PUT com a row intacta',
        },
    ];
    const debitoL1 = D(2);
    const flp1 = await criarLote(debitoL1);
    log(
        `L1 criado: flp=${flp1} (débito ${civil(debitoL1)}; import com modalidade ${MODALIDADE_IMPORT})`,
    );
    const importados: Array<{ t: Candidato; banco: string; venc: number; nota: string }> = [];
    let proximo = 0;
    while (importados.length < plano.length && proximo < antigos.length) {
        const t = antigos[proximo++] as Candidato;
        const alvo = plano[importados.length] as (typeof plano)[number];
        const r = await importar(flp1, t);
        if (r.importou !== true) {
            log(`   import ${t.p.docCod}: ${JSON.stringify(r).slice(0, 200)}`);
            continue;
        }
        const lidos = await lerItens(flp1);
        const row = itemDe(lidos, t.p.docCod);
        const modalidade = Number(row?.itsVldModalidade);
        if (modalidade !== 6 && modalidade !== 7) {
            // O ERP reclassificou o item (crédito em conta, PIX...): não é boleto — fica fora.
            log(`   ${t.p.docCod}: modalidade ${String(row?.itsVldModalidade)} — fora do plano`);
            continue;
        }
        importados.push({ t, ...alvo });
    }
    let itensL1 = await lerItens(flp1);
    log(`L1: ${itensL1.length} item(ns) no rascunho; ${importados.length} no plano`);
    for (const i of itensL1) log(`   ${JSON.stringify(resumoItem(i))}`);
    const rowDe = (t: Candidato): Row | undefined => itemDe(itensL1, t.p.docCod);

    // V1 (parte client) + V9: itens vinculados com barras 341 (banco do lote) e 237/104/329.
    const v1: Row[] = [];
    const v47: Row[] = [];
    let serie = 1;
    for (const alvo of importados) {
        const row = rowDe(alvo.t);
        if (!row) continue;
        if (alvo.nota.startsWith('alvo do teste de terceiro')) continue; // V3 abaixo
        const intacta = alvo.nota.startsWith('V4b');
        const r = await vincularCru(
            flp1,
            row,
            alvo.t,
            sint(alvo.t, alvo.venc, serie, alvo.banco),
            intacta ? { modalidades: [7], rowIntacta: true } : {},
        );
        serie += 1;
        (alvo.banco === '341' ? v1 : v47).push({ banco: alvo.banco, nota: alvo.nota, ...r });
    }

    // V2: PUT repetido com o mesmo payload; PUT sobre item que já tem a barra (outra barra).
    const v2: Row = {};
    {
        itensL1 = await lerItens(flp1);
        const primeiro = importados[0];
        const row = primeiro ? itemDe(itensL1, primeiro.t.p.docCod) : undefined;
        if (primeiro && row && String(row.itsNumCodbar ?? '') !== '') {
            const antes = resumoItem(row);
            try {
                await write.editarItemDoRascunho({
                    filCod: FIL,
                    bncCod: BNC,
                    flpCod: flp1,
                    item: row,
                    alteracoes: {
                        itsNumCodbar: String(row.itsNumCodbar),
                        itsNumBanco: row.itsNumBanco as string | number,
                        bncDesNome: String(row.bncDesNome),
                        itsMnyVlrPgto: Number(row.itsMnyVlrPgto),
                        itsDtaPgto: Number(row.itsDtaPgto),
                    },
                });
                v2.putRepetido = 'aceito (200)';
            } catch (e) {
                v2.putRepetido = erroSeguro(e);
            }
            const depois = itemDe(await lerItens(flp1), primeiro.t.p.docCod);
            v2.itemIgual =
                JSON.stringify(depois ? resumoItem(depois) : null) === JSON.stringify(antes);
            // Mesmo item, depois do PUT repetido, regravando a MESMA barra pela sequência inteira.
            const mesma = conv.paraBarras(String(row.itsNumCodbar).replace(/\D/g, '')) as string;
            const r = await vincularCru(flp1, depois ?? row, primeiro.t, mesma);
            v2.regravarMesmaBarra = { observado: r.observado, tentativas: r.tentativas };
            // E por cima da existente com OUTRA barra (o ERP não protege).
            const outra = sint(primeiro.t, primeiro.venc, 99, '341');
            const r2 = await vincularCru(flp1, depois ?? row, primeiro.t, outra);
            v2.sobrescritaPorOutraBarra = { observado: r2.observado };
        }
    }
    registrar({
        id: 'V1',
        ok: v1.length >= 3 && v1.every((r) => r.observado === true),
        resumo: `${v1.length} itens 341 vinculados pela sequência do client; observado=${JSON.stringify(v1.map((r) => r.observado))}`,
        dados: {
            itens: v1,
            nota: 'nenhum título com flag DDA em HML; item guiado pelo serviço em L2',
        },
    });
    registrar({
        id: 'V2',
        ok: v2.itemIgual === true,
        resumo: 'PUT repetido com o mesmo payload e PUT sobre item que já tem a barra',
        dados: v2,
    });

    // V3: edição por outro caminho entre a leitura e o PUT.
    {
        itensL1 = await lerItens(flp1);
        const alvo = importados.find((a) => a.nota.startsWith('alvo do teste de terceiro'));
        const rowLida = alvo ? itemDe(itensL1, alvo.t.p.docCod) : undefined;
        const dados: Row = {};
        if (alvo && rowLida) {
            const doTerceiro = await vincularCru(flp1, rowLida, alvo.t, sint(alvo.t, D(3), 50));
            dados.terceiroGravou = doTerceiro.observado;
            // Seguramos a row ANTIGA (sem barra): o PUT com ela, o que faz?
            const nossa = sint(alvo.t, D(3), 51);
            const modalidade = Number(rowLida.itsVldModalidade) || MODALIDADE_IMPORT;
            try {
                const base0 = {
                    filCod: FIL,
                    bncCod: BNC,
                    codigo: linhaDe(nossa),
                    valorLiquido: alvo.t.valor,
                    vencimento: alvo.t.venc,
                    modalidade,
                };
                const v = await write.validarCodigoBarras(base0);
                const c = await write.confirmarCodigoBarras({ ...base0, validacao: v });
                await write.editarItemDoRascunho({
                    filCod: FIL,
                    bncCod: BNC,
                    flpCod: flp1,
                    item: rowLida,
                    alteracoes: {
                        itsNumCodbar: linhaDe(nossa),
                        itsNumBanco: c.itsBncNumCodbancoResult,
                        bncDesNome: c.itsBncDesNomeResult,
                        itsMnyVlrPgto: c.itsMnyVlrPgtoResult,
                        itsDtaPgto: c.itsDtaPgtoResult,
                    },
                });
                dados.putComRowAntiga = 'aceito (200)';
            } catch (e) {
                dados.putComRowAntiga = erroSeguro(e);
            }
            const depois = itemDe(await lerItens(flp1), alvo.t.p.docCod);
            dados.releitura = depois ? resumoItem(depois) : 'ausente';
            dados.prevaleceu = depois
                ? conv.paraBarras(String(depois.itsNumCodbar ?? '').replace(/\D/g, '')) === nossa
                    ? 'a NOSSA (sobrescreveu o terceiro: o ERP não tem lock otimista no item)'
                    : 'a do terceiro'
                : 'n/a';
        }
        registrar({
            id: 'V3',
            ok: dados.releitura !== undefined,
            resumo: 'comportamento do ERP com PUT sobre row antiga; a defesa é a releitura imediatamente antes (I17f) + ItemEditadoPorTerceiroError',
            dados,
        });
    }

    // V4 + V7: bancos emissores 237 (conta pagadora 341), 104 e 329.
    registrar({
        id: 'V4',
        ok: v47.some((r) => r.banco === '237' && r.observado === true),
        resumo: 'modalidade do item e resposta do ERP para banco emissor ≠ banco pagador (237 com conta 341)',
        dados: { itens: v47.filter((r) => r.banco === '237') },
    });
    registrar({
        id: 'V7',
        ok: v47.length > 0 && v47.every((r) => r.validacao !== undefined),
        resumo: 'layouts 237/104/329: splitCodBar, banco devolvido pelo confirma e modalidade que o ERP aceitou',
        dados: {
            itens: v47.map((r) => ({
                banco: r.banco,
                modalidadeDaLinha: r.modalidadeDaLinha,
                tentativas: (r.tentativas as Row[]).map((t) => ({
                    modalidadeTentada: t.modalidadeTentada,
                    validacao: t.validacao,
                    confirma: t.confirma,
                    put: t.put,
                    erro: t.erro,
                })),
                releitura: r.releitura,
                observado: r.observado,
            })),
        },
    });

    // Guarda I16 sobre o conjunto: nenhum código repetido nem ilegível (análise pura, como em produção).
    itensL1 = await lerItens(flp1);
    {
        const analise = new AnaliseCodigoBarrasRepetido(conv);
        const comCodigo = itensL1
            .filter((i) => String(i.itsNumCodbar ?? '').replace(/\D/g, '') !== '')
            .map((i) => ({
                chave: `${i.filCod}:${i.docCod}:${i.titCod}`,
                codigo: String(i.itsNumCodbar),
            }));
        const a = analise.analisar(comCodigo);
        registrar({
            id: 'V1-guarda-I16',
            ok: a.grupos.length === 0 && a.ilegiveis.length === 0,
            resumo: `${comCodigo.length} códigos no rascunho; grupos repetidos ${a.grupos.length}; ilegíveis ${a.ilegiveis.length}`,
        });
    }

    // Finalizar L1 + remessa + J (V1, V4, V9): só com o que tem código.
    const removidos = await limparSemCodigo(flp1);
    log(`L1: retirados do rascunho sem código: ${removidos.join(', ') || '—'}`);
    const rem1 = await gerarRemessa(flp1, SEQ_REMESSA);
    registrar({
        id: 'V1-remessa',
        ok: rem1.finalizou === true && Array.isArray(rem1.segmentosJ),
        resumo: `finalizar=${String(rem1.finalizou)}; segmentos J=${Array.isArray(rem1.segmentosJ) ? rem1.segmentosJ.length : 0}`,
        dados: { ...rem1, retiradosSemCodigo: removidos },
    });
    registrar({
        id: 'V9',
        ok: rem1.finalizou === true,
        resumo: 'finalizar aceita item com barra = data de débito (R2, igualdade) e barra = débito + 5 dias',
        dados: { finalizou: rem1.finalizou, erroFinalizar: rem1.erroFinalizar },
    });

    // V5: PUT em item de lote FINALIZADO (L1 finalizado acima, se o finalizar passou).
    {
        const itensFinais = await lerItens(flp1);
        const row = itensFinais.find((i) => String(i.itsNumCodbar ?? '') !== '');
        const dados: Row = { lote: flp1, finalizado: rem1.finalizou };
        if (row && rem1.finalizou === true) {
            const alvo = importados.find((a) => String(a.t.p.docCod) === String(row.docCod));
            if (alvo) {
                dados.tentativa = await vincularCru(flp1, row, alvo.t, sint(alvo.t, alvo.venc, 77));
            }
        }
        registrar({
            id: 'V5',
            ok: dados.tentativa !== undefined ? true : 'nao-observavel',
            resumo: 'PUT em item de lote nativo FINALIZADO (confirma ou invalida a I17i)',
            dados,
        });
    }

    // ═════ L2 — o SERVIÇO de produção ponta a ponta com o único título futuro (V1, V2, V3) ═════
    const f = futuros[0];
    if (!f) {
        registrar({
            id: 'V1-servico',
            ok: 'nao-observavel',
            resumo: 'nenhum título com vencimento futuro em HML para guiar o serviço',
        });
    } else {
        const debitoL2 = hoje;
        const flp2 = await criarLote(debitoL2);
        log(
            `L2 criado: flp=${flp2} (débito ${civil(debitoL2)}) — guiado pelo VinculoCodigoBarrasService`,
        );
        const imp = await importar(flp2, f);
        const aberto = await sispag.lerTotalAberto(FIL, String(f.p.docCod), String(f.p.titCod));
        const barrasF = sint(f, f.venc + 5 * DAY, 1);
        const dec = {
            id: 'hml-decisao-1',
            filCod: FIL,
            docCod: String(f.p.docCod),
            titCod: String(f.p.titCod),
            ddcCod: 1,
            ditCod: 1,
            decisao: 'CONFIRMADA',
            confirmacaoEmissorId: 'hml-par-1',
            pesCod: String(f.p.raw.pesCod ?? '1'),
        };
        const eventos: Row[] = [];
        const gravacoes: Row[] = [];
        const itensLocais: LotePagamento['itens'] = [
            {
                loteId: 'hml-l2',
                filCod: FIL,
                docCod: String(f.p.docCod),
                titCod: String(f.p.titCod),
                credor: 'HML',
                valor: f.valor,
                vencimento: f.venc,
                modalidade: 'BOLETO',
                incluidoPor: 'hml',
                divergencia: false,
            },
        ];
        const loteLocal = {
            id: 'hml-l2',
            filCod: FIL,
            status: 'FINALIZADO',
            versao: 1,
            dataDebito: civil(debitoL2),
            itens: itensLocais,
        } as unknown as LotePagamento;
        const servico = new VinculoCodigoBarrasService(
            write,
            sispag,
            {
                gravarVinculoCodigoBarras: async (p: Row) => {
                    gravacoes.push(p);
                    return true;
                },
            } as unknown as LotePagamentoRepository,
            {
                listarDecisoes: async () => [dec],
                listarParesVigentes: async () => [{ id: 'hml-par-1', estado: 'VIGENTE' }],
                registrarEventoVinculo: async (e: Row) => {
                    eventos.push(e);
                    return { inserido: true };
                },
                existeVinculoAplicado: async () => false,
            } as unknown as SugestaoBoletoRepository,
            {
                buscarPorChave: async () => ({
                    ddcCod: 1,
                    ditCod: 1,
                    valor: f.valor,
                    vencimento: civil(f.venc + 5 * DAY),
                    codbar: barrasF,
                }),
            } as unknown as BoletoDdaRepository,
            {
                buscarPorChave: async () => ({
                    filCod: FIL,
                    docCod: dec.docCod,
                    titCod: dec.titCod,
                    valor: f.valor,
                    vencimento: f.venc,
                    ativo: true,
                    temBoleto: false,
                    pago: false,
                    liberado: true,
                }),
            } as unknown as TituloAPagarRepository,
            new ElegibilidadeVinculoCodigoBarras(conv),
            new RegraSugestaoBoleto(),
            conv,
            new BankingCalendar(),
            {
                getEnvironmentVars: async () => ({
                    sispagBindCodbarFiliais: `${FIL}:on`,
                    sispagLiveWriteEnabled: true,
                }),
            } as unknown as EnvironmentProvider,
            {
                info: async () => undefined,
                warn: async () => undefined,
                error: async () => undefined,
            } as unknown as LogService,
            {
                withTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
            } as unknown as PostgreeDatabaseClient,
        );

        let exec: Row;
        try {
            const r = await servico.executar({
                lote: loteLocal,
                bncCod: BNC,
                flpCod: flp2,
                bancoLote: 341,
            });
            exec = {
                vinculados: r.vinculados.map((v) => ({
                    titulo: v.titulo,
                    codigoMascarado: v.codigoMascarado,
                    jaVinculado: v.jaVinculado,
                })),
                retirar: r.retirar,
            };
        } catch (e) {
            exec = { erro: erroSeguro(e) };
        }
        const item2 = itemDe(await lerItens(flp2), f.p.docCod);
        registrar({
            id: 'V1-servico',
            ok: Array.isArray(exec.vinculados) && (exec.vinculados as unknown[]).length === 1,
            resumo: `serviço de produção sobre o título futuro ${f.p.docCod}/${f.p.titCod} (aberto ao vivo ${aberto.legivel ? aberto.totalAberto : 'ilegível'}; Δ +5 dias; modalidade do import ${MODALIDADE_IMPORT})`,
            dados: {
                importou: imp.importou,
                resultado: exec,
                item: item2 ? resumoItem(item2) : null,
                eventos: eventos.map((e) => ({ tipo: e.tipo, motivo: e.motivo })),
                gravacoes: gravacoes.length,
            },
        });

        // V2 (serviço): reexecutar é idempotente — nenhuma chamada nova de escrita.
        const antesPut = write.editarItemDoRascunho;
        let chamadasPut = 0;
        (write as unknown as { editarItemDoRascunho: unknown }).editarItemDoRascunho = async (
            ...a: Parameters<typeof antesPut>
        ) => {
            chamadasPut += 1;
            return antesPut(...a);
        };
        let reexec: Row;
        try {
            const r2 = await servico.executar({
                lote: loteLocal,
                bncCod: BNC,
                flpCod: flp2,
                bancoLote: 341,
            });
            reexec = {
                vinculados: r2.vinculados.map((v) => v.jaVinculado),
                retirar: r2.retirar.length,
            };
        } catch (e) {
            reexec = { erro: erroSeguro(e) };
        }
        (write as unknown as { editarItemDoRascunho: unknown }).editarItemDoRascunho = antesPut;
        registrar({
            id: 'V2-servico',
            ok: chamadasPut === 0 && reexec.erro === undefined,
            resumo: `reexecução idempotente: PUTs=${chamadasPut}`,
            dados: reexec,
        });

        // Finaliza L2 e gera a remessa ANTES de simular o terceiro: o J tem que ser o NOSSO código.
        const rem2 = await gerarRemessa(flp2, SEQ_REMESSA + 1);
        const jNosso = Array.isArray(rem2.segmentosJ)
            ? (rem2.segmentosJ as Row[]).some(
                  (j) => j.codigoBarras === mask(barrasF) && j.valorPagamento === f.valor,
              )
            : false;
        registrar({
            id: 'V1-servico-remessa',
            ok: rem2.finalizou === true && jNosso,
            resumo: `finalizar=${String(rem2.finalizou)}; J=${Array.isArray(rem2.segmentosJ) ? rem2.segmentosJ.length : 0}; J com a barra/valor do vínculo=${String(jNosso)}`,
            dados: rem2,
        });

        // V3 (serviço): terceiro troca a barra do item; o serviço NÃO sobrescreve. (Em lote já
        // finalizado o PUT do terceiro pode ser recusado: o que o ERP responde é o dado do V5.)
        const rowF = itemDe(await lerItens(flp2), f.p.docCod);
        const v3: Row = {};
        if (rowF) {
            const alheia = sint(f, f.venc + 2 * DAY, 90);
            const gravou = await vincularCru(flp2, rowF, f, alheia);
            v3.terceiro = {
                observado: gravou.observado,
                tentativas: (gravou.tentativas as Row[]).map((t) => ({
                    modalidadeTentada: t.modalidadeTentada,
                    put: t.put,
                    erro: t.erro,
                })),
            };
            v3.loteFinalizado = rem2.finalizou;
            try {
                await servico.executar({
                    lote: loteLocal,
                    bncCod: BNC,
                    flpCod: flp2,
                    bancoLote: 341,
                });
                v3.servico =
                    gravou.observado === true
                        ? 'NÃO detectou o terceiro'
                        : 'sem terceiro: idempotente';
            } catch (e) {
                v3.servico = erroSeguro(e);
            }
        }
        registrar({
            id: 'V3-servico',
            ok:
                (typeof v3.servico === 'object' &&
                    (v3.servico as Row).code === 'ITEM_EDITADO_POR_TERCEIRO') ||
                (v3.terceiro as Row | undefined)?.observado === false,
            resumo: 'edição de terceiro depois do vínculo: o serviço reconhece e não sobrescreve (ou o ERP recusou o PUT do terceiro em lote finalizado)',
            dados: v3,
        });
    }

    // V6: não observável em HML.
    registrar({
        id: 'V6',
        ok: 'nao-observavel',
        resumo: 'o boleto sintético não existe no pool fin124 e não há retorno bancário em HML: não dá para observar se o boleto reaparece "livre" depois do pagamento',
    });

    // V8: título com desconto/acréscimo — varre os antigos comparando totalAberto com o valor do grid.
    {
        const diferentes: Row[] = [];
        let lidos = 0;
        for (const x of antigos.slice(0, 40)) {
            const a = await sispag.lerTotalAberto(FIL, String(x.p.docCod), String(x.p.titCod));
            lidos += 1;
            if (a.legivel && Math.round(a.totalAberto * 100) !== Math.round(x.valor * 100)) {
                diferentes.push({
                    doc: `${x.p.docCod}/${x.p.titCod}`,
                    totalAberto: a.totalAberto,
                    titMnyValor: x.valor,
                });
            }
        }
        registrar({
            id: 'V8',
            ok: diferentes.length > 0 ? true : 'nao-observavel',
            resumo: `${lidos} títulos lidos; com totalAberto ≠ titMnyValor (grid de pendentes): ${diferentes.length}`,
            dados: { diferentes: diferentes.slice(0, 5) },
        });
    }

    writeFileSync(
        `${OUT}/resultados.json`,
        JSON.stringify({ lotesDeTeste: orfaos, resultados }, null, 2),
    );
    log(`salvo ${OUT}/resultados.json · lotes de teste deixados em HML: ${orfaos.join(', ')}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-vinculo] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

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

/**
 * MEDIÇÃO HML (escreve) — boleto com diferença de CENTAVOS em relação ao título (pós ADR-0071).
 *
 * Decisão do maintainer (2026-10-19): o valor do BOLETO é o verdadeiro. Boleto acima do aberto ⇒ a
 * diferença é juros/tarifa; abaixo ⇒ desconto. Antes de modelar, medir o que o ERP aceita:
 *
 *   A0  barra = aberto + 0,01, nada declarado           (controle: o `finalizar` recusa?)
 *   A1  barra = aberto + 0,01, item `titMnyJuros = 0,01`
 *   A2  barra = aberto + 0,01, item `itsMnyRecbrac = 0,01` (semântica do campo desconhecida)
 *   B0  barra = aberto − 0,01, nada declarado           (o `finalizar` aceita pagar a menos?)
 *   B1  barra = aberto − 0,01, item `titMnyDesconto = 0,01`
 *   C*  só leitura: o que o `confirmaCodigoBarras` calcula com juros/desconto ≠ 0 (sem PUT)
 *
 * Um LOTE POR CASO: um item recusado derruba o `finalizar` do lote inteiro. O aberto é o
 * `fin064.totalAberto` AO VIVO (a régua do `finalizar`), nunca o `titMnyValor` do grid.
 * Não observável em HML: retorno bancário e a baixa (se o desconto/juros fecham o título).
 *
 * SEGURANÇA: idêntica ao `probe-hml-vinculo-codbar-v1.ts` — base `-hml`, credenciais só de
 * `HML_ENV_FILE`, `databaseConnectionString=""`, só barras SINTÉTICAS, saída só com máscara 5+4,
 * 1 sessão, sequencial. Nada altera cadastro de título; só lotes de teste e seus itens.
 * Sem `EXECUTAR=1` só descobre os títulos e lê o aberto (leitura).
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" EXECUTAR=1 JA_USADOS=... \
 *   npx tsx jobs/probe-hml-vinculo-centavos.ts
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
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-vinculo-centavos';
const SEQ_REMESSA = Number(process.env.SEQ ?? 70);
const MODALIDADE = 6;
const JA_USADOS = new Set((process.env.JA_USADOS ?? '').split(',').filter(Boolean));
const SO_CASOS = new Set((process.env.CASOS ?? '').split(',').filter(Boolean));
const DAY = 24 * 60 * 60 * 1000;
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-centavos] ${s}`);
const civil = (epoch: number): string => new Date(epoch).toISOString().slice(0, 10);
const mask = (s: unknown): string => {
    const t = String(s ?? '').replace(/\D/g, '');
    return t.length >= 44 ? `${t.slice(0, 5)}…${t.slice(-4)}` : t === '' ? '' : '(curto)';
};
const sanea = (v: unknown): unknown =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v).replace(/\d{20,}/g, '…'));
const reais = (centavos: number): number => Math.round(centavos) / 100;

const erroSeguro = (e: unknown): Row => {
    const err = e as {
        name?: string;
        message?: string;
        userMessage?: string;
        response?: { status?: unknown; data?: unknown };
        cause?: { response?: { status?: unknown; data?: unknown } };
    };
    const resp = err.response ?? err.cause?.response;
    return {
        nome: err.name,
        message: String(err.message ?? e)
            .replace(/\d{20,}/g, '…')
            .slice(0, 300),
        userMessage: err.userMessage ? String(err.userMessage).replace(/\d{20,}/g, '…') : undefined,
        status: resp?.status,
        data: sanea(resp?.data),
    };
};

/** Segmento J (≠ J-52) do CNAB 240 Itaú, com desconto e acréscimo: o que o banco recebe. */
const decodificarJ = (conteudo: string): Row[] =>
    conteudo
        .split(/\r?\n/)
        .filter((l) => l.length >= 167 && l[7] === '3' && l[13] === 'J' && l.slice(17, 19) !== '52')
        .map((l) => {
            const dd = (s: string): string => `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
            const n = (s: string): number => Number(s) / 100;
            return {
                codigoBarras: mask(l.slice(17, 61)),
                // Barras 44: valor nas posições 10–19 (centavos).
                valorNaBarra: n(l.slice(17 + 9, 17 + 19)),
                vencimento: dd(l.slice(91, 99)),
                valorTitulo: n(l.slice(99, 114)),
                descontoAbatimento: n(l.slice(114, 129)),
                moraMulta: n(l.slice(129, 144)),
                dataPagamento: dd(l.slice(144, 152)),
                valorPagamento: n(l.slice(152, 167)),
            };
        });

interface Caso {
    id: string;
    nota: string;
    /** barra − aberto, em centavos. */
    deltaCentavos: number;
    /** Campos extras gravados no item junto com o código (a declaração da diferença). */
    extrasItem: Row;
    /** Grava também `itsMnyValor` = valor da barra (de onde o J pode tirar o pagamento). */
    valorItemIgualBarra?: boolean;
}

const CASOS: Caso[] = [
    { id: 'A0', nota: 'acima, nada declarado (controle)', deltaCentavos: 1, extrasItem: {} },
    {
        id: 'A1',
        nota: 'acima, item titMnyJuros',
        deltaCentavos: 1,
        extrasItem: { titMnyJuros: 0.01 },
    },
    {
        id: 'A2',
        nota: 'acima, item itsMnyRecbrac',
        deltaCentavos: 1,
        extrasItem: { itsMnyRecbrac: 0.01 },
    },
    { id: 'B0', nota: 'abaixo, nada declarado', deltaCentavos: -1, extrasItem: {} },
    {
        id: 'B1',
        nota: 'abaixo, item titMnyDesconto',
        deltaCentavos: -1,
        extrasItem: { titMnyDesconto: 0.01 },
    },
    {
        id: 'B2',
        nota: 'abaixo, item itsMnyValor = barra',
        deltaCentavos: -1,
        extrasItem: {},
        valorItemIgualBarra: true,
    },
];

/** Campos de dinheiro do item relidos depois do PUT. */
const dinheiroDoItem = (i: Row | undefined): Row =>
    i === undefined
        ? { item: 'ausente' }
        : {
              itsNumCodbar: mask(i.itsNumCodbar),
              itsMnyValor: i.itsMnyValor,
              itsMnyVlrPgto: i.itsMnyVlrPgto,
              titMnyLiquido: i.titMnyLiquido,
              titMnyJuros: i.titMnyJuros,
              titMnyDesconto: i.titMnyDesconto,
              itsMnyAtm: i.itsMnyAtm,
              itsMnyOutros: i.itsMnyOutros,
              itsMnyRecbrac: i.itsMnyRecbrac,
              itsDtaPgto: i.itsDtaPgto ? civil(Number(i.itsDtaPgto)) : null,
          };

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
    const agora = new Date();
    const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
    const D = (n: number): number => hoje + n * DAY;

    // Títulos antigos, pequenos, sem DDA e com aberto AO VIVO = valor do grid (a régua é o aberto).
    const candidatos = pend
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
    const utilizaveis: Array<(typeof candidatos)[number] & { aberto: number }> = [];
    for (const x of candidatos.slice(0, 30)) {
        if (utilizaveis.length >= CASOS.length + 4) break;
        const a = await sispag.lerTotalAberto(FIL, String(x.p.docCod), String(x.p.titCod));
        if (a.legivel && a.totalAberto > 0.05) utilizaveis.push({ ...x, aberto: a.totalAberto });
    }
    log(
        `pendentes ${pend.length} · candidatos ${candidatos.length} · com aberto legível ${utilizaveis.length}`,
    );
    for (const x of utilizaveis) {
        log(
            `   doc=${x.p.docCod}/${x.p.titCod} grid R$ ${x.valor} aberto R$ ${x.aberto} venc ${civil(x.venc)}`,
        );
    }
    // Só leitura: relê os .REM já gerados destes lotes e decodifica o J (com o valor na barra).
    const lerRem = (process.env.LER_REM ?? '').split(',').filter(Boolean).map(Number);
    for (const flpCod of lerRem) {
        const arqs = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod });
        for (const a of arqs) {
            log(
                `flp ${flpCod} ${a.nomeArquivo}: ${JSON.stringify(a.conteudo ? decodificarJ(a.conteudo) : 'sem conteúdo')}`,
            );
        }
    }
    if (lerRem.length > 0) return;
    if (!EXECUTAR) {
        writeFileSync(
            `${OUT}/descoberta.json`,
            JSON.stringify(
                utilizaveis.map((x) => ({
                    doc: `${x.p.docCod}/${x.p.titCod}`,
                    grid: x.valor,
                    aberto: x.aberto,
                })),
                null,
                2,
            ),
        );
        return log('descoberta: nada escrito.');
    }

    const contas = await sispag.listContasCorrentes(FIL);
    const conta = contas.find((c) => c.bncCod === BNC) ?? contas[0];
    if (!conta) return log('sem conta pagadora.');
    const lotesDeTeste: number[] = [];
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
        lotesDeTeste.push(l.flpCod);
        return l.flpCod;
    };

    /** Import sem código; responde YES às perguntas do ERP (decisão de HML, como no probe v1). */
    const importar = async (flpCod: number, x: (typeof utilizaveis)[number]): Promise<Row> => {
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
            itsVldModalidade: MODALIDADE,
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
            await base.postGenericOnce<unknown>(path, corpo, { filCod: FIL });
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
                await base.postGenericOnce<unknown>(path, { ...corpo, answers }, { filCod: FIL });
                return { importou: true };
            } catch (e2) {
                return { importou: false, erro: erroSeguro(e2) };
            }
        }
    };

    const lerItem = async (flpCod: number, doc: unknown): Promise<Row | undefined> =>
        (await write.lerItensDoRascunho({ filCod: FIL, bncCod: BNC, flpCod })).itens
            .map((i) => i.row)
            .find((i) => String(i.docCod) === String(doc));

    const finalizarERemessa = async (flpCod: number, seq: number): Promise<Row> => {
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
            const nome = `PG${String(agora.getUTCDate()).padStart(2, '0')}${String(agora.getUTCMonth() + 1).padStart(2, '0')}${String(seq).padStart(2, '0')}.REM`;
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

    const resultados: Row[] = [];
    const vencBarra = D(3);
    const debito = D(2);
    let serie = 900;
    let seq = SEQ_REMESSA;
    let proximo = 0;

    for (const caso of CASOS.filter((c) => SO_CASOS.size === 0 || SO_CASOS.has(c.id))) {
        const x = utilizaveis[proximo++];
        if (!x) {
            log(`${caso.id}: sem título disponível`);
            break;
        }
        const res: Row = {
            id: caso.id,
            nota: caso.nota,
            doc: `${x.p.docCod}/${x.p.titCod}`,
            aberto: x.aberto,
        };
        try {
            const flpCod = await criarLote(debito);
            res.flpCod = flpCod;
            const imp = await importar(flpCod, x);
            if (imp.importou !== true) {
                res.import = imp;
                resultados.push(res);
                log(`${caso.id}: import falhou ${JSON.stringify(imp).slice(0, 300)}`);
                continue;
            }
            const row = await lerItem(flpCod, x.p.docCod);
            if (!row) throw new Error('item importado não encontrado na releitura');
            res.itemImportado = dinheiroDoItem(row);

            const valorBarra = reais(Math.round(x.aberto * 100) + caso.deltaCentavos);
            const barras = CodigoBarrasSintetico.barras({
                valor: valorBarra,
                vencimento: civil(vencBarra),
                banco: '341',
                serie: serie++,
            });
            const linha = conv.paraLinhaDigitavel(barras) as string;
            res.barra = { codigo: mask(barras), valor: valorBarra, vencimento: civil(vencBarra) };
            const p = {
                filCod: FIL,
                bncCod: BNC,
                codigo: linha,
                valorLiquido: x.aberto,
                vencimento: x.venc,
                modalidade: MODALIDADE,
            };
            const v = await write.validarCodigoBarras(p);
            const c = await write.confirmarCodigoBarras({ ...p, validacao: v });
            res.confirma = {
                itsMnyVlrPgtoResult: c.itsMnyVlrPgtoResult,
                itsDtaPgtoResult: civil(c.itsDtaPgtoResult),
            };

            // C*: o que o confirma calcula com juros/desconto declarados (só leitura, sem PUT).
            const confirmaCom = async (juros: number, desconto: number): Promise<Row> => {
                try {
                    const raw = await base.postGenericOnce<Row>(
                        'fin015/finItemSispag/validacao/confirmaCodigoBarras',
                        {
                            bncCodLote: BNC,
                            itsNumCodbar: linha,
                            itsVldModalidade: MODALIDADE,
                            titDtaVencimento: x.venc,
                            titMnyLiquido: x.aberto,
                            titMnyJuros: juros,
                            titMnyDesconto: desconto,
                            itsMnyVlrPgto: x.aberto,
                            splitCodBar: v.splitCodBar,
                            barraDtaVencimento: v.barraDtaVencimento,
                            barraVlrPgto: v.barraVlrPgto,
                        },
                        { filCod: FIL },
                    );
                    return { juros, desconto, itsMnyVlrPgtoResult: raw.itsMnyVlrPgtoResult };
                } catch (e) {
                    return { juros, desconto, erro: erroSeguro(e) };
                }
            };
            const delta = Math.abs(caso.deltaCentavos) / 100;
            res.confirmaComDeclaracao = [await confirmaCom(delta, 0), await confirmaCom(0, delta)];

            try {
                await write.editarItemDoRascunho({
                    filCod: FIL,
                    bncCod: BNC,
                    flpCod,
                    item: {
                        ...row,
                        ...caso.extrasItem,
                        ...(caso.valorItemIgualBarra ? { itsMnyValor: valorBarra } : {}),
                    },
                    alteracoes: {
                        itsNumCodbar: linha,
                        itsNumBanco: c.itsBncNumCodbancoResult,
                        bncDesNome: c.itsBncDesNomeResult,
                        itsMnyVlrPgto: c.itsMnyVlrPgtoResult,
                        itsDtaPgto: c.itsDtaPgtoResult,
                    },
                });
                res.put = 'ok';
            } catch (e) {
                res.put = erroSeguro(e);
            }
            res.itemDepoisDoPut = dinheiroDoItem(await lerItem(flpCod, x.p.docCod));
            res.remessa = await finalizarERemessa(flpCod, seq++);
        } catch (e) {
            res.erro = erroSeguro(e);
        }
        resultados.push(res);
        const rem = res.remessa as Row | undefined;
        log(
            `${caso.id} (${caso.nota}): finalizou=${String(rem?.finalizou)} · ${JSON.stringify(sanea(res)).slice(0, 900)}`,
        );
    }

    writeFileSync(`${OUT}/resultados.json`, JSON.stringify({ lotesDeTeste, resultados }, null, 2));
    log(
        `salvo ${OUT}/resultados.json · lotes de teste deixados em HML: ${lotesDeTeste.join(', ')}`,
    );
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-centavos] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * HML — Renegociação de Pagamentos (`fin070`) como forma de ajustar o valor de um título a pagar.
 *
 * Pergunta (2026-10-19): para o boleto com diferença de centavos, o título precisa ter aberto = valor
 * do boleto ANTES do vínculo (o J do `.REM` paga o valor do título). Itens do `fin015`, `PUT fin026`
 * e o desconto `fin062` não mudam o valor. A renegociação muda? Mede: o título novo mantém
 * `docCod/titCod`? Sai liberado (`titVld1/2/3Libera`, `vldLib`)? O `fin064.totalAberto` fica igual ao
 * boleto?
 *
 * Fases (`FASE`), cada uma relê tudo no fim:
 *   ler          (padrão) só leitura: título (fin064/fin026), renegociações existentes
 *   criar        POST fin070 (cabeçalho)                              — ESCREVE em HML
 *   titulo       POST fin070/titulos com `FRN` (+ juros/desconto)     — ESCREVE em HML
 *   composicao   POST fin070/titulos/composicao com `FRN`, `VALOR`, `VENC` — ESCREVE em HML
 *   finalizar    PUT fin070/finalizar/{FRN}                            — ESCREVE em HML
 *   cancelar     PUT fin070/cancelar/{FRN}                             — ESCREVE em HML
 * `EXTRA` (JSON) é mesclado no corpo da fase, para responder às validações do ERP sem editar o código.
 *
 * Travas: só HML, credenciais de `HML_ENV_FILE`, `databaseConnectionString=""`, 1 sessão.
 *
 *   cd src/backend
 *   HML_ENV_FILE=... CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" DOC=536 TIT=1 FASE=ler npx tsx jobs/probe-hml-renegociacao-fin070.ts
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
const DOC = process.env.DOC ?? '';
const TIT = process.env.TIT ?? '1';
const FASE = process.env.FASE ?? 'ler';
const FRN = process.env.FRN ?? '';
const OUT_DIR = process.env.PROBE_OUT ?? '/tmp/hml-fin070';
const EXTRA = JSON.parse(process.env.EXTRA ?? '{}') as Record<string, unknown>;
if (!DOC) {
    console.error('Informe DOC (e TIT).');
    process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[hml-fin070] ${s}`);
const sanea = (v: unknown): string => JSON.stringify(v ?? null).replace(/\d{20,}/g, '…');
const erro = (e: unknown): string => {
    const err = e as { message?: string; response?: { status?: unknown; data?: unknown } };
    return `${String(err.response?.status)} ${sanea(err.response?.data ?? err.message).slice(0, 900)}`;
};
const civil = (v: unknown): string =>
    typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : String(v);
/** Só campos preenchidos (o ERP devolve dezenas de nulos). */
const cheios = (r: Row | undefined): Row =>
    r ? Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null && v !== '')) : {};

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    log(`BASE ${BASE} (HML) · fil=${FIL} · título ${DOC}/${TIT} · fase ${FASE}`);

    const listar = async (path: string, filterList: Row, serviceName: string): Promise<Row[]> => {
        const res = await base.listGenericPaginated<Row>(
            path,
            { fieldList: [], filterList, pageNumber: 1, pageSize: 50, serviceName },
            { filCod: FIL },
        );
        return res.rows ?? [];
    };

    /** O título (e qualquer outro do mesmo documento — a renegociação pode criar títulos novos). */
    const estado = async (rotulo: string): Promise<Row | undefined> => {
        const linhas = await listar('fin064/list', { 'docCod#EQ': DOC }, 'fin064');
        for (const l of linhas) {
            log(
                `${rotulo} · fin064 ${String(l.docCod)}/${String(l.titCod)}: ${sanea({
                    docTip: l.docTip,
                    pesCod: l.pesCod,
                    titMnyValor: l.titMnyValor,
                    totalAberto: l.totalAberto,
                    vldLib: l.vldLib,
                    vldPago: l.vldPago,
                    titVldStatus: l.titVldStatus,
                    venc: civil(l.titDtaVencimento),
                })}`,
            );
        }
        const linha = linhas.find((l) => String(l.titCod ?? '1') === TIT);
        if (linha?.docTip !== undefined) {
            try {
                const t = await base.getGeneric<Row>(`fin026/${linha.docTip}/${DOC}/${TIT}`, {
                    filCod: FIL,
                });
                log(
                    `${rotulo} · fin026: ${sanea(Object.fromEntries(Object.entries(t).filter(([k]) => /Libera|Lib$|Status|MnyValor|DtaVenc/.test(k))))}`,
                );
            } catch (e) {
                log(`${rotulo} · fin026 falhou: ${erro(e)}`);
            }
        }
        if (FRN) {
            for (const [path, svc] of [
                [`fin070/titulos/list/${FRN}`, 'fin070'],
                [`fin070/${FRN}`, ''],
            ] as const) {
                try {
                    const r = svc
                        ? await listar(path, {}, svc)
                        : [await base.getGeneric<Row>(path, { filCod: FIL })];
                    log(`${rotulo} · ${path}: ${sanea(r.map(cheios)).slice(0, 1200)}`);
                } catch (e) {
                    log(`${rotulo} · ${path} falhou: ${erro(e)}`);
                }
            }
            if (linha?.docTip !== undefined) {
                try {
                    const c = await listar(
                        `fin070/titulos/composicao/list/${FRN}/${linha.docTip}/${DOC}/${TIT}`,
                        {},
                        'fin070',
                    );
                    log(`${rotulo} · composição: ${sanea(c.map(cheios)).slice(0, 1200)}`);
                } catch (e) {
                    log(`${rotulo} · composição falhou: ${erro(e)}`);
                }
            }
        }
        return linha;
    };

    const linha = await estado('antes');
    if (!linha) return log('título não encontrado no fin064.');
    const hoje = Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
    );

    const escrever = async (
        metodo: 'post' | 'put',
        path: string,
        corpo: Row | undefined,
    ): Promise<Row | undefined> => {
        const final = corpo ? { ...corpo, ...EXTRA } : undefined;
        log(`${metodo.toUpperCase()} ${path} ${sanea(final)}`);
        try {
            const r =
                metodo === 'post'
                    ? await base.postGenericOnce<Row>(path, final ?? {}, { filCod: FIL })
                    : await base.putGenericOnce<Row>(path, final ?? {}, { filCod: FIL });
            log(`   ok: ${sanea(cheios(r)).slice(0, 1200)}`);
            writeFileSync(
                `${OUT_DIR}/${FASE}-${Date.now()}.json`,
                JSON.stringify({ path, corpo: final, resposta: r }, null, 2),
            );
            return r;
        } catch (e) {
            log(`   falhou: ${erro(e)}`);
            return undefined;
        }
    };

    if (FASE === 'liberacao') {
        // Só leitura: o que segura o título na Liberação de Títulos (fin103) — regra, nível, status.
        for (const filtro of [{ filCod: FIL, 'docCod#EQ': DOC }, { filCod: FIL }]) {
            try {
                const rows = await listar('fin103/list', filtro, 'fin103');
                const doDoc = rows.filter((r) => String(r.docCod) === DOC);
                log(
                    `fin103/list ${sanea(filtro)}: ${rows.length} linhas, do doc ${DOC}: ${sanea(doDoc.map(cheios)).slice(0, 2500)}`,
                );
                if (rows[0] && doDoc.length === 0) {
                    log(`   exemplo de linha: ${sanea(cheios(rows[0])).slice(0, 800)}`);
                }
            } catch (e) {
                log(`fin103/list ${sanea(filtro)} falhou: ${erro(e)}`);
            }
        }
        return;
    }
    if (FASE === 'ler') {
        const regs = await listar('fin070/list', {}, 'fin070');
        log(`fin070/list: ${regs.length} renegociações`);
        for (const r of regs.slice(0, 5)) log(`   ${sanea(cheios(r)).slice(0, 600)}`);
        log(`fin064 completo (preenchidos): ${sanea(cheios(linha)).slice(0, 1500)}`);
        return;
    }
    if (FASE === 'criar') {
        await escrever('post', 'fin070', {
            filCod: FIL,
            pesCod: Number(linha.pesCod),
            frnDtaReneg: hoje,
            frnEspObs: 'TESTE HML KAVEX: DIFERENCA DE CENTAVOS DO BOLETO (NAO USAR)',
        });
    }
    if (!FRN && FASE !== 'criar') return log('Informe FRN (frnCod da renegociação).');
    if (FASE === 'titulo') {
        await escrever('post', 'fin070/titulos', {
            filCod: FIL,
            frnCod: Number(FRN),
            docTip: Number(linha.docTip),
            docCod: Number(DOC),
            titCod: Number(TIT),
        });
    }
    if (FASE === 'composicao') {
        const valor = Number(process.env.VALOR ?? 0);
        const venc = process.env.VENC ?? '';
        if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(venc)) return log('Informe VALOR e VENC.');
        await escrever('post', 'fin070/titulos/composicao', {
            filCod: FIL,
            frnCod: Number(FRN),
            docTip: Number(linha.docTip),
            docCod: Number(DOC),
            titCod: Number(TIT),
            frgDtaVencimento: Date.parse(`${venc}T00:00:00Z`),
            frgMnyValor: valor,
        });
    }
    if (FASE === 'cabecalho') {
        // Relê o cabeçalho e o regrava com `EXTRA` (ex.: acréscimo `frnMnyValor`/`frnPctValor`).
        const atual = await base.getGeneric<Row>(`fin070/${FRN}`, { filCod: FIL });
        await escrever('put', 'fin070', atual);
    }
    if (FASE === 'composicao-put') {
        // Regrava a 1ª linha da composição com `EXTRA` (ex.: novo `frgMnyValor`).
        const c = await listar(
            `fin070/titulos/composicao/list/${FRN}/${String(linha.docTip)}/${DOC}/${TIT}`,
            {},
            'fin070',
        );
        if (c[0]) await escrever('put', 'fin070/titulos/composicao', c[0]);
    }
    if (FASE === 'remover-titulo') {
        // `fin070/titulos` não tem PUT: para mudar juros/desconto, tira a linha e põe de novo.
        const path = `fin070/titulos/${FRN}/${String(linha.docTip)}/${DOC}/${TIT}`;
        try {
            await base.deleteGeneric<unknown>(path, { filCod: FIL });
            log(`DELETE ${path}: ok`);
        } catch (e) {
            log(`DELETE ${path} falhou: ${erro(e)}`);
        }
    }
    if (FASE === 'finalizar') await escrever('put', `fin070/finalizar/${FRN}`, undefined);
    if (FASE === 'cancelar') await escrever('put', `fin070/cancelar/${FRN}`, undefined);
    await estado(`depois de ${FASE}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[hml-fin070] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

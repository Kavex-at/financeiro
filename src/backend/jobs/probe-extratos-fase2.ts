import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * Fase 2 da sonda de EXTRATOS (Frente IV, Módulo 1) — READ-ONLY.
 *
 * A fase 1 (`probe-fin134.ts`) descobriu os filtros obrigatórios de cada tela:
 *   fin133 → sem filtro; devolve as CONTAS financeiras (`gerNum` + `gerDes`).
 *            `gerNum` é a "Conta Financeira de Baixa" do fin014 (print do docx: 38).
 *   fin095 → exige `gerNum`          (Extrato Banco)
 *   fin091 → exige `gerNumCcorentes` (Extrato Sistema)
 *   fin135 → exige `gerNum`          (Conciliações Geradas)
 *   fin134 → exige `vldStatus`       (Importação de Extratos Bancários)
 *
 * Esta fase preenche esses filtros com valores reais e captura o SHAPE das
 * linhas — o objetivo é decidir qual tela devolve LANÇAMENTOS de extrato
 * (candidatos a `TransacaoBancaria`) e com quais campos.
 *
 * Run: PROBE_ALLOW_PRD=1 npx tsx jobs/probe-extratos-fase2.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(`RECUSADO: base é PRODUÇÃO (${BASE}). Use PROBE_ALLOW_PRD=1.`);
    process.exit(1);
}

const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-extratos2';
const FIL_COD = Number(process.env.FIL ?? 2);

const log = (s: string, v?: unknown) =>
    console.log(`[extratos2] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 700) : '');

const salvar = (nome: string, payload: unknown): void =>
    writeFileSync(`${OUT_DIR}/${nome}.json`, JSON.stringify(payload, null, 2));

const linhasDe = (resp: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(resp)) return resp as Array<Record<string, unknown>>;
    const e = resp as {
        rows?: Array<Record<string, unknown>>;
        list?: Array<Record<string, unknown>>;
    };
    return e?.rows ?? e?.list ?? [];
};

const corpoDoErro = (e: unknown): unknown => {
    let atual: unknown = e;
    for (let i = 0; i < 5 && atual; i++) {
        const r = (atual as { response?: { data?: unknown } })?.response?.data;
        if (r !== undefined) return r;
        atual = (atual as { cause?: unknown })?.cause;
    }
    return undefined;
};

const resumirShape = (rows: Array<Record<string, unknown>>): Record<string, unknown> => {
    const chaves = new Set<string>();
    for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) chaves.add(k);
    const exemplo: Record<string, unknown> = {};
    for (const k of chaves) {
        const achado = rows.find((r) => r[k] !== null && r[k] !== undefined && r[k] !== '');
        exemplo[k] = achado ? achado[k] : null;
    }
    return { totalColunas: chaves.size, colunas: [...chaves].sort(), exemploPorColuna: exemplo };
};

/** Tenta uma tentativa nomeada; salva shape+amostra ou o corpo do erro. */
async function tentar(
    base: ConexosBaseClient,
    nome: string,
    endpoint: string,
    filterList: Record<string, unknown>,
    serviceName: string,
): Promise<number> {
    try {
        const resp = await base.postGeneric<unknown>(
            endpoint,
            { fieldList: [], filterList, serviceName, pageNumber: 1, pageSize: 30 },
            { filCod: FIL_COD },
        );
        const rows = linhasDe(resp);
        log(`${nome} → ${rows.length} linhas`);
        if (rows.length > 0) {
            const shape = resumirShape(rows);
            salvar(`${nome}-shape`, shape);
            salvar(`${nome}-amostra`, rows.slice(0, 8));
            log('   colunas:', shape.colunas);
        } else {
            salvar(`${nome}-envelope`, resp);
        }
        return rows.length;
    } catch (e) {
        const corpo = corpoDoErro(e);
        log(`${nome} ERRO`, corpo ?? (e instanceof Error ? e.message : String(e)));
        salvar(`${nome}-erro`, { endpoint, filterList, corpo });
        return -1;
    }
}

async function main(): Promise<void> {
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    log(`login OK · base=${BASE} · filCod=${FIL_COD} · out=${OUT_DIR}`);

    // 1) Contas financeiras da filial (fin133) — a chave `gerNum` de tudo abaixo.
    const contasResp = await base.postGeneric<unknown>(
        'fin133/list',
        { fieldList: [], filterList: {}, serviceName: 'fin133', pageNumber: 1, pageSize: 100 },
        { filCod: FIL_COD },
    );
    const contas = linhasDe(contasResp);
    salvar('fin133-contas', contas);
    // Prioriza contas com movimento (qtdeSistema/qtdeBanco > 0) — as vazias não
    // ensinam nada sobre o shape do lançamento.
    const comMovimento = contas
        .filter((c) => Number(c.qtdeSistema ?? 0) > 0 || Number(c.qtdeBanco ?? 0) > 0)
        .sort((a, b) => Number(b.qtdeBanco ?? 0) - Number(a.qtdeBanco ?? 0));
    log(
        `fin133: ${contas.length} contas, ${comMovimento.length} com movimento`,
        comMovimento.map(
            (c) => `${c.gerNum}:${c.gerDes} (sist ${c.qtdeSistema}/banco ${c.qtdeBanco})`,
        ),
    );

    // 2) Extratos por conta. `gerNum` é numérico no fin133; o filtro pode exigir
    //    o valor cru ou o operador `#EQ` — tenta as duas formas na 1ª conta.
    for (const conta of comMovimento.slice(0, 2)) {
        const gerNum = Number(conta.gerNum);
        const tag = `ger${gerNum}`;

        await tentar(base, `fin095-${tag}-plain`, 'fin095/list', { gerNum }, 'fin095');
        await tentar(base, `fin095-${tag}-eq`, 'fin095/list', { 'gerNum#EQ': gerNum }, 'fin095');
        await tentar(
            base,
            `fin091-${tag}`,
            'fin091/list',
            { gerNumCcorentes: gerNum, gerNum },
            'fin091',
        );
        await tentar(base, `fin135-${tag}`, 'fin135/list', { gerNum }, 'fin135');
    }

    // 3) fin134 — filtros capturados da URL real da tela (print do Yuri, PRD):
    //    ?sortBy=feaCod&orderBy=desc&vldStatus!EQ=1&vldTodosArq!EQ=0
    //     &vldTodasFiliais!EQ=0&vldSit!EQ=1
    //    vldStatus=1 → "PROCESSADO COM SUCESSO"; vldSit=1 → lote "FINALIZADO".
    //    Na URL o operador é `!EQ`; no body o repo usa `#` (ver listProcessos:
    //    `'priVldStatus#IN'`). Tenta as duas grafias.
    const filtrosFin134 = {
        vldStatus: 1,
        vldTodosArq: 0,
        vldTodasFiliais: 0,
        vldSit: 1,
    };
    const n = await tentar(base, 'fin134-real', 'fin134/list', filtrosFin134, 'fin134');
    if (n <= 0) {
        await tentar(
            base,
            'fin134-real-hash',
            'fin134/list',
            {
                'vldStatus#EQ': 1,
                'vldTodosArq#EQ': 0,
                'vldTodasFiliais#EQ': 0,
                'vldSit#EQ': 1,
            },
            'fin134',
        );
    }

    // 4) O grid do fin134 são ARQUIVOS (`EXT_341_0641_55795_30072600.RET`), não
    //    lançamentos — a coluna "Cód. Importação" é `feaCod` (sortBy da URL).
    //    Procura o endpoint de DETALHE que abre um arquivo em lançamentos.
    //    Padrão conhecido do irmão: `fin143/detalhes/list` (probe do SISPAG).
    const arquivos = linhasDe(
        await base
            .postGeneric<unknown>(
                'fin134/list',
                {
                    fieldList: [],
                    filterList: filtrosFin134,
                    serviceName: 'fin134',
                    pageNumber: 1,
                    pageSize: 5,
                    sortBy: 'feaCod',
                    orderBy: 'desc',
                },
                { filCod: FIL_COD },
            )
            .catch(() => ({})),
    );
    const feaCod = arquivos[0]?.feaCod ?? arquivos[0]?.FEACOD;
    log(`fin134: 1º arquivo feaCod=${String(feaCod)}`, arquivos[0]);

    if (feaCod !== undefined) {
        for (const path of [
            `fin134/detalhes/list`,
            `fin134/detalhe/list`,
            `fin134/lancamentos/list`,
            `fin134/itens/list`,
            `fin134/detalhes/list/${feaCod}`,
        ]) {
            await tentar(base, `detalhe-${path.replace(/\//g, '_')}`, path, { feaCod }, 'fin134');
        }
    }

    log('fim.');
}

main().catch((e) => {
    console.error('[extratos2] FALHOU:', e);
    process.exit(1);
});

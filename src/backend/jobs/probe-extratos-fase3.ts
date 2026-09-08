import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';

/**
 * Fase 3 da sonda de EXTRATOS (Frente IV) — READ-ONLY. Fecha as duas perguntas
 * que faltam para desenhar a fatia "listar créditos + processos atrelados":
 *
 *  A) `fin095/list` aceita filtro por TIPO (crédito) e por DATA? Sem isso a
 *     listagem puxa o extrato inteiro da conta a cada request.
 *     (fase 2: `exiVldTipo` 1=débito, 2=crédito; `exiDtaLcto` epoch ms.)
 *  B) `imp021/list` aceita filtro por `pesCod`? É como listaremos os processos
 *     ATRELADOS ao cliente de um crédito (hoje o ProcessoProviderStub faz match
 *     frouxo por nome). `ConexosCadastroClient.listProcessos` só expõe
 *     filCod/priCods — a tela documenta `{ label: "Cód. Pessoa", field: pesCod }`.
 *
 * Run: PROBE_ALLOW_PRD=1 tsx jobs/probe-extratos-fase3.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_ALLOW_PRD !== '1') {
    console.error(`RECUSADO: base é PRODUÇÃO (${BASE}). Use PROBE_ALLOW_PRD=1.`);
    process.exit(1);
}

const OUT_DIR = process.env.OUT_DIR ?? '/tmp/probe-extratos3';
const FIL_COD = Number(process.env.FIL ?? 1);
const GER_NUM = Number(process.env.GER ?? 38);

const log = (s: string, v?: unknown) =>
    console.log(`[ext3] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 500) : '');
const salvar = (n: string, p: unknown) =>
    writeFileSync(`${OUT_DIR}/${n}.json`, JSON.stringify(p, null, 2));

const envelopeDe = (resp: unknown): { rows: Array<Record<string, unknown>>; count?: number } => {
    if (Array.isArray(resp)) return { rows: resp as Array<Record<string, unknown>> };
    const e = resp as {
        rows?: Array<Record<string, unknown>>;
        list?: Array<Record<string, unknown>>;
        count?: number;
    };
    return { rows: e?.rows ?? e?.list ?? [], count: e?.count };
};

const corpoDoErro = (e: unknown): unknown => {
    let a: unknown = e;
    for (let i = 0; i < 5 && a; i++) {
        const r = (a as { response?: { data?: unknown } })?.response?.data;
        if (r !== undefined) return r;
        a = (a as { cause?: unknown })?.cause;
    }
    return undefined;
};

async function tentar(
    base: ConexosBaseClient,
    nome: string,
    endpoint: string,
    filterList: Record<string, unknown>,
    serviceName: string,
    extra: Record<string, unknown> = {},
): Promise<Array<Record<string, unknown>>> {
    try {
        const resp = await base.postGeneric<unknown>(
            endpoint,
            { fieldList: [], filterList, serviceName, pageNumber: 1, pageSize: 50, ...extra },
            { filCod: FIL_COD },
        );
        // Chaves de topo do envelope CRU: `paginate` (via listGenericPaginated) só lê
        // `.rows`. Se algum endpoint devolver `.list`, o paginate retorna [] SEM erro e
        // a ingestão grava zero reportando sucesso. Registrar é o guard barato.
        const chavesEnvelope = Array.isArray(resp) ? ['<array>'] : Object.keys(resp ?? {});
        const { rows, count } = envelopeDe(resp);
        log(
            `${nome} → ${rows.length} linhas (count=${count ?? '?'}) envelope=${chavesEnvelope.join(',')}`,
        );
        salvar(`${nome}`, { filterList, count, chavesEnvelope, amostra: rows.slice(0, 6) });
        return rows;
    } catch (e) {
        log(`${nome} ERRO`, corpoDoErro(e) ?? (e instanceof Error ? e.message : String(e)));
        salvar(`${nome}-erro`, { endpoint, filterList, corpo: corpoDoErro(e) });
        return [];
    }
}

async function main(): Promise<void> {
    mkdirSync(OUT_DIR, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    log(`login OK · filCod=${FIL_COD} · gerNum=${GER_NUM}`);

    // ---- A) fin095: baseline, tipo e data -------------------------------
    const baseline = await tentar(
        base,
        'A0-baseline',
        'fin095/list',
        { gerNum: GER_NUM },
        'fin095',
    );

    // Só crédito. Testa as duas grafias de operador (`#EQ` no body vs valor cru).
    await tentar(
        base,
        'A1-credito-plain',
        'fin095/list',
        { gerNum: GER_NUM, exiVldTipo: 2 },
        'fin095',
    );
    await tentar(
        base,
        'A2-credito-eq',
        'fin095/list',
        { gerNum: GER_NUM, 'exiVldTipo#EQ': 2 },
        'fin095',
    );

    // Janela de data. O fin091 exige `fLcbDtaLctoI` (data inicial) — testa se o
    // fin095 aceita o mesmo par, e também o campo cru com operadores de range.
    const dias = Number(process.env.DIAS ?? 90);
    const ate = Date.now();
    const de = ate - dias * 24 * 60 * 60 * 1000;
    await tentar(
        base,
        'A3-data-fLcb',
        'fin095/list',
        { gerNum: GER_NUM, fLcbDtaLctoI: de, fLcbDtaLctoF: ate },
        'fin095',
    );
    await tentar(
        base,
        'A4-data-range',
        'fin095/list',
        { gerNum: GER_NUM, 'exiDtaLcto#GE': de, 'exiDtaLcto#LE': ate },
        'fin095',
    );

    // Ligação com o arquivo do fin134 (`feaCod`).
    const comFea = baseline.find((r) => r.feaCod !== null && r.feaCod !== undefined);
    if (comFea) {
        await tentar(
            base,
            'A5-por-feaCod',
            'fin095/list',
            { gerNum: GER_NUM, feaCod: comFea.feaCod },
            'fin095',
        );
    } else {
        log(
            'A5: nenhuma linha do baseline traz feaCod (todas null) — ligação fin134↔fin095 não confirmada.',
        );
    }

    // ---- B) imp021 por pesCod -------------------------------------------
    // Pega um pesCod real da própria base de processos da filial.
    const procs = await tentar(
        base,
        'B0-processos-abertos',
        'imp021/list',
        { 'priVldStatus#IN': ['1'] },
        'imp021',
        {
            fieldList: [
                'priCod',
                'pesCod',
                'priEspRefcliente',
                'priVldTipo',
                'dpeNomPessoa',
                'priDtaAbertura',
                'filCod',
            ],
        },
    );
    const pesCod = procs.find((p) => p.pesCod)?.pesCod;
    log(`B: pesCod de amostra = ${String(pesCod)}`);

    if (pesCod !== undefined) {
        await tentar(
            base,
            'B1-por-pesCod-plain',
            'imp021/list',
            { pesCod, 'priVldStatus#IN': ['1'] },
            'imp021',
            { fieldList: ['priCod', 'pesCod', 'priEspRefcliente', 'dpeNomPessoa', 'filCod'] },
        );
        await tentar(
            base,
            'B2-por-pesCod-in',
            'imp021/list',
            { 'pesCod#IN': [String(pesCod)], 'priVldStatus#IN': ['1'] },
            'imp021',
            { fieldList: ['priCod', 'pesCod', 'priEspRefcliente', 'dpeNomPessoa', 'filCod'] },
        );
    }

    // O filtro de status usado hoje é `priVldStatus#IN:['1']`, mas a ficha da
    // tela anota "ABERTO → priVldStatus!IN=1" (NOT in 1). Compara os dois.
    await tentar(
        base,
        'B3-status-NOTin1',
        'imp021/list',
        { 'priVldStatus#NOTIN': ['1'] },
        'imp021',
        { fieldList: ['priCod', 'pesCod', 'priEspRefcliente', 'dpeNomPessoa', 'filCod'] },
    );

    log('fim.');
}

main().catch((e) => {
    console.error('[ext3] FALHOU:', e);
    process.exit(1);
});

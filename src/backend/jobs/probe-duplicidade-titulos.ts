import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';
import { redactErrorMessage } from '../domain/libs/redact/redactErrorMessage.js';

/**
 * SONDA READ-ONLY — a mesma dívida aparece como DOIS títulos a pagar no `fin064`?
 *
 * A ingestão do SISPAG identifica título por (filCod, docCod, titCod): ler o fin064 duas vezes
 * não duplica nada. O risco é de NEGÓCIO: a mesma NF lançada duas vezes no Conexos, ou NF +
 * fatura/duplicata da mesma compra, vira dois `docCod` distintos — dois títulos elegíveis.
 *
 * Sinais (sempre com docCod DISTINTOS — parcelas do mesmo documento compartilham docCod e são
 * legítimas):
 *   S1 forte   — mesmo favorecido + mesmo número de documento normalizado (docEspNumero).
 *   S2 médio   — mesmo favorecido + mesmo valor + mesmo vencimento.
 *   S3 NF×fatura — mesmo favorecido + mesmo valor, TIPOS de documento diferentes, vencimentos
 *                  a ≤45 dias.
 *
 * SEGURANÇA: só `fin064/list` (leitura). Não usa `bootstrapAppContainer()`. Saída local.
 *
 * Run:
 *   cd src/backend && PROBE_PRD=1 databaseConnectionString="" npx tsx jobs/probe-duplicidade-titulos.ts
 * Env: PROBE_DIAS_ATRAS (default 180) · PROBE_DIAS_FRENTE (default 90) · PROBE_OUT
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/duplicidade-titulos';
const DIAS_ATRAS = Number(process.env.PROBE_DIAS_ATRAS ?? 180);
const DIAS_FRENTE = Number(process.env.PROBE_DIAS_FRENTE ?? 90);
const DIA = 86_400_000;

type Row = Record<string, unknown>;

interface Titulo {
    filCod: number;
    docCod: string;
    titCod: string;
    docTip: string;
    docVldTipo: string;
    tpdCod: string;
    tipo: string;
    numero: string;
    numeroNorm: string;
    titEspNumero: string;
    cobrNdup: string;
    favorecido: string;
    nome: string;
    valor: number;
    vencimento: number;
    emissao: number;
    pago: boolean;
    liberado: boolean;
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const flag = (v: unknown): boolean => v === 1 || v === '1' || v === true;
const norm = (v: string): string => v.replace(/\D/g, '').replace(/^0+/, '');
const dia = (ms: number): string => (ms ? new Date(ms).toISOString().slice(0, 10) : '-');

async function conectar(): Promise<ConexosBaseClient> {
    await container.resolve(EnvironmentProvider).getEnvironmentVars();
    const resolver = container.resolve(ConexosSessionResolver);
    container.register(LEGACY_CONEXOS_TOKEN, {
        useValue: buildLegacyConexosAdapter(() => resolver.resolve()),
    });
    const base = container.resolve(ConexosBaseClient);
    await base.ensureSid();
    return base;
}

async function lerFilial(base: ConexosBaseClient, filCod: number): Promise<Titulo[]> {
    const agora = Date.now();
    const res = await base.runWithRetry(() =>
        base.listGenericPaginated<Row>(
            'fin064/list',
            {
                fieldList: [],
                filterList: {
                    'docVldPrevisao#EQ': 0,
                    'titDtaVencimento#GE': agora - DIAS_ATRAS * DIA,
                    'titDtaVencimento#LE': agora + DIAS_FRENTE * DIA,
                },
                serviceName: 'fin064',
                pageNumber: 1,
                pageSize: 1000,
            },
            { filCod },
        ),
    );
    return res.rows.map((r) => {
        const numero = s(r.docEspNumero);
        return {
            filCod,
            docCod: s(r.docCod),
            titCod: s(r.titCod),
            docTip: s(r.docTip),
            docVldTipo: s(r.docVldTipo),
            tpdCod: s(r.tpdCod),
            tipo: `docTip=${s(r.docTip)}/vldTipo=${s(r.docVldTipo)}/tpd=${s(r.tpdCod)}`,
            numero,
            numeroNorm: norm(numero),
            titEspNumero: s(r.titEspNumero),
            cobrNdup: s(r.cobrNdup),
            favorecido: s(r.pesCodFor) || s(r.pesCod),
            nome: s(r.dpeNomPessoaFor) || s(r.dpeNomPessoa),
            valor: Math.round(n(r.titMnyValor) * 100) / 100,
            vencimento: n(r.titDtaVencimento),
            emissao: n(r.docDtaEmissao),
            pago: flag(r.vldPago),
            liberado: flag(r.vldLib),
        };
    });
}

/** Grupos com ≥2 docCod distintos. */
function agrupar(ts: Titulo[], chave: (t: Titulo) => string | null): Titulo[][] {
    const m = new Map<string, Titulo[]>();
    for (const t of ts) {
        const k = chave(t);
        if (!k) continue;
        const g = m.get(k) ?? [];
        g.push(t);
        m.set(k, g);
    }
    return [...m.values()].filter((g) => new Set(g.map((t) => `${t.filCod}|${t.docCod}`)).size > 1);
}

/** S3: pares favorecido+valor com tipos diferentes e vencimentos a ≤45 dias. */
function nfVsFatura(ts: Titulo[]): Titulo[][] {
    const out: Titulo[][] = [];
    for (const g of agrupar(ts, (t) =>
        t.favorecido && t.valor > 0 ? `${t.favorecido}|${t.valor}` : null,
    )) {
        const pares: Titulo[] = [];
        for (let i = 0; i < g.length; i++) {
            for (let j = i + 1; j < g.length; j++) {
                const a = g[i];
                const b = g[j];
                if (!a || !b || a.docCod === b.docCod) continue;
                if (a.tipo === b.tipo) continue;
                if (Math.abs(a.vencimento - b.vencimento) > 45 * DIA) continue;
                for (const t of [a, b]) if (!pares.includes(t)) pares.push(t);
            }
        }
        if (pares.length) out.push(pares);
    }
    return out;
}

function resumo(nome: string, grupos: Titulo[][]) {
    const risco = grupos.filter((g) => g.some((t) => !t.pago));
    const ambosAbertos = grupos.filter((g) => g.filter((t) => !t.pago).length > 1);
    const umPagoOutroAberto = grupos.filter((g) => g.some((t) => t.pago) && g.some((t) => !t.pago));
    const ambosPagos = grupos.filter((g) => g.every((t) => t.pago));
    const pares = new Map<string, number>();
    for (const g of grupos) {
        const k = [...new Set(g.map((t) => t.tipo))].sort().join(' + ');
        pares.set(k, (pares.get(k) ?? 0) + 1);
    }
    return {
        sinal: nome,
        grupos: grupos.length,
        comAlgumAberto: risco.length,
        doisOuMaisAbertos: ambosAbertos.length,
        umPagoOutroAberto: umPagoOutroAberto.length,
        todosPagos: ambosPagos.length,
        valorAbertoEmGrupos: Math.round(
            risco.reduce(
                (acc, g) => acc + g.filter((t) => !t.pago).reduce((a, t) => a + t.valor, 0),
                0,
            ),
        ),
        combinacoesDeTipo: Object.fromEntries([...pares.entries()].sort((a, b) => b[1] - a[1])),
    };
}

const linha = (t: Titulo): string =>
    [
        `fil=${t.filCod}`,
        `doc=${t.docCod}/${t.titCod}`,
        t.tipo,
        `num=${t.numero || '-'}`,
        `titNum=${t.titEspNumero || '-'}`,
        `dup=${t.cobrNdup || '-'}`,
        `R$ ${t.valor.toFixed(2)}`,
        `venc=${dia(t.vencimento)}`,
        `emis=${dia(t.emissao)}`,
        t.pago ? 'PAGO' : 'ABERTO',
        t.liberado ? 'liberado' : 'não-liberado',
    ].join(' | ');

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    const base = await conectar();
    const filiais = (await base.getFiliais()).map((f) => Number((f as { filCod: unknown }).filCod));
    const todos: Titulo[] = [];
    const porFilial: Record<string, number | string> = {};
    for (const filCod of filiais) {
        try {
            const ts = await lerFilial(base, filCod);
            porFilial[filCod] = ts.length;
            todos.push(...ts);
        } catch (err) {
            porFilial[filCod] = `ERRO: ${(err as Error).message}`;
        }
    }

    const tipos = new Map<string, number>();
    for (const t of todos) tipos.set(t.tipo, (tipos.get(t.tipo) ?? 0) + 1);

    const s1 = agrupar(todos, (t) =>
        t.favorecido && t.numeroNorm ? `${t.favorecido}|${t.numeroNorm}` : null,
    );
    const s2 = agrupar(todos, (t) =>
        t.favorecido && t.valor > 0 && t.vencimento
            ? `${t.favorecido}|${t.valor}|${dia(t.vencimento)}`
            : null,
    );
    const s3 = nfVsFatura(todos);

    const relatorio = {
        janela: {
            diasAtras: DIAS_ATRAS,
            diasFrente: DIAS_FRENTE,
            geradoEm: new Date().toISOString(),
        },
        porFilial,
        titulos: todos.length,
        documentos: new Set(todos.map((t) => `${t.filCod}|${t.docCod}`)).size,
        semFavorecido: todos.filter((t) => !t.favorecido).length,
        semNumeroDocumento: todos.filter((t) => !t.numeroNorm).length,
        tiposDeDocumento: Object.fromEntries([...tipos.entries()].sort((a, b) => b[1] - a[1])),
        sinais: [
            resumo('S1 mesmo favorecido + mesmo nº documento', s1),
            resumo('S2 mesmo favorecido + valor + vencimento', s2),
            resumo('S3 NF×fatura: favorecido + valor, tipos diferentes, venc ≤45d', s3),
        ],
    };
    writeFileSync(`${OUT}/resumo.json`, JSON.stringify(relatorio, null, 2));

    const detalhe: string[] = [];
    for (const [nome, grupos] of [
        ['S1', s1],
        ['S2', s2],
        ['S3', s3],
    ] as const) {
        detalhe.push(`===== ${nome}: ${grupos.length} grupos =====`);
        for (const g of grupos) {
            detalhe.push(`--- ${g[0]?.nome ?? '?'} (fav ${g[0]?.favorecido ?? '?'})`);
            for (const t of g) detalhe.push(`   ${linha(t)}`);
        }
    }
    writeFileSync(`${OUT}/grupos.txt`, detalhe.join('\n'));
    console.log(JSON.stringify(relatorio, null, 2));
    console.log(`detalhe em ${OUT}/grupos.txt`);
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(
            'sonda falhou:',
            redactErrorMessage(err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
    },
);

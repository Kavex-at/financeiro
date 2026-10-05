import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosExtratoClient, {
    EXI_VLD_TIPO,
    type LancamentoExtrato,
} from '../domain/client/ConexosExtratoClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';

/**
 * SONDA READ-ONLY — por qual CANAL cada fornecedor é pago? (boleto, TED/PIX, misto, outros)
 *
 * Pergunta de negócio: dá para ter uma regra por fornecedor ("fulano só recebe boleto")?
 *
 * Dois sinais independentes, cada um com sua taxa de cobertura:
 *   A. O que o TÍTULO diz (`fin064`, pago e aberto, janela PROBE_MESES): forma de pagamento
 *      declarada (`pgtDesNome`) e presença de código de barras (`titEspCodbar`). Pagina de
 *      verdade (o `listGenericPaginated` é página única — compara `count` × linhas).
 *   B. Como o dinheiro SAIU: baixa a pagar (`fin010`) casada com débito do extrato (`fin095`)
 *      por valor exato e data ±1,5 dia; canal lido do histórico do banco.
 *
 * Saída (PROBE_OUT): resumo.json (classes de fornecedor, cobertura dos sinais, vocabulário de
 * histórico/forma) e fornecedores.csv (uma linha por fornecedor).
 *
 * SEGURANÇA: só `/list`. Um login (pode derrubar a sessão menos usada do usuário do .env).
 *
 * Run:
 *   cd src/backend && PROBE_PRD=1 databaseConnectionString="" npx tsx jobs/probe-canal-por-fornecedor.ts
 * Env: PROBE_MESES (default 12) · PROBE_FILIAIS (default: todas) · MAX_BORDEROS (default 400
 *      por filial) · PROBE_OUT
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/canal-por-fornecedor';
const MESES = Number(process.env.PROBE_MESES ?? 12);
const MAX_BORDEROS = Number(process.env.MAX_BORDEROS ?? 400);
const DIA = 86_400_000;

type Row = Record<string, unknown>;
type Canal = 'BOLETO' | 'TED' | 'PIX' | 'SISPAG_INDEFINIDO' | 'TRIBUTO' | 'OUTROS' | 'SEM_DEBITO';

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const log = (m: string): void => console.log(m);

/** Canal pelo histórico do extrato. Ordem importa: o primeiro que casar vence. */
const REGRAS: Array<[Canal, RegExp]> = [
    ['PIX', /\bPIX\b/],
    ['TED', /\bTED\b|\bDOC\b|TRANSF|\bTEF\b/],
    ['BOLETO', /BOLETO|\bTIT(ULO)?S?\b|COBRAN|PAG(TO)? ?TIT|\bBLQ\b|CODIGO DE BARRAS/],
    ['TRIBUTO', /DARF|\bGPS\b|FGTS|GARE|GNRE|\bDAS\b|TRIBUT|IMPOSTO|SEFAZ|RECEITA FED/],
    ['SISPAG_INDEFINIDO', /\bSISPAG\b/],
];
const canalDoHistorico = (h?: string): Canal => {
    const t = (h ?? '').toUpperCase();
    for (const [c, re] of REGRAS) if (re.test(t)) return c;
    return 'OUTROS';
};

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

/** Pagina de verdade até esgotar `count`. */
async function todasPaginas(
    base: ConexosBaseClient,
    servico: string,
    filterList: Row,
    filCod: number,
): Promise<Row[]> {
    const out: Row[] = [];
    for (let pagina = 1; pagina <= 200; pagina++) {
        const res = await base.runWithRetry(() =>
            base.listGenericPaginated<Row>(
                `${servico}/list`,
                {
                    fieldList: [],
                    filterList,
                    serviceName: servico,
                    pageNumber: pagina,
                    pageSize: 1000,
                },
                { filCod },
            ),
        );
        out.push(...res.rows);
        if (res.rows.length === 0 || out.length >= res.count) break;
    }
    return out;
}

interface Fornecedor {
    chave: string;
    nome: string;
    titulos: number;
    comCodbar: number;
    formas: Record<string, number>;
    baixas: number;
    valorPago: number;
    canais: Partial<Record<Canal, number>>;
}

const fornecedores = new Map<string, Fornecedor>();
const fornecedor = (chave: string, nome: string): Fornecedor => {
    let f = fornecedores.get(chave);
    if (!f) {
        f = {
            chave,
            nome,
            titulos: 0,
            comCodbar: 0,
            formas: {},
            baixas: 0,
            valorPago: 0,
            canais: {},
        };
        fornecedores.set(chave, f);
    }
    if (!f.nome && nome) f.nome = nome;
    return f;
};
const chaveNome = (nome: string): string => `nome:${nome.toUpperCase().replace(/\s+/g, ' ')}`;

// ── A: títulos ──────────────────────────────────────────────────────────────
interface SinalTitulos {
    total: number;
    comForma: number;
    comCodbar: number;
    formas: Record<string, number>;
}

async function sinalTitulos(
    base: ConexosBaseClient,
    filiais: number[],
    de: number,
): Promise<SinalTitulos> {
    let total = 0;
    let comForma = 0;
    let comCodbar = 0;
    const formas: Record<string, number> = {};
    for (const filCod of filiais) {
        try {
            const rows = await todasPaginas(
                base,
                'fin064',
                { 'docVldPrevisao#EQ': 0, 'titDtaVencimento#GE': de },
                filCod,
            );
            log(`fin064 fil=${filCod}: ${rows.length} títulos`);
            for (const r of rows) {
                const nome = s(r.dpeNomPessoaFor) || s(r.dpeNomPessoa);
                if (!nome) continue;
                const f = fornecedor(chaveNome(nome), nome);
                const forma = s(r.pgtDesNome);
                const codbar = s(r.titEspCodbar);
                f.titulos++;
                total++;
                if (forma) {
                    comForma++;
                    f.formas[forma] = (f.formas[forma] ?? 0) + 1;
                    formas[forma] = (formas[forma] ?? 0) + 1;
                }
                if (codbar) {
                    comCodbar++;
                    f.comCodbar++;
                }
            }
        } catch (e) {
            log(`fin064 fil=${filCod}: FALHOU (${(e as Error).message})`);
        }
    }
    return { total, comForma, comCodbar, formas };
}

// ── B: baixas × extrato ─────────────────────────────────────────────────────
async function lerDebitos(filiais: number[], de: Date, ate: Date): Promise<LancamentoExtrato[]> {
    const extrato = container.resolve(ConexosExtratoClient);
    const contas = new Map<number, number>();
    for (const filCod of filiais) {
        try {
            for (const c of await extrato.listContas(filCod)) {
                if (!contas.has(c.gerNum) && (c.qtdeBanco ?? 1) > 0) contas.set(c.gerNum, filCod);
            }
        } catch (e) {
            log(`fin133 fil=${filCod}: FALHOU (${(e as Error).message})`);
        }
    }
    const debitos: LancamentoExtrato[] = [];
    for (const [gerNum, filCod] of contas) {
        for (let ini = de.getTime(); ini < ate.getTime(); ini += 30 * DIA + 1) {
            const fim = Math.min(ini + 30 * DIA, ate.getTime());
            try {
                debitos.push(
                    ...(await extrato.listLancamentos({
                        filCod,
                        gerNum,
                        de: new Date(ini),
                        ate: new Date(fim),
                        exiVldTipo: EXI_VLD_TIPO.DEBITO,
                    })),
                );
            } catch (e) {
                log(`fin095 conta ${gerNum}: FALHOU (${(e as Error).message})`);
            }
        }
    }
    log(`${contas.size} contas, ${debitos.length} débitos no extrato`);
    return debitos;
}

interface Baixa {
    nome: string;
    valor: number;
    data: number;
}

async function lerBaixas(base: ConexosBaseClient, filiais: number[], de: number): Promise<Baixa[]> {
    const baixas: Baixa[] = [];
    for (const filCod of filiais) {
        let borderos: Row[] = [];
        try {
            const page = await base.runWithRetry(() =>
                base.listGenericPaginated<Row>(
                    'fin010/list',
                    {
                        fieldList: [],
                        filterList: { 'borVldTipo#EQ': 2, 'borVldFinalizado#EQ': 1 },
                        serviceName: 'fin010',
                        pageNumber: 1,
                        pageSize: MAX_BORDEROS,
                        orderList: { orderList: [{ propertyName: 'borDtaMvto', order: 'desc' }] },
                    },
                    { filCod },
                ),
            );
            borderos = page.rows.filter((b) => Number(b.borDtaMvto) >= de);
            if (page.rows.length === MAX_BORDEROS) {
                log(
                    `fin010 fil=${filCod}: bateu o teto de ${MAX_BORDEROS} borderôs — janela encurtada`,
                );
            }
        } catch (e) {
            log(`fin010 fil=${filCod}: FALHOU (${(e as Error).message})`);
            continue;
        }
        for (const b of borderos) {
            try {
                const page = await base.runWithRetry(() =>
                    base.listGenericPaginated<Row>(
                        `fin010/baixas/list/${s(b.borCod)}`,
                        { fieldList: [], filterList: {}, pageNumber: 1, pageSize: 500 },
                        { filCod },
                    ),
                );
                for (const r of page.rows) {
                    if (Number(r.vldPermuta ?? 0) === 1 || s(r.gerNumPermuta)) continue;
                    baixas.push({
                        nome: s(r.dpeNomPessoa) || s(r.dpeNomPessoaDocumento),
                        valor: Math.abs(Number(r.bxaMnyLiquido ?? r.bxaMnyValor ?? 0)),
                        data: Number(r.lcbDtaCompensado ?? r.borDtaMvto ?? b.borDtaMvto ?? 0),
                    });
                }
            } catch (e) {
                log(`fin010 bor=${s(b.borCod)}: FALHOU (${(e as Error).message})`);
            }
        }
        log(`fin010 fil=${filCod}: ${borderos.length} borderôs na janela`);
    }
    return baixas;
}

function cruzar(baixas: Baixa[], debitos: LancamentoExtrato[]): Record<string, number> {
    const porValor = new Map<string, LancamentoExtrato[]>();
    for (const d of debitos) {
        const k = d.valor.toFixed(2);
        porValor.set(k, [...(porValor.get(k) ?? []), d]);
    }
    const usados = new Set<LancamentoExtrato>();
    const vocabulario: Record<string, number> = {};
    for (const b of baixas) {
        if (!b.nome || b.valor <= 0) continue;
        const achado = (porValor.get(b.valor.toFixed(2)) ?? []).find(
            (d) => !usados.has(d) && Math.abs(d.dataLancamento.getTime() - b.data) <= 1.5 * DIA,
        );
        let canal: Canal = 'SEM_DEBITO';
        if (achado) {
            usados.add(achado);
            canal = canalDoHistorico(achado.historico);
            const palavras = (achado.historico ?? '')
                .toUpperCase()
                .split(/\s+/)
                .slice(0, 2)
                .join(' ');
            const k = `${canal} | ${palavras}`;
            vocabulario[k] = (vocabulario[k] ?? 0) + 1;
        }
        const f = fornecedor(chaveNome(b.nome), b.nome);
        f.baixas++;
        f.valorPago += b.valor;
        f.canais[canal] = (f.canais[canal] ?? 0) + 1;
    }
    return vocabulario;
}

/** Classe do fornecedor pelo canal REAL (sinal B), ignorando baixas sem débito casado. */
function classe(f: Fornecedor): string {
    const c = f.canais;
    const boleto = c.BOLETO ?? 0;
    const tedPix = (c.TED ?? 0) + (c.PIX ?? 0);
    const outros = (c.TRIBUTO ?? 0) + (c.OUTROS ?? 0);
    const indef = c.SISPAG_INDEFINIDO ?? 0;
    if (boleto + tedPix + outros + indef === 0)
        return f.baixas ? 'SEM_DEBITO_CASADO' : 'SEM_PAGAMENTO';
    if (indef > 0 && boleto + tedPix === 0) return 'SO_SISPAG_INDEFINIDO';
    if (boleto > 0 && tedPix === 0 && outros === 0) return 'SO_BOLETO';
    if (tedPix > 0 && boleto === 0 && outros === 0) return 'SO_TED_PIX';
    if (boleto === 0 && tedPix === 0) return 'SO_OUTROS';
    return 'MISTO';
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    const base = await conectar();
    const ate = new Date();
    const de = new Date(ate.getTime() - MESES * 30 * DIA);
    const filiais = process.env.PROBE_FILIAIS
        ? process.env.PROBE_FILIAIS.split(',').map(Number)
        : (await base.getFiliais()).map((f) => Number((f as { filCod: unknown }).filCod));

    log(`── A: títulos (fin064) desde ${de.toISOString().slice(0, 10)} ──`);
    const titulos = await sinalTitulos(base, filiais, de.getTime());
    log('── B: baixas (fin010) × extrato (fin095) ──');
    const debitos = await lerDebitos(filiais, de, ate);
    const baixas = await lerBaixas(base, filiais, de.getTime());
    const vocabulario = cruzar(baixas, debitos);

    const classes: Record<string, { fornecedores: number; baixas: number; valorPago: number }> = {};
    const linhas = ['classe;fornecedor;titulos;comCodbar;formas;baixas;valorPago;canais'];
    for (const f of fornecedores.values()) {
        const k = classe(f);
        const agg = classes[k] ?? { fornecedores: 0, baixas: 0, valorPago: 0 };
        agg.fornecedores++;
        agg.baixas += f.baixas;
        agg.valorPago = Math.round(agg.valorPago + f.valorPago);
        classes[k] = agg;
        linhas.push(
            [
                k,
                f.nome.replace(/;/g, ','),
                f.titulos,
                f.comCodbar,
                JSON.stringify(f.formas),
                f.baixas,
                f.valorPago.toFixed(2),
                JSON.stringify(f.canais),
            ].join(';'),
        );
    }
    const casadas = baixas.filter((b) => b.nome && b.valor > 0).length;
    const semDebito = [...fornecedores.values()].reduce(
        (a, f) => a + (f.canais.SEM_DEBITO ?? 0),
        0,
    );
    const resumo = {
        janela: { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10), filiais },
        sinalA_titulos: {
            ...titulos,
            coberturaForma: titulos.total
                ? Number((titulos.comForma / titulos.total).toFixed(3))
                : 0,
            coberturaCodbar: titulos.total
                ? Number((titulos.comCodbar / titulos.total).toFixed(3))
                : 0,
        },
        sinalB_pagamentos: {
            baixas: casadas,
            casadasComDebito: casadas - semDebito,
            cobertura: casadas ? Number(((casadas - semDebito) / casadas).toFixed(3)) : 0,
            debitosNoExtrato: debitos.length,
        },
        classesDeFornecedor: classes,
        vocabularioHistorico: Object.fromEntries(
            Object.entries(vocabulario)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 40),
        ),
    };
    writeFileSync(`${OUT}/resumo.json`, JSON.stringify(resumo, null, 2));
    writeFileSync(`${OUT}/fornecedores.csv`, linhas.join('\n'));
    console.log(JSON.stringify(resumo, null, 2));
    log(`detalhe por fornecedor em ${OUT}/fornecedores.csv`);
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(err);
        process.exit(1);
    },
);

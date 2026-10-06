import 'dotenv/config';
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient, { LEGACY_CONEXOS_TOKEN } from '../domain/client/ConexosBaseClient.js';
import ConexosSessionResolver from '../domain/client/ConexosSessionResolver.js';
import { buildLegacyConexosAdapter } from '../domain/client/legacyConexosAdapter.js';
import EnvironmentProvider from '../domain/libs/environment/EnvironmentProvider.js';

/**
 * SONDA READ-ONLY — existe TRIBUTO (ou concessionária) com código de barras no Conexos?
 *
 * Detector pelo PADRÃO do código, não pelo nome do campo: qualquer valor com 44, 47 ou 48 dígitos.
 *   - começa com 8 (44 ou 48 dígitos) → ARRECADAÇÃO (FEBRABAN): o 2º dígito é o segmento
 *     (1 prefeituras, 2 saneamento, 3 energia/gás, 4 telecom, 5 órgãos governamentais,
 *      6 carnês/demais, 7 multas de trânsito, 9 exclusivo do banco);
 *   - senão → BLOQUETO bancário (boleto).
 *
 * Fontes: fin064 (títulos, todos os campos, PROBE_MESES), fin124 (DDA), itens de lotes nativos
 * do fin015 (todo o histórico) e o grid de pendentes do fin015. Conta também os títulos de
 * favorecidos com cara de órgão público, para dizer se tributo existe mesmo sem código.
 *
 * Run:
 *   cd src/backend && PROBE_PRD=1 databaseConnectionString="" npx tsx jobs/probe-tributos-codbar.ts
 * Env: PROBE_MESES (default 12) · PROBE_BANCOS (default 3,4,7,10) · PROBE_DDA_ARQUIVOS (default 60
 *      mais recentes por filial) · PROBE_OUT
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/tributos-codbar';
const MESES = Number(process.env.PROBE_MESES ?? 12);
const BANCOS = (process.env.PROBE_BANCOS ?? '3,4,7,10').split(',').map(Number);
const DDA_ARQUIVOS = Number(process.env.PROBE_DDA_ARQUIVOS ?? 60);
const DIA = 86_400_000;

type Row = Record<string, unknown>;

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const log = (m: string): void => console.log(m);

const SEGMENTO: Record<string, string> = {
    '1': 'prefeituras',
    '2': 'saneamento',
    '3': 'energia/gás',
    '4': 'telecom',
    '5': 'órgãos governamentais',
    '6': 'carnês/demais',
    '7': 'multas de trânsito',
    '9': 'exclusivo do banco',
};
const ORGAO =
    /RECEITA FED|SECRETARIA DA FAZENDA|SEFAZ|PREFEITURA|MUNICIPIO|INSS|FGTS|CAIXA ECONOMICA|DETRAN|MINISTERIO|ESTADO D[EO]|UNIAO|TESOURO|ANTAQ|ANVISA|POLICIA FEDERAL|PROCURADORIA/;

interface Achado {
    fonte: string;
    campo: string;
    tipo: 'ARRECADACAO' | 'BOLETO';
    segmento?: string;
    favorecido: string;
    valor: string;
    ref: string;
}

const achados: Achado[] = [];
const contagem: Record<string, Record<string, number>> = {};
const conta = (fonte: string, k: string): void => {
    const c = contagem[fonte] ?? {};
    c[k] = (c[k] ?? 0) + 1;
    contagem[fonte] = c;
};

/** Varre todos os campos da linha procurando código de barras / linha digitável. */
function varrer(fonte: string, r: Row, favorecido: string, valor: unknown, ref: string): void {
    conta(fonte, 'linhas');
    for (const [campo, v] of Object.entries(r)) {
        if (typeof v !== 'string' && typeof v !== 'number') continue;
        const dig = String(v).replace(/\D/g, '');
        if (![44, 47, 48].includes(dig.length)) continue;
        if (String(v).replace(/[\d\s.-]/g, '').length > 0) continue; // texto com letras não é código
        const arrecadacao = dig.startsWith('8') && dig.length !== 47;
        const segmento = arrecadacao ? (SEGMENTO[dig[1] ?? ''] ?? `?${dig[1]}`) : undefined;
        conta(fonte, arrecadacao ? `ARRECADACAO ${segmento}` : 'BOLETO');
        if (arrecadacao || achados.filter((a) => a.fonte === fonte).length < 5) {
            achados.push({
                fonte,
                campo,
                tipo: arrecadacao ? 'ARRECADACAO' : 'BOLETO',
                segmento,
                favorecido,
                valor: s(valor),
                ref,
            });
        }
    }
}

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

async function paginas(
    base: ConexosBaseClient,
    path: string,
    servico: string,
    filterList: Row,
    filCod: number,
    pageSize = 1000,
    max = 200,
): Promise<Row[]> {
    const out: Row[] = [];
    for (let pagina = 1; pagina <= max; pagina++) {
        const res = await base.runWithRetry(() =>
            base.listGenericPaginated<Row>(
                path,
                { fieldList: [], filterList, serviceName: servico, pageNumber: pagina, pageSize },
                { filCod },
            ),
        );
        out.push(...res.rows);
        if (res.rows.length < pageSize || out.length >= res.count) break;
    }
    return out;
}

async function fin064(base: ConexosBaseClient, filCod: number): Promise<void> {
    const de = Date.now() - MESES * 30 * DIA;
    const rows = await paginas(
        base,
        'fin064/list',
        'fin064',
        { 'titDtaVencimento#GE': de },
        filCod,
    );
    for (const r of rows) {
        const fav = s(r.dpeNomPessoaFor) || s(r.dpeNomPessoa);
        if (ORGAO.test(fav.toUpperCase())) conta('fin064', 'titulos de órgão público');
        varrer('fin064', r, fav, r.titMnyValor, `fil ${filCod} doc ${s(r.docCod)}/${s(r.titCod)}`);
    }
    log(`fin064 fil=${filCod}: ${rows.length} títulos`);
}

async function dda(base: ConexosBaseClient, filCod: number): Promise<void> {
    const arquivos = (await paginas(base, 'fin124/list', 'fin124', {}, filCod, 500, 10))
        .filter((a) => s(a.ddcCod))
        .sort((a, b) => Number(b.ddcCod) - Number(a.ddcCod))
        .slice(0, DDA_ARQUIVOS);
    for (const a of arquivos) {
        const itens = await paginas(
            base,
            `fin124/itens/list/${s(a.ddcCod)}`,
            'fin124',
            {},
            filCod,
            500,
            20,
        );
        for (const i of itens) {
            varrer(
                'fin124 DDA',
                i,
                s(i.ditEspNomeCedente) || s(i.ditEspNome),
                i.ditMnyValor,
                `fil ${filCod} ddc ${s(a.ddcCod)}`,
            );
        }
    }
    log(`fin124 fil=${filCod}: ${arquivos.length} arquivos DDA`);
}

async function lotesNativos(base: ConexosBaseClient, filCod: number): Promise<void> {
    for (const bncCod of BANCOS) {
        let lotes: Row[] = [];
        try {
            lotes = await paginas(
                base,
                'fin015/list',
                'fin015',
                { 'bncCod#EQ': bncCod },
                filCod,
                500,
                20,
            );
        } catch {
            continue;
        }
        lotes = lotes.filter((l) => Number(l.bncCod ?? bncCod) === bncCod);
        let maiorFlp = 0;
        for (const l of lotes) {
            const flp = Number(l.flpCod);
            if (!flp) continue;
            maiorFlp = Math.max(maiorFlp, flp);
            const itens = await paginas(
                base,
                `fin015/finItemSispag/list/${filCod}/${bncCod}/${flp}`,
                'fin015',
                {},
                filCod,
                500,
                5,
            );
            for (const i of itens) {
                const mod = Number(i.itsVldModalidade ?? 0);
                conta('fin015 itens de lote', `modalidade ${mod || '?'}`);
                varrer(
                    'fin015 itens de lote',
                    i,
                    s(i.itsEspNomeFav),
                    i.itsMnyValor,
                    `fil ${filCod} bnc ${bncCod} flp ${flp}`,
                );
            }
        }
        if (maiorFlp) {
            const pend = await paginas(
                base,
                `fin015/finItemSispag/titulosPendentes/list/${filCod}/${bncCod}/${maiorFlp}`,
                'fin015',
                {},
                filCod,
                500,
                20,
            );
            for (const p of pend) {
                const fav = s(p.itsEspNomeFav) || s(p.dpeNomPessoa);
                if (ORGAO.test(fav.toUpperCase()))
                    conta('fin015 pendentes', 'pendentes de órgão público');
                varrer(
                    'fin015 pendentes',
                    p,
                    fav,
                    p.itsMnyValor ?? p.titMnyValor,
                    `fil ${filCod} bnc ${bncCod}`,
                );
            }
        }
        log(`fin015 fil=${filCod} bnc=${bncCod}: ${lotes.length} lotes nativos`);
    }
}

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    const base = await conectar();
    const filiais = (await base.getFiliais()).map((f) => Number((f as { filCod: unknown }).filCod));
    for (const filCod of filiais) {
        for (const [nome, fn] of [
            ['fin064', fin064],
            ['fin124', dda],
            ['fin015', lotesNativos],
        ] as const) {
            try {
                await fn(base, filCod);
            } catch (e) {
                log(`${nome} fil=${filCod}: FALHOU (${(e as Error).message})`);
            }
        }
    }
    const arrecadacao = achados.filter((a) => a.tipo === 'ARRECADACAO');
    const resumo = {
        contagem,
        arrecadacao: arrecadacao.length,
        exemplosBoleto: achados.filter((a) => a.tipo === 'BOLETO'),
    };
    writeFileSync(`${OUT}/resumo.json`, JSON.stringify(resumo, null, 2));
    writeFileSync(`${OUT}/arrecadacao.json`, JSON.stringify(arrecadacao, null, 2));
    console.log(JSON.stringify({ contagem, arrecadacao: arrecadacao.length }, null, 2));
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error(err);
        process.exit(1);
    },
);

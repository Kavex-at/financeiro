import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import type { BoletoDda } from '../domain/interface/sispag/BoletoDda.js';
import type { TituloAPagar } from '../domain/interface/sispag/SispagInterface.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import MotorSugestaoBoleto from '../domain/service/sispag/MotorSugestaoBoleto.js';
import RegraSugestaoBoleto from '../domain/service/sispag/RegraSugestaoBoleto.js';

/**
 * VALIDAÇÃO GROUND-TRUTH (sanidade) — sugestão de boleto DDA (ADR-0068, passo 1).
 *
 * O QUE VALIDA. Não há ground truth do ERP para os títulos que o ERP RECUSOU (`SEM_GROUND_TRUTH`:
 * é exatamente a população que a feature quer tratar). Há ground truth para os que o ERP JÁ
 * associou: o boleto do ERP é o de mesmo valor e mesmo dia. A pergunta de sanidade é: se o ERP não
 * tivesse flagado esses títulos, o motor de produção (`MotorSugestaoBoleto`) apontaria o MESMO
 * boleto? Um motor que aponta outro boleto num caso que o ERP resolve não pode ser confiado nos
 * casos que o ERP recusa.
 *
 * COMO. Roda o motor de PRODUÇÃO (mesma classe, sem reimplementação) sobre o banco em modo
 * SOMENTE LEITURA, com os títulos flagados "virados" para não-flagados e seus boletos liberados
 * (leave-one-out coletivo: todos disputam o pool ao mesmo tempo, o que é mais duro que um por vez).
 * Não instancia nenhum client do Conexos e não lê o ERP.
 *
 * VEREDITO por título flagado, E = boletos livres de mesmo valor e dia:
 *   REPRODUZ                — o motor sugere um boleto de E (se |E| ≥ 2, "entre idênticos");
 *   DIVERGE_OUTRO_BOLETO    — o motor sugere um boleto FORA de E  → gate vermelho (P0);
 *   EMPATE_LEGITIMO         — sem sugestão e |E| ≥ 2 (indistinguíveis; o motor se recusa a chutar);
 *   SEM_SUGESTAO            — sem sugestão e |E| = 1: o motor deixou passar um caso que o ERP resolve;
 *   SEM_BOLETO_NO_POOL      — |E| = 0: o ERP associou algo que o pool não mostra (não avaliável);
 *   ERP_COMPARTILHA_BOLETO  — o ERP flagou N títulos com valor+dia iguais mas só existem M < N boletos
 *                             livres (o flag do ERP é "existe boleto igual", não reserva 1:1). Só M
 *                             títulos podem ter boleto distinto; o motor reserva o boleto a um e NÃO
 *                             o entrega aos outros. É achado sobre o ERP (risco de barras repetidas
 *                             no lote), não falha do motor — por isso não conta como DIVERGE.
 * Critério de aprovação: DIVERGE_OUTRO_BOLETO = 0.
 *
 * Também reporta, sem veredito (descritivo): quantos títulos NÃO flagados recebem sugestão, por
 * camada e por credor — é a cobertura da feature sobre a população sem ground truth.
 *
 * Run (de src/backend):
 *   PROBE_OUT=/tmp/validate-sugestao npx tsx jobs/validate-sispag-sugestao-boleto-dda-v1.ts
 * Variável: `databaseConnectionString` (do .env). Abre a conexão com default_transaction_read_only.
 */
const OUT = process.env.PROBE_OUT ?? '/tmp/validate-sispag-sugestao-boleto-dda';
const CASOS_DE_DESENVOLVIMENTO = [
    'NELSON',
    'AR SOLUCOES',
    'MULTILOG',
    'PEDRONI',
    'ADP',
    'TRANSMAGNA',
    'SANTOS BRASIL',
    'RHENUS',
    'SCAN GLOBAL',
];

interface LinhaTitulo {
    fil_cod: number;
    doc_cod: string;
    tit_cod: string;
    credor: string | null;
    pes_cod: string | null;
    valor: number;
    venc: string;
    tem_boleto: boolean;
    forma: number | null;
    doc_esp_numero: string | null;
}
interface LinhaBoleto {
    ddc_cod: number;
    dit_cod: number;
    numero: string | null;
    valor: number;
    venc: string | null;
    codbar: string | null;
    fil_cod: number | null;
    doc_cod: string | null;
    tit_cod: string | null;
}

const main = async (): Promise<void> => {
    mkdirSync(OUT, { recursive: true });
    const db = new pg.Client({
        connectionString: process.env.databaseConnectionString,
        ssl: { rejectUnauthorized: false },
    });
    await db.connect();
    let titulos: LinhaTitulo[];
    let boletos: LinhaBoleto[];
    try {
        await db.query('SET default_transaction_read_only = on');
        titulos = (
            await db.query(
                `SELECT fil_cod, doc_cod, tit_cod, credor, pes_cod, valor::float8 AS valor,
                        to_char(vencimento AT TIME ZONE 'UTC','YYYY-MM-DD') AS venc, tem_boleto,
                        forma_pagamento_conexos AS forma, doc_esp_numero
                   FROM titulo_a_pagar WHERE ativo AND NOT pago`,
            )
        ).rows;
        boletos = (
            await db.query(
                `SELECT b.ddc_cod, b.dit_cod, b.numero, b.valor::float8 AS valor,
                        to_char(b.vencimento,'YYYY-MM-DD') AS venc, b.codbar,
                        b.fil_cod, b.doc_cod, b.tit_cod
                   FROM boleto_dda b JOIN boleto_dda_arquivo a ON a.ddc_cod = b.ddc_cod
                  WHERE a.cancelado_em IS NULL AND b.vencimento >= current_date - 60`,
            )
        ).rows;
    } finally {
        await db.end();
    }

    // Um boleto por (ddc, dit) basta; o pool repete o mesmo codbar em arquivos diários — mantém o
    // registro com vínculo do ERP, se houver, e o arquivo mais recente.
    const porCodbar = new Map<string, LinhaBoleto>();
    for (const b of boletos) {
        const k = b.codbar && b.codbar.length === 44 ? b.codbar : `${b.ddc_cod}:${b.dit_cod}`;
        const atual = porCodbar.get(k);
        if (
            !atual ||
            (!atual.tit_cod && b.tit_cod) ||
            (!!atual.tit_cod === !!b.tit_cod && b.ddc_cod > atual.ddc_cod)
        ) {
            porCodbar.set(k, b);
        }
    }
    const pool: BoletoDda[] = [...porCodbar.values()].map((b) => ({
        ddcCod: b.ddc_cod,
        ditCod: b.dit_cod,
        valor: b.valor,
        ...(b.numero ? { numero: b.numero } : {}),
        ...(b.venc ? { vencimento: b.venc } : {}),
        ...(b.codbar ? { codbar: b.codbar } : {}),
        ...(b.fil_cod != null ? { filCod: b.fil_cod } : {}),
        ...(b.doc_cod ? { docCod: b.doc_cod } : {}),
        ...(b.tit_cod ? { titCod: b.tit_cod } : {}),
    }));

    const flagados = new Set(
        titulos.filter((t) => t.tem_boleto).map((t) => `${t.fil_cod}:${t.doc_cod}:${t.tit_cod}`),
    );
    // O motor vê TODOS como não-flagados: os flagados viram elegíveis e disputam o pool.
    const entrada: TituloAPagar[] = titulos.map((t) => ({
        docCod: t.doc_cod,
        titCod: t.tit_cod,
        filCod: t.fil_cod,
        ...(t.credor ? { credor: t.credor } : {}),
        ...(t.pes_cod ? { pesCod: t.pes_cod } : {}),
        valor: t.valor,
        vencimento: Date.parse(`${t.venc}T00:00:00Z`),
        liberado: true,
        pago: false,
        temBoleto: false,
        ...(t.forma != null ? { formaPagamentoConexos: t.forma } : {}),
        ...(t.doc_esp_numero ? { numeroDocumento: t.doc_esp_numero } : {}),
        ativo: true,
    }));

    const motor = new MotorSugestaoBoleto(
        new CodigoBarrasBoleto(),
        BankingCalendar.withClock(() => new Date()),
        new RegraSugestaoBoleto(),
    );
    const sugestoes = motor.sugerir({
        titulos: entrada,
        boletos: pool,
        paresVigentes: [],
        rejeitadas: [],
        confirmadas: [],
    });
    const porTitulo = new Map<string, (typeof sugestoes)[number]>(
        sugestoes.map((s) => [`${s.filCod}:${s.docCod}:${s.titCod}`, s] as const),
    );

    // E = boletos livres (sem vínculo do ERP) com mesmo valor e mesmo dia do título.
    const livres = pool.filter((b) => !(b.filCod != null && b.docCod && b.titCod));
    const centavos = (v: number): number => Math.round(v * 100);
    const veredito: Record<string, number> = {};
    const exemplos: Record<string, string[]> = {};
    const porCredor = new Map<string, Record<string, number>>();
    const registra = (cred: string, v: string, linha: string): void => {
        veredito[v] = (veredito[v] ?? 0) + 1;
        const c = porCredor.get(cred) ?? {};
        c[v] = (c[v] ?? 0) + 1;
        porCredor.set(cred, c);
        const ex = exemplos[v] ?? [];
        if (ex.length < 8) ex.push(linha);
        exemplos[v] = ex;
    };
    const flagadosForma6 = titulos.filter((x) => x.tem_boleto && x.forma === 6);
    const tamanhoDoGrupo = new Map<string, number>();
    for (const t of flagadosForma6) {
        const g = `${centavos(t.valor)}|${t.venc}`;
        tamanhoDoGrupo.set(g, (tamanhoDoGrupo.get(g) ?? 0) + 1);
    }
    let titulosEmGrupoSuperlotado = 0;
    for (const t of flagadosForma6) {
        const k = `${t.fil_cod}:${t.doc_cod}:${t.tit_cod}`;
        const E = livres.filter(
            (b) => centavos(b.valor) === centavos(t.valor) && b.vencimento === t.venc,
        );
        const s = porTitulo.get(k);
        const cred = (t.credor ?? '?').slice(0, 30);
        const linha = `${cred} f${t.fil_cod} ${t.doc_cod}/${t.tit_cod} R$${t.valor} ${t.venc} |E|=${E.length}${s ? ` → ${s.avaliacao.resultado} boleto ${s.numeroBoleto ?? s.ditCod}` : ''}`;
        const n = tamanhoDoGrupo.get(`${centavos(t.valor)}|${t.venc}`) ?? 1;
        const superlotado = E.length > 0 && n > E.length;
        if (superlotado) titulosEmGrupoSuperlotado += 1;
        const reproduz = s && E.some((b) => b.ddcCod === s.ddcCod && b.ditCod === s.ditCod);
        if (E.length === 0) registra(cred, 'SEM_BOLETO_NO_POOL', linha);
        else if (reproduz) registra(cred, 'REPRODUZ', linha);
        else if (superlotado)
            registra(
                cred,
                'ERP_COMPARTILHA_BOLETO',
                `${linha} (grupo: ${n} títulos, ${E.length} boletos)`,
            );
        else if (!s) registra(cred, E.length >= 2 ? 'EMPATE_LEGITIMO' : 'SEM_SUGESTAO', linha);
        else registra(cred, 'DIVERGE_OUTRO_BOLETO', linha);
    }

    // Descritivo: população SEM ground truth (não flagados).
    const camadas: Record<string, number> = {};
    const credoresSugeridos: Record<string, number> = {};
    let naoFlagadosBoleto = 0;
    for (const t of titulos.filter(
        (x) => !flagados.has(`${x.fil_cod}:${x.doc_cod}:${x.tit_cod}`) && x.forma === 6,
    )) {
        naoFlagadosBoleto += 1;
        const s = porTitulo.get(`${t.fil_cod}:${t.doc_cod}:${t.tit_cod}`);
        if (!s) continue;
        camadas[s.avaliacao.resultado] = (camadas[s.avaliacao.resultado] ?? 0) + 1;
        const c = (t.credor ?? '?').slice(0, 30);
        credoresSugeridos[c] = (credoresSugeridos[c] ?? 0) + 1;
    }

    const emDev = (c: string): boolean =>
        CASOS_DE_DESENVOLVIMENTO.some((d) => c.toUpperCase().includes(d));
    const cegos = [...porCredor].filter(([c]) => !emDev(c));
    const cegosTotais = cegos.reduce(
        (s, [, v]) => s + Object.values(v).reduce((a, b) => a + b, 0),
        0,
    );
    const cegosDiverge = cegos.reduce((s, [, v]) => s + (v.DIVERGE_OUTRO_BOLETO ?? 0), 0);
    const cegosReproduz = cegos.reduce((s, [, v]) => s + (v.REPRODUZ ?? 0), 0);

    const aprovado = (veredito.DIVERGE_OUTRO_BOLETO ?? 0) === 0;
    const resumo = {
        geradoEm: new Date().toISOString(),
        titulosAtivos: titulos.length,
        boletosNoPool: pool.length,
        flagadosForma6: titulos.filter((x) => x.tem_boleto && x.forma === 6).length,
        veredito,
        titulosFlagadosEmGrupoSuperlotado: titulosEmGrupoSuperlotado,
        criterio: 'DIVERGE_OUTRO_BOLETO = 0',
        aprovado,
        amostraCega: {
            credoresForaDoDesenvolvimento: cegos.length,
            titulos: cegosTotais,
            reproduz: cegosReproduz,
            diverge: cegosDiverge,
        },
        porCredor: Object.fromEntries(
            [...porCredor]
                .sort(
                    (a, b) =>
                        Object.values(b[1]).reduce((x, y) => x + y, 0) -
                        Object.values(a[1]).reduce((x, y) => x + y, 0),
                )
                .slice(0, 25),
        ),
        exemplos,
        semGroundTruth: {
            titulosBoletoNaoFlagados: naoFlagadosBoleto,
            comSugestaoPorCamada: camadas,
            credoresComSugestao: Object.fromEntries(
                Object.entries(credoresSugeridos)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 15),
            ),
            nota: 'SEM_GROUND_TRUTH: o ERP recusou estes títulos; só cobertura descritiva.',
        },
    };
    writeFileSync(`${OUT}/resumo.json`, JSON.stringify(resumo, null, 2));
    console.log(JSON.stringify(resumo, null, 2));
    console.log(
        `\n${aprovado ? 'APROVADO' : 'REPROVADO'} — DIVERGE_OUTRO_BOLETO = ${veredito.DIVERGE_OUTRO_BOLETO ?? 0}`,
    );
    if (!aprovado) process.exitCode = 1;
};

main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((e) => {
        console.error('[validate-sugestao] FALHOU:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

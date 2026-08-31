import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * SONDA READ-ONLY — a coluna "Boleto" do painel diria a verdade?
 *
 * Reproduz EXATAMENTE o que a ingestão calcularia (`listarTitulosComBoletoDda` cruzado com a
 * carteira do `fin064`, mesma janela −15d..+45d) **sem escrever nada** — nem no ERP nem no
 * Postgres. Depois confere o resultado contra o pool de boletos do `fin124`: para cada título
 * que ficaria marcado, existe mesmo um boleto DDA com aquele valor?
 *
 * É a pergunta que o painel não responde sozinho: o flag `titVldReflexoDdaAssoc` é do ERP, e
 * queremos saber se ele corresponde a um boleto real antes de confiar na coluna.
 *
 * SEGURANÇA: só endpoints `/list`. Nenhuma escrita, em lugar nenhum.
 *
 * Run:
 *   cd src/backend
 *   PROBE_PRD=1 npx tsx jobs/probe-verificar-coluna-boleto.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml') && process.env.PROBE_PRD !== '1') {
    console.error(`RECUSADO: base não é HML (${BASE}). Para PRD (read-only) passe PROBE_PRD=1.`);
    process.exit(1);
}
const OUT = process.env.PROBE_OUT ?? '/tmp/verificar-coluna-boleto';
const FILIAIS = (process.env.PROBE_FILIAIS ?? '1,2,4,6')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
const ARQUIVOS_DDA = Number(process.env.ARQUIVOS_DDA ?? 25);
const DAY = 24 * 60 * 60 * 1000;

type Row = Record<string, unknown>;
const dia = (m: unknown): string => (m ? new Date(Number(m)).toISOString().slice(0, 10) : '—');
const log = (s: string): void => console.log(`[coluna] ${s}`);

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const sispag = container.resolve(ConexosSispagClient);
    const fin015 = container.resolve(ConexosSispagWriteClient);
    await base.ensureSid();
    console.log('='.repeat(78));
    console.log(`BASE ${BASE} (READ-ONLY) · reproduzindo o cálculo da ingestão`);
    console.log('='.repeat(78));

    // ── pool de boletos DDA (global — não é por filial) ─────────────────────
    const arqs = await base.listGenericPaginated<Row>(
        'fin124/list',
        { fieldList: [], filterList: {}, serviceName: 'fin124', pageNumber: 1, pageSize: 500 },
        { filCod: FILIAIS[0] },
    );
    const recentes = [...(arqs.rows ?? [])]
        .sort((a, b) => Number(b.ddcCod ?? 0) - Number(a.ddcCod ?? 0))
        .slice(0, ARQUIVOS_DDA);
    const boletos: Row[] = [];
    for (const a of recentes) {
        const itens = await base.listGenericPaginated<Row>(
            `fin124/itens/list/${a.ddcCod}`,
            { fieldList: [], filterList: {}, serviceName: 'fin124', pageNumber: 1, pageSize: 500 },
            { filCod: FILIAIS[0] },
        );
        boletos.push(...(itens.rows ?? []));
    }
    const porValor = new Map<string, Row[]>();
    for (const b of boletos) {
        const k = Number(b.ditMnyValor ?? 0).toFixed(2);
        porValor.set(k, [...(porValor.get(k) ?? []), b]);
    }
    log(
        `pool DDA: ${recentes.length} arquivos, ${boletos.length} boletos, ${porValor.size} valores distintos\n`,
    );

    const resumo: Row[] = [];
    const exemplos: Row[] = [];

    for (const filCod of FILIAIS) {
        const agora = Date.now();
        const [carteira, comBoleto] = await Promise.all([
            sispag.listTitulosAPagar(filCod, {
                minVencimento: agora - 15 * DAY,
                maxVencimento: agora + 45 * DAY,
            }),
            (async () => {
                const contas = await sispag.listContasCorrentes(filCod);
                const bncCods = [...new Set(contas.map((c) => c.bncCod))];
                if (bncCods.length === 0) return new Set<string>();
                return fin015.listarTitulosComBoletoDda({ filCod, bncCods });
            })(),
        ]);

        const marcados = carteira.filter((t) => comBoleto.has(`${filCod}:${t.docCod}:${t.titCod}`));
        // O flag corresponde a um boleto REAL no pool do fin124 com o mesmo valor?
        const confirmados = marcados.filter((t) => porValor.has(Number(t.valor ?? 0).toFixed(2)));

        log(
            `fil ${filCod}: carteira=${carteira.length} · marcados "tem boleto"=${marcados.length} ` +
                `(${carteira.length ? Math.round((marcados.length / carteira.length) * 100) : 0}%) · ` +
                `com boleto de mesmo valor no fin124=${confirmados.length}`,
        );
        resumo.push({
            filCod,
            carteira: carteira.length,
            marcados: marcados.length,
            confirmadosNoFin124: confirmados.length,
            semCorrespondencia: marcados.length - confirmados.length,
        });

        for (const t of confirmados.slice(0, 3)) {
            const cands = porValor.get(Number(t.valor ?? 0).toFixed(2)) ?? [];
            exemplos.push({
                filCod,
                doc: `${t.docCod}/${t.titCod}`,
                credor: (t.credor ?? '').slice(0, 34),
                valor: Number(t.valor ?? 0).toFixed(2),
                vencTitulo: dia(t.vencimento),
                boletosMesmoValor: cands.length,
                vencBoleto: dia(cands[0]?.ditDtaVencimento),
                bancoEmissor: String(cands[0]?.ditEspCodbar ?? '').slice(0, 3),
                arquivoDda: cands[0]?.ddcCod,
            });
        }
    }

    writeFileSync(`${OUT}/resumo.json`, JSON.stringify({ resumo, exemplos }, null, 2));
    console.log(`\n${'='.repeat(78)}`);
    console.table(resumo);
    console.log('\nEXEMPLOS para conferir no ERP (fin064 → o título; fin124 → o boleto):');
    console.table(exemplos);
    console.log('='.repeat(78));
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});

import 'reflect-metadata';
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';

/**
 * TESTE DE ESCRITA — **SOMENTE HML** — qual o SHAPE da resposta a uma QUESTION do Conexos?
 *
 * `probe-dda-assoc-write-hml.ts` provou que `titVldReflexoDdaAssoc: 1` faz o ERP achar o
 * boleto e PERGUNTAR: `FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO` (YES/NO). Falta o
 * protocolo de RESPOSTA — não está no OpenAPI e não há HAR no repo.
 *
 * MÉTODO: tentar candidatos de shape, um por vez, contra o mesmo título. Sinal de acerto =
 * a resposta deixa de ser `type: QUESTION`. Cada tentativa é uma escrita; para no primeiro
 * acerto.
 *
 * ⚠️ ESCREVE em HML. Recusa qualquer base que não seja `-hml`.
 * Run: cd src/backend && CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api npx tsx jobs/probe-dda-answer-shape-hml.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: escreve — só HML. Base atual: ${BASE}`);
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 2);
const OUT = '/tmp/dda-answer-shape';
type Row = Record<string, unknown>;
const log = (s: string): void => console.log(`[answer-shape] ${s}`);

const QUESTION_KEY = 'FIN_041.EXISTE_CODIGO_BARRAS_ASSOCIADO_TITULO';

/** Candidatos de encoding da resposta YES. */
const CANDIDATOS: Array<{ nome: string; extra: Row }> = [
    // O 500 anterior entregou o tipo: `answers` é um Map<String,String> no DTO Java.
    { nome: 'answers map por id', extra: { answers: { '1': 'YES' } } },
    { nome: 'answers map por key', extra: { answers: { [QUESTION_KEY]: 'YES' } } },
    { nome: 'answers map id+key', extra: { answers: { '1': 'YES', [QUESTION_KEY]: 'YES' } } },
    {
        nome: 'answers map id->YES + questions eco',
        extra: { answers: { '1': 'YES' }, questions: [{ id: '1', key: QUESTION_KEY }] },
    },
];

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    await base.ensureSid();
    log(`BASE ${BASE} (HML)`);

    const lotes = await write.listarLotesNativos({ filCod: FIL, bncCod: 4 });
    const flpCod = lotes.find((l) => l.status === 0)?.flpCod;
    if (!flpCod) throw new Error('nenhum lote aberto em HML');
    log(`lote de teste: flp=${flpCod}`);

    const page = await base.listGenericPaginated<Row>(
        `fin015/finItemSispag/titulosPendentes/list/${FIL}/4/${flpCod}`,
        { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 500 },
        { filCod: FIL },
    );
    const alvo = (page.rows ?? []).find((r) => Number(r.titVldReflexoDdaAssoc ?? 0) === 1);
    if (!alvo) throw new Error('nenhum pendente com titVldReflexoDdaAssoc=1');
    log(`alvo: doc=${alvo.docCod}/${alvo.titCod} valor=${alvo.titMnyValor}`);

    const valor = Number(alvo.titMnyValor ?? 0);
    const base_item = {
        ...alvo,
        filCodLote: FIL,
        bncCod: 4,
        flpCod,
        itsVldModalidade: 6,
        itsEspNomeFav: alvo.dpeNomPessoa,
        itsMnyValor: valor,
        itsMnyVlrPgto: valor,
        titMnyLiquido: valor,
        itsDtaPgto: Number(alvo.titDtaVencimento ?? 0),
        vldOk: 1,
        vldImporta: 1,
        avisos: '[]',
    };
    const selecao = {
        op: 1,
        bncCodFin015: 4,
        titVldReflexoDdaAssoc: 1,
        titVldReflexoDdaDesassoc: 0,
    };
    const resultados: Row[] = [];

    for (const cand of CANDIDATOS) {
        const body = {
            items: [{ ...base_item, ...selecao, ...cand.extra }],
            ...selecao,
            ...cand.extra,
        };
        try {
            const res = await base.postGenericOnce<unknown>(
                'fin015/finItemSispag/titulosPendentes/importar',
                body,
                { filCod: FIL },
            );
            log(
                `✅ '${cand.nome}' → 200 SEM pergunta! resposta: ${JSON.stringify(res).slice(0, 300)}`,
            );
            resultados.push({ candidato: cand.nome, resultado: 'ACEITO', res });
            writeFileSync(`${OUT}/resultados.json`, JSON.stringify(resultados, null, 2));
            break;
        } catch (err) {
            const data = (err as { response?: { data?: unknown } })?.response?.data as
                | Row
                | undefined;
            const tipo = String(data?.type ?? '');
            if (tipo === 'QUESTION') {
                log(`   '${cand.nome}' → ainda QUESTION (shape não reconhecido)`);
                resultados.push({ candidato: cand.nome, resultado: 'QUESTION' });
            } else {
                log(
                    `⚠️ '${cand.nome}' → outro erro: ${JSON.stringify(data ?? (err as Error).message).slice(0, 400)}`,
                );
                resultados.push({ candidato: cand.nome, resultado: 'OUTRO_ERRO', data });
            }
        }
    }
    writeFileSync(`${OUT}/resultados.json`, JSON.stringify(resultados, null, 2));

    // estado final do lote
    const itens = await base.listGenericPaginated<Row>(
        `fin015/finItemSispag/list/${FIL}/4/${flpCod}`,
        { fieldList: [], filterList: {}, serviceName: 'fin015', pageNumber: 1, pageSize: 200 },
        { filCod: FIL },
    );
    console.log('='.repeat(78));
    console.table(
        (itens.rows ?? []).map((i) => ({
            docCod: i.docCod,
            titCod: i.titCod,
            modalidade: i.itsVldModalidade,
            itsNumCodbar: i.itsNumCodbar ?? '— VAZIO —',
            vldVinculoDda: i.vldVinculoDda,
        })),
    );
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});

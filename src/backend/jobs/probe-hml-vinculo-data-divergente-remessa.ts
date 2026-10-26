import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagClient from '../domain/client/ConexosSispagClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import HmlDataDivergenteCasos from './hmlDataDivergenteCasos.js';

/**
 * MEDIÇÃO HML (ESCREVE) — V12, só a geração da remessa de um lote JÁ FINALIZADO (retomada do
 * `probe-hml-vinculo-data-divergente-rem.ts`, cuja geração falhou com NUMERO_DE_REMESSA_JA_USADO).
 *
 * O QUE ESCREVE: `gerarRemessa` no lote `FLP` (cria o `.REM` NO ERP DE HML; nunca vai ao banco).
 * Não cria lote, não importa título. O conteúdo é lido, só datas são decodificadas e comparadas
 * com as datas do título e da barra de cada item (`REFS`), e o arquivo é descartado.
 *
 *   FLP=53 REFS='2025-12-18|2026-10-29,2025-12-10|2026-11-03' (título|barra por item)
 *   HML_ENV_FILE=... CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" EXECUTAR=1 npx tsx jobs/probe-hml-vinculo-data-divergente-remessa.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (process.env.EXECUTAR !== '1' || !BASE.includes('-hml')) {
    console.error('RECUSADO: exige EXECUTAR=1 e base HML.');
    process.exit(1);
}
if (!process.env.HML_ENV_FILE || process.env.databaseConnectionString !== '') {
    console.error('RECUSADO: exige HML_ENV_FILE e databaseConnectionString="".');
    process.exit(1);
}
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const FLP = Number(process.env.FLP);
const SEQ_ENV = process.env.SEQ;
const REFS = (process.env.REFS ?? '').split(',').filter(Boolean);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-vinculo-data-divergente';
if (!Number.isInteger(FLP)) {
    console.error(
        'RECUSADO: informe FLP (SEQ é opcional: sem ele usa o número sugerido pelo ERP).',
    );
    process.exit(1);
}
const log = (s: string): void => console.log(`[hml-data-div-remessa] ${s}`);

const decodificarJ = (conteudo: string): Array<{ vencimento: string; dataPagamento: string }> =>
    conteudo
        .split(/\r?\n/)
        .filter((l) => l.length >= 167 && l[7] === '3' && l[13] === 'J' && l.slice(17, 19) !== '52')
        .map((l) => {
            const dd = (s: string): string => `${s.slice(4, 8)}-${s.slice(2, 4)}-${s.slice(0, 2)}`;
            return { vencimento: dd(l.slice(91, 99)), dataPagamento: dd(l.slice(144, 152)) };
        });

async function main(): Promise<void> {
    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    await base.ensureSid();
    log('login OK');
    const sispag = container.resolve(ConexosSispagClient);
    const conta = (await sispag.listContasCorrentes(FIL)).find((c) => c.bncCod === BNC);
    if (!conta) throw new Error('sem conta pagadora');
    // Leitura: o ERP diz qual é o próximo número livre (a tentativa às cegas deu NUMERO_DE_REMESSA_JA_USADO).
    const sugerida = await write.sugerirRemessa({ filCod: FIL, bncCod: BNC, ccoCod: conta.ccoCod });
    const SEQ = SEQ_ENV ? Number(SEQ_ENV) : sugerida.numRemessa;
    const nome = SEQ_ENV ? `PG${SEQ}.REM` : sugerida.nomeArquivo;
    log(
        `número da remessa: ${SEQ} (sugerido pelo ERP: ${sugerida.numRemessa} · ${sugerida.nomeArquivo})`,
    );
    await write.gerarRemessa({
        filCod: FIL,
        bncCod: BNC,
        flpCod: FLP,
        grbCodSeq: 1,
        seqNum: SEQ,
        gabEspNomeArquivo: nome,
    });
    const arqs = await write.listarArquivosRemessa({ filCod: FIL, bncCod: BNC, flpCod: FLP });
    const arq = arqs.find((a) => a.nomeArquivo === nome) ?? arqs.find((a) => a.conteudo);
    const js = arq?.conteudo ? decodificarJ(arq.conteudo) : [];
    const refs = REFS.map((r) => {
        const [titulo = '', barra = ''] = r.split('|');
        return { titulo, barra };
    });
    const linhas = js.map((j, n) => {
        // A ordem dos J no arquivo pode não ser a dos itens: compara com TODAS as referências.
        const fontes = (dado: string): string[] =>
            refs.map((ref, i) => `item${i + 1}:${HmlDataDivergenteCasos.fonteDaData(dado, ref)}`);
        return {
            j: n + 1,
            jVencimento: j.vencimento,
            jVencimentoContraCadaItem: fontes(j.vencimento),
            jDataPagamento: j.dataPagamento,
            jDataPagamentoContraCadaItem: fontes(j.dataPagamento),
        };
    });
    writeFileSync(`${OUT}/v12.json`, JSON.stringify({ flp: FLP, seq: SEQ, refs, linhas }, null, 2));
    log(`remessa ${nome}: ${js.length} segmento(s) J · salvo ${OUT}/v12.json`);
    for (const l of linhas) log(JSON.stringify(l));
}

main().catch((e) => {
    console.error(
        String((e as Error).message)
            .replace(/\d{20,}/g, '…')
            .slice(0, 400),
    );
    process.exit(1);
});

import 'reflect-metadata';
import 'dotenv/config';
import './hmlEnvFile.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { container } from 'tsyringe';
import { bootstrapAppContainer } from '../domain/appContainer.js';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagWriteClient from '../domain/client/ConexosSispagWriteClient.js';
import CodigoBarrasBoleto from '../domain/libs/boleto/CodigoBarrasBoleto.js';
import CodigoBarrasSintetico from '../domain/libs/boleto/CodigoBarrasSintetico.js';
import BankingCalendar from '../domain/libs/calendar/BankingCalendar.js';
import HmlDataDivergenteCasos from './hmlDataDivergenteCasos.js';

/**
 * MEDIÇÃO HML — T0.1 / V10 do vínculo com data divergente (ADR-0078).
 *
 * Pergunta: o que o ERP devolve na validação/confirmação de um código de barras quando o vencimento
 * da barra é ANTES (Δ = -5, -2, -1) ou DEPOIS (Δ = +6, +10) do vencimento do título? A data do item
 * (`itsDtaPgtoResult`) acompanha a barra ou o título? Há recusa de negócio?
 *
 * O QUE ESCREVE: nenhum lote, nenhum item, nenhum título. São 2 POSTs por caso
 * (`validacao/codigoBarras` e `confirmaCodigoBarras`), que o ERP responde sem anexar nada ao
 * cadastro; cada caso usa uma barra SINTÉTICA e um vencimento de título FICTÍCIO. Se o ERP
 * persistisse algo, V1–V9 (2026-10-14) já o teriam mostrado, mas isso NÃO foi confirmado.
 * Sem `EXECUTAR=1` (ou com `--dry`) só lista os casos e NÃO faz login nem chamada alguma.
 *
 * SEGURANÇA (recusa e sai com 1): base com `-hml`; credenciais só de `HML_ENV_FILE`;
 * `databaseConnectionString=""`; só códigos sintéticos; saída só com a máscara 5+4.
 *
 *   cd src/backend
 *   HML_ENV_FILE=/home/inteli/.claude-tech/hml-conexos.env \
 *   CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api \
 *   databaseConnectionString="" EXECUTAR=1 \
 *   npx tsx jobs/probe-hml-vinculo-data-divergente.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
const DRY = process.argv.includes('--dry') || process.env.EXECUTAR !== '1';
if (!DRY) {
    if (!BASE.includes('-hml')) {
        console.error(`RECUSADO: só roda em HML. Base atual: ${BASE}`);
        process.exit(1);
    }
    if (!process.env.HML_ENV_FILE) {
        console.error('RECUSADO: informe HML_ENV_FILE (credenciais de HML; nunca o .env de PRD).');
        process.exit(1);
    }
    if (process.env.databaseConnectionString !== '') {
        console.error('RECUSADO: rode com databaseConnectionString="".');
        process.exit(1);
    }
}
const FIL = Number(process.env.FIL ?? 2);
const BNC = Number(process.env.BNC ?? 4);
const MODALIDADE = Number(process.env.MODALIDADE ?? 7);
const VALOR = Number(process.env.VALOR ?? 100);
const OUT = process.env.PROBE_OUT ?? '/tmp/hml-vinculo-data-divergente';
const log = (s: string): void => console.log(`[hml-data-div] ${s}`);
const civil = (epoch: number): string => new Date(epoch).toISOString().slice(0, 10);
const sanea = (v: unknown): unknown =>
    v === undefined ? undefined : JSON.parse(JSON.stringify(v).replace(/\d{20,}/g, '…'));

type Row = Record<string, unknown>;

const erroSeguro = (e: unknown): Row => {
    const err = e as {
        name?: string;
        code?: string;
        message?: string;
        userMessage?: string;
        response?: { status?: unknown; data?: unknown };
    };
    return {
        nome: err.name,
        code: err.code,
        message: String(err.message ?? e)
            .replace(/\d{20,}/g, '…')
            .slice(0, 300),
        userMessage: err.userMessage ? String(err.userMessage).replace(/\d{20,}/g, '…') : undefined,
        status: err.response?.status,
        data: sanea(err.response?.data),
    };
};

async function main(): Promise<void> {
    const calendar = new BankingCalendar();
    const hoje = calendar.todayBrt();
    const casos = HmlDataDivergenteCasos.casosV10(calendar, hoje);
    log(
        `${DRY ? 'DRY' : 'EXECUTAR'} · fil=${FIL} bnc=${BNC} · modalidade ${MODALIDADE} · hoje ${hoje}`,
    );
    for (const c of casos) {
        log(`   ${c.id}: título fictício ${c.tituloVenc} · barra ${c.barraVenc} (Δ ${c.delta})`);
    }
    if (DRY) return log('dry: nenhuma chamada ao ERP (nem login).');

    mkdirSync(OUT, { recursive: true });
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const write = container.resolve(ConexosSispagWriteClient);
    const conv = new CodigoBarrasBoleto();
    await base.ensureSid();
    log('login OK');

    const linhas: Row[] = [];
    for (const [i, c] of casos.entries()) {
        const barras = CodigoBarrasSintetico.barras({
            valor: VALOR,
            vencimento: c.barraVenc,
            banco: '341',
            serie: 900 + i,
        });
        const p = {
            filCod: FIL,
            bncCod: BNC,
            codigo: conv.paraLinhaDigitavel(barras) as string,
            valorLiquido: VALOR,
            vencimento: calendar.toErpEpoch(c.tituloVenc),
            modalidade: MODALIDADE,
        };
        const linha: Row = {
            caso: c.id,
            delta: c.delta,
            tituloVenc: c.tituloVenc,
            barraVenc: c.barraVenc,
            barra: HmlDataDivergenteCasos.mascarar(barras),
        };
        try {
            const v = await write.validarCodigoBarras(p);
            linha.validacaoBarraDta = civil(v.barraDtaVencimento);
            const r = await write.confirmarCodigoBarras({ ...p, validacao: v });
            linha.itsDtaPgtoResult = civil(r.itsDtaPgtoResult);
            linha.itsMnyVlrPgtoResult = r.itsMnyVlrPgtoResult;
            linha.dataDoItemAcompanha = HmlDataDivergenteCasos.fonteDaData(
                String(linha.itsDtaPgtoResult),
                { titulo: c.tituloVenc, barra: c.barraVenc },
            );
            linha.resultado = 'aceito';
        } catch (e) {
            linha.resultado = 'recusado';
            linha.erro = erroSeguro(e);
        }
        linhas.push(linha);
        log(
            `${c.id}: ${String(linha.resultado)} · itsDtaPgtoResult=${String(linha.itsDtaPgtoResult ?? '—')} (${String(linha.dataDoItemAcompanha ?? '—')})`,
        );
    }
    writeFileSync(`${OUT}/v10.json`, JSON.stringify({ hoje, linhas }, null, 2));
    log(`salvo ${OUT}/v10.json`);
}

main().catch((e) => {
    console.error(JSON.stringify(erroSeguro(e)));
    process.exit(1);
});

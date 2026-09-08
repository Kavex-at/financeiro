import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * VALIDAÇÃO EM HML das ferramentas do `ConexosSispagRetornoClient` (fin052, retorno).
 * Espelha `validate-fin015-tools.ts`: LEITURA sempre roda; o `carregar` (upload do
 * `.RET`) fica atrás de `FIN052_WRITE=1` + `RET_FILE=<caminho>` — PULADO até haver um
 * `.RET` de exemplo (analista, segunda). Guard anti-PRD (recusa base não `-hml`).
 *
 * Run (leitura):  CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api tsx jobs/validate-fin052-tools.ts
 * Run (upload):   ... FIN052_WRITE=1 RET_FILE=/caminho/PG0707.RET BNC=4 GTB=1 tsx jobs/validate-fin052-tools.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Aponte CONEXOS_BASE_URL p/ *-hml* antes.`);
    process.exit(1);
}

const FIL = Number(process.env.FLP_FIL ?? 1);
const BNC = Number(process.env.BNC ?? 4);
const GTB = Number(process.env.GTB ?? 1);

const log = (s: string, v?: unknown) =>
    console.log(`[fin052-tools] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 400) : '');

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const retorno = container.resolve(ConexosSispagRetornoClient);
    await base.ensureSid();
    log(`login HML OK · fil=${FIL} bnc=${BNC} gtb=${GTB}`);

    // ── LEITURA (sempre) ─────────────────────────────────────────────────────
    const cfgs = await retorno.listConfigsRetorno({ filCod: FIL });
    log(
        `READ listConfigsRetorno OK · ${cfgs.length} configs`,
        cfgs.map((c) => `${c.banco}(${c.bncCod},${c.gtbCodSeq})`),
    );
    const arqs = await retorno.listArquivosRetorno({ filCod: FIL, bncCod: BNC, gtbCodSeq: GTB });
    log(`READ listArquivosRetorno(bnc ${BNC}, gtb ${GTB}) OK · ${arqs.length} arquivo(s)`);
    const alvo = arqs[0];
    if (alvo) {
        const det = await retorno.listDetalhe({
            filCod: FIL,
            bncCod: alvo.bncCod,
            gtbCodSeq: alvo.gtbCodSeq,
            garCodSeq: alvo.garCodSeq,
            // Código EXATO do evento é filtro obrigatório; '00' = PAGAMENTO EFETUADO (Itaú).
            eventoCod: process.env.EVENTO ?? '00',
        });
        log(
            `READ listDetalhe OK · ${det.length} linhas · com bxaCodSeq=${det.filter((d) => d.bxaCodSeq != null).length}`,
        );
        const erros = await retorno.listErros({
            filCod: FIL,
            bncCod: alvo.bncCod,
            gtbCodSeq: alvo.gtbCodSeq,
            garCodSeq: alvo.garCodSeq,
        });
        log(`READ listErros OK · ${erros.length} erro(s)`);
    } else {
        log('READ detalhe/erros PULADOS — sem arquivo de retorno em HML (precisa do .RET).');
    }

    // ── ESCRITA: carregar o .RET (gated + precisa do arquivo) ────────────────
    if (process.env.FIN052_WRITE !== '1') {
        log(
            'READ-ONLY (FIN052_WRITE!=1) — ferramentas de leitura validadas; nenhuma escrita. Fim.',
        );
        return;
    }
    const retFile = process.env.RET_FILE;
    if (!retFile) {
        log(
            'carregar PULADO — defina RET_FILE=<caminho do .RET> (aguardando exemplo do analista).',
        );
        return;
    }
    const conteudo = readFileSync(retFile);
    const fileName = retFile.split('/').pop() ?? 'retorno.RET';
    try {
        const arq = await retorno.carregarArquivoRetorno({
            filCod: FIL,
            bncCod: BNC,
            gtbCodSeq: GTB,
            fileName,
            conteudo,
        });
        log('WRITE carregarArquivoRetorno OK →', arq);
    } catch (e) {
        log('WRITE carregarArquivoRetorno ERRO:', e instanceof Error ? e.message : String(e));
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin052-tools] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

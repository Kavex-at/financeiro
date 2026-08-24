import 'reflect-metadata';
// Carrega o .env ANTES dos imports que constroem o `conexosService` singleton
// (services/conexos.ts lê process.env.CONEXOS_USERNAME na construção, no import).
import 'dotenv/config';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import ConexosSispagRetornoClient from '../domain/client/ConexosSispagRetornoClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * Sonda READ-ONLY do `fin052` (perna de RETORNO do SISPAG) em HML. Explora o grid de
 * arquivos de retorno, o detalhe (a ponte `bxaCodSeq`→fin010), os erros de parse e as
 * configs de layout `ger015`. Guard anti-PRD (recusa base não `-hml`). NENHUMA escrita.
 *
 * Run: CONEXOS_BASE_URL=https://columbiatrading-hml.conexos.cloud/api npx tsx jobs/probe-fin052-hml.ts
 */
const BASE = process.env.CONEXOS_BASE_URL ?? '';
if (!BASE.includes('-hml')) {
    console.error(`RECUSADO: base não é HML (${BASE}). Aponte CONEXOS_BASE_URL p/ *-hml* antes.`);
    process.exit(1);
}

const log = (s: string, v?: unknown) =>
    console.log(`[fin052] ${s}`, v !== undefined ? JSON.stringify(v).slice(0, 500) : '');

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const base = container.resolve(ConexosBaseClient);
    const retorno = container.resolve(ConexosSispagRetornoClient);
    await base.ensureSid();
    log(`login HML OK · base=${BASE}`);

    // Filiais e bancos candidatos (o retorno é por filCod; arquivosRetorno/list
    // EXIGE bncCod — descoberto ao vivo: 400 "O filtro 'bncCod' é requerido").
    const filiais = (process.env.FILS ?? '1,2,3').split(',').map(Number);
    const bancos = (process.env.BNCS ?? '4,1,2,3').split(',').map(Number);
    for (const filCod of filiais) {
        // 1) configs de layout de retorno (ger015) — os gtbCodSeq válidos por banco.
        const cfgs = await retorno.listConfigsRetorno({ filCod }).catch((e) => {
            log(`fil ${filCod} · ger015 ERRO:`, e instanceof Error ? e.message : String(e));
            return [];
        });
        log(`fil ${filCod} · configs ger015: ${cfgs.length}`, cfgs.slice(0, 6));

        // 2) grid de arquivos de retorno — usa os pares (bncCod, gtbCodSeq) do ger015
        //    (arquivosRetorno/list EXIGE ambos, descoberto ao vivo).
        let arqs: Awaited<ReturnType<typeof retorno.listArquivosRetorno>> = [];
        const pares = cfgs.length > 0 ? cfgs : bancos.map((bncCod) => ({ bncCod, gtbCodSeq: 1 }));
        for (const { bncCod, gtbCodSeq } of pares) {
            const r = await retorno
                .listArquivosRetorno({ filCod, bncCod, gtbCodSeq })
                .catch((e) => {
                    log(
                        `   list(bnc${bncCod},gtb${gtbCodSeq}) ERRO:`,
                        e instanceof Error ? e.message : String(e),
                    );
                    return [] as typeof arqs;
                });
            log(`fil ${filCod} bnc ${bncCod} gtb ${gtbCodSeq} · arquivos: ${r.length}`);
            if (r.length > 0) {
                arqs = r;
                break;
            }
        }
        for (const a of arqs.slice(0, 3)) {
            log(
                `   gar${a.garCodSeq} bnc${a.bncCod} gtb${a.gtbCodSeq} | ${a.arquivo} | status=${a.status}/${a.statusProcessamento} | rejeitados=${a.titulosRejeitados} erros=${a.erros}`,
            );
        }
        // 3) detalhe + erros do 1º arquivo (a ponte bxaCodSeq→fin010).
        const alvo = arqs[0];
        if (alvo) {
            const key = {
                filCod,
                bncCod: alvo.bncCod,
                gtbCodSeq: alvo.gtbCodSeq,
                garCodSeq: alvo.garCodSeq,
            };
            // O detalhe exige o código EXATO do evento bancário como filtro; '00' = PAGAMENTO
            // EFETUADO (Itaú). E arquivo apenas CARREGADO não tem linha — só depois de processado.
            const det = await retorno
                .listDetalhe({ ...key, eventoCod: process.env.EVENTO ?? '00' })
                .catch((e) => {
                log(
                    '   detalhe ERRO (filtros exigidos? precisa HAR):',
                    e instanceof Error ? e.message : String(e),
                );
                return [];
            });
            if (det.length > 0) {
                log(`   detalhe (${det.length} linhas). 1ª:`, det[0]);
                log(
                    `   linhas com bxaCodSeq (baixa fin010): ${det.filter((d) => d.bxaCodSeq != null).length}`,
                );
            }
            const erros = await retorno.listErros(key).catch((e) => {
                log('   erros ERRO:', e instanceof Error ? e.message : String(e));
                return [];
            });
            log(`   erros de parse: ${erros.length}`, erros[0]);
            return; // achou dados — encerra
        }
    }
    log(
        'nenhum arquivo de retorno encontrado nas filiais varridas (HML pode não ter retorno carregado).',
    );
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[fin052] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

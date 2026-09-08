import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * SISPAG live probe #3 (READ-ONLY) — abrir o CONTEÚDO do "N itens de retorno" dos
 * lotes enviados (flpVldConfEnvio=1). Responde: o que são as mensagens do banco?
 * há alguma com status "pago/liquidado"?
 *
 * Caminho (tudo POST /list = leitura):
 *   fin015/list                                          → acha os lotes enviados
 *   fin015/finItemSispag/list/{fil}/{bnc}/{flp}          → os itens do lote (itsCodSeq)
 *   fin015/finItemSispag/finItemSispagRetCab/list/.../{itsCodSeq}     → cabeçalhos de retorno
 *   fin015/finItemSispag/finItemSispagRet/list/.../{itsCodSeq}/{fstCodSeq} → linhas de retorno
 *
 * Só leitura (assertReadPath bloqueia verbos mutantes). Zero escrita.
 * Run: cd src/backend && PROBE_OUT=/tmp/sispag-probe3 \
 *   CONEXOS_BASE_URL=https://columbiatrading.conexos.cloud/api tsx jobs/probe-sispag-3.ts
 */

const OUT = process.env.PROBE_OUT ?? '/tmp/sispag-probe3';
mkdirSync(OUT, { recursive: true });
const FIL = Number(process.env.PROBE_FIL ?? 2);

const FORBIDDEN =
    /(gerar|importar|finalizar|cancelar|estornar|processar|carregar|liberar|confirmar|regerar|excluir|remessaGerar|uploadExtrato|gerarRemessa)/i;
const assertReadPath = (path: string): void => {
    const isListQuery = /(^|\/)list(\/|$)/i.test(path) || /initialValues/i.test(path);
    if (FORBIDDEN.test(path) && !isListQuery) throw new Error(`REFUSED (write-ish): ${path}`);
};
const dump = (name: string, data: unknown): void =>
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
const log = (s: string): void => console.log(s);

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const conexos = container.resolve(ConexosBaseClient);
    await conexos.ensureSid();
    log(`[probe3] target=${process.env.CONEXOS_BASE_URL} fil=${FIL}`);

    const listRO = async (
        name: string,
        endpoint: string,
        filterList: Record<string, unknown> = {},
        pageSize = 200,
    ): Promise<Record<string, unknown>[]> => {
        assertReadPath(endpoint);
        try {
            const res = await conexos.listGenericPaginated<Record<string, unknown>>(
                endpoint,
                { fieldList: [], filterList, serviceName: 'fin015', pageNumber: 1, pageSize },
                { filCod: FIL },
            );
            dump(name, { endpoint, count: res.count, rows: res.rows });
            log(`[probe3] OK  ${name} (${endpoint}) count=${res.count} rows=${res.rows.length}`);
            return res.rows;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            dump(name, { endpoint, error });
            log(`[probe3] ERR ${name} (${endpoint}): ${error.slice(0, 160)}`);
            return [];
        }
    };

    // 1) lotes enviados da filial
    const lotes = await listRO('s1-lotes', 'fin015/list', {}, 200);
    const enviados = lotes.filter((l) => Number(l.flpVldConfEnvio) === 1);
    log(`[probe3] lotes=${lotes.length} enviados=${enviados.length}`);

    for (const lote of enviados) {
        const bnc = Number(lote.bncCod ?? 4);
        const flp = Number(lote.flpCod);
        const tag = `flp${flp}-bnc${bnc}`;
        // 2) itens do lote
        const itens = await listRO(
            `s2-itens-${tag}`,
            `fin015/finItemSispag/list/${FIL}/${bnc}/${flp}`,
        );
        for (const it of itens) {
            const its = Number(it.itsCodSeq ?? it.itsCod);
            if (!Number.isFinite(its)) continue;
            // 3) cabeçalhos de retorno do item (as "mensagens" do banco)
            const cabs = await listRO(
                `s3-retcab-${tag}-its${its}`,
                `fin015/finItemSispag/finItemSispagRetCab/list/${FIL}/${bnc}/${flp}/${its}`,
            );
            // 4) detalhe das linhas de TODOS os cabeçalhos (cada fstCodSeq = uma ocorrência)
            for (const cab of cabs) {
                const fst = Number(cab.fstCodSeq ?? cab.fstCod);
                if (!Number.isFinite(fst)) continue;
                await listRO(
                    `s4-retdet-${tag}-its${its}-fst${fst}`,
                    `fin015/finItemSispag/finItemSispagRet/list/${FIL}/${bnc}/${flp}/${its}/${fst}`,
                );
            }
        }
    }
    log(`[probe3] done → ${OUT}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error('[probe3] FATAL:', e instanceof Error ? e.message : String(e));
        process.exit(1);
    });

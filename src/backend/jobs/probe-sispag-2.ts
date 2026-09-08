import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { container } from 'tsyringe';
import ConexosBaseClient from '../domain/client/ConexosBaseClient.js';
import { bootstrapAppContainer } from '../domain/appContainer.js';

/**
 * SISPAG live probe #2 (READ-ONLY) — foco: quantificar uso do fluxo de remessa
 * SISPAG vs baixa direta, e fechar os endpoints de retorno/remessa que deram 400.
 *
 * Perguntas que este probe tenta responder EMPIRICAMENTE:
 *   Q1. Quão usado é o fluxo de REMESSA SISPAG? (vldHasRemessaPgto nos borderôs,
 *       amostra grande) — a maioria das baixas passa por remessa ou é direta?
 *   Q2. O RETORNO bancário é ingerido nativamente? (fin052 arquivosRetorno tem
 *       registros processados?)
 *   Q3. Existem arquivos de remessa gerados? (fin015 gerArquivosBancos/list)
 *   Q4. O que o robô fin143 (Nexxera) traz? (detalhes/list)
 *   Q5. Um lote ENVIADO (flpVldConfEnvio=1) tem itensRetorno>0? (loop fechado?)
 *
 * SEGURANÇA: idêntica ao probe #1 — só leitura (listGenericPaginated/getGeneric),
 * assertReadPath bloqueia verbos mutantes. Zero escrita.
 *
 * Run: cd src/backend && PROBE_OUT=/tmp/sispag-probe2 \
 *   CONEXOS_BASE_URL=https://columbiatrading.conexos.cloud/api tsx jobs/probe-sispag-2.ts
 */

const OUT = process.env.PROBE_OUT ?? '/tmp/sispag-probe2';
mkdirSync(OUT, { recursive: true });

const FORBIDDEN =
    /(gerar|importar|finalizar|cancelar|estornar|processar|carregar|liberar|confirmar|troca|regerar|baixaAutomatica|excluir|remessaGerar|uploadExtrato)/i;
const assertReadPath = (path: string): void => {
    const isListQuery = /(^|\/)list(\/|$)/i.test(path) || /initialValues/i.test(path);
    if (FORBIDDEN.test(path) && !isListQuery) {
        throw new Error(`REFUSED (write-ish path): ${path}`);
    }
};

const dump = (name: string, data: unknown): void =>
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));

const notes: string[] = [];
const note = (s: string): void => {
    notes.push(s);
    console.log(s);
};

async function main(): Promise<void> {
    await bootstrapAppContainer();
    const conexos = container.resolve(ConexosBaseClient);
    await conexos.ensureSid();
    const filiais = await conexos.getFiliais();
    const filCods = filiais.map((f) => f.filCod).filter((n): n is number => typeof n === 'number');
    note(`[probe2] target=${process.env.CONEXOS_BASE_URL} filiais=${filCods.join(',')}`);

    const listRO = async (
        name: string,
        endpoint: string,
        filterList: Record<string, unknown>,
        filCod?: number,
        pageSize = 500,
    ): Promise<{ count: number; rows: Record<string, unknown>[] }> => {
        assertReadPath(endpoint);
        try {
            const body = {
                fieldList: [],
                filterList,
                serviceName: endpoint.split('/')[0],
                pageNumber: 1,
                pageSize,
            };
            const res = await conexos.listGenericPaginated<Record<string, unknown>>(
                endpoint,
                body,
                filCod ? { filCod } : undefined,
            );
            dump(name, {
                endpoint,
                filCod,
                filterList,
                count: res.count,
                sampleRows: res.rows.slice(0, 8),
            });
            note(`[probe2] OK  ${name} (${endpoint}) count=${res.count}`);
            return res;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            dump(name, { endpoint, filCod, filterList, error });
            note(`[probe2] ERR ${name} (${endpoint}): ${error.slice(0, 140)}`);
            return { count: 0, rows: [] };
        }
    };

    const getRO = async (name: string, path: string, filCod?: number): Promise<unknown> => {
        assertReadPath(path);
        try {
            const data = await conexos.getGeneric<unknown>(path, filCod ? { filCod } : undefined);
            dump(name, { path, filCod, data });
            note(`[probe2] OK  ${name} (GET ${path})`);
            return data;
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            dump(name, { path, filCod, error });
            note(`[probe2] ERR ${name} (GET ${path}): ${error.slice(0, 140)}`);
            return undefined;
        }
    };

    const dist = (rows: Record<string, unknown>[], key: string): Record<string, number> => {
        const c: Record<string, number> = {};
        for (const r of rows) {
            const v = String(r[key]);
            c[v] = (c[v] ?? 0) + 1;
        }
        return c;
    };

    // ============= Q1: quão usado é o fluxo de REMESSA SISPAG? (amostra grande) ====
    // Puxa até 500 borderôs a-pagar (borVldTipo=2) por filial e mede a fração com
    // vldHasRemessaPgto=1 (passou por remessa) vs 0 (baixa direta, sem remessa).
    for (const filCod of filCods.slice(0, 3)) {
        const { count, rows } = await listRO(
            `q1-fin010-borderos-fil${filCod}`,
            'fin010/list',
            { 'borVldTipo#EQ': 2 },
            filCod,
            500,
        );
        const remessa = dist(rows, 'vldHasRemessaPgto');
        const baixa = dist(rows, 'vldHasBaixa');
        note(
            `[probe2] Q1 fil${filCod}: total=${count} amostra=${rows.length} vldHasRemessaPgto=${JSON.stringify(remessa)} vldHasBaixa=${JSON.stringify(baixa)}`,
        );
    }

    // ============= Q2: retorno bancário ingerido? (fin052) — tenta variantes ========
    const f052 = filCods[1] ?? filCods[0];
    await listRO('q2a-fin052-retorno', 'fin052/arquivosRetorno/list', {}, f052);
    await listRO('q2b-fin052-retornoCabec', 'fin052/arquivosRetornoCabec/list', {}, f052);
    await listRO('q2c-fin052-retornoDetalhe', 'fin052/arquivosRetornoDetalhe/list', {}, f052);
    // variante com serviceName explícito diferente do 1º segmento
    await (async () => {
        const endpoint = 'fin052/arquivosRetorno/list';
        assertReadPath(endpoint);
        try {
            const res = await conexos.listGenericPaginated<Record<string, unknown>>(
                endpoint,
                {
                    fieldList: [],
                    filterList: {},
                    serviceName: 'fin052',
                    pageNumber: 1,
                    pageSize: 100,
                },
                { filCod: f052 },
            );
            dump('q2d-fin052-retorno-svcfin052', {
                endpoint,
                count: res.count,
                sampleRows: res.rows.slice(0, 8),
            });
            note(`[probe2] OK  q2d-fin052 (serviceName=fin052) count=${res.count}`);
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            dump('q2d-fin052-retorno-svcfin052', { endpoint, error });
            note(`[probe2] ERR q2d-fin052 (serviceName=fin052): ${error.slice(0, 140)}`);
        }
    })();

    // ============= Q3: arquivos de remessa gerados? (fin015 gerArquivosBancos) =====
    // Usa uma filial com lotes (fil2). O path é /list/{filCodLote}.
    const loteFil = filCods.includes(2) ? 2 : filCods[0];
    await listRO(
        `q3a-fin015-remessas-fil${loteFil}`,
        `fin015/gerArquivosBancos/list/${loteFil}`,
        {},
        loteFil,
        100,
    );
    // Q5: pega um lote ENVIADO (flpVldConfEnvio=1) e lê o detalhe (itensRetorno?)
    const lotes = await listRO(`q5a-fin015-lotes-fil${loteFil}`, 'fin015/list', {}, loteFil, 100);
    const enviados = lotes.rows.filter((r) => Number(r.flpVldConfEnvio) === 1);
    note(
        `[probe2] Q5 fil${loteFil}: lotes=${lotes.rows.length} enviados(flpVldConfEnvio=1)=${enviados.length}`,
    );
    const sent = enviados[0];
    if (sent) {
        const bncCod = Number(sent.bncCod);
        const flpCod = Number(sent.flpCod);
        await getRO(
            `q5b-fin015-lote-enviado-detalhe`,
            `fin015/${loteFil}/${bncCod}/${flpCod}`,
            loteFil,
        );
        const ccoCod = Number(sent.ccoCod);
        // initialValues é READ (valores default do form de remessa)
        await getRO(
            `q3b-fin015-initialValues`,
            `fin015/gerArquivosBancos/initialValues/${loteFil}/${bncCod}/${ccoCod}`,
            loteFil,
        );
    }

    // ============= Q4: o que o robô fin143 (Nexxera) traz? (detalhes) ==============
    const f143 = await listRO('q4a-fin143-lotes', 'fin143/list', {}, filCods[0], 50);
    const leb = f143.rows[0];
    if (leb) {
        const lebCod = Number(leb.lebCod);
        await listRO(
            'q4b-fin143-detalhes',
            'fin143/detalhes/list',
            { 'lebCod#EQ': lebCod },
            filCods[0],
            50,
        );
    }

    writeFileSync(
        join(OUT, 'notes.md'),
        `# probe2 notes\n\n${notes.map((n) => `- ${n}`).join('\n')}\n`,
    );
    note(`\n[probe2] done. See ${OUT}/notes.md`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('[probe2] FAILED:', error instanceof Error ? error.stack : String(error));
        process.exit(1);
    });
